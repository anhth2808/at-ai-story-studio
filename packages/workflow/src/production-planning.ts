import { statfs } from 'node:fs/promises';
import {
  AppError,
  defaultProductionProfileSettings,
  productionPlanResultSchema,
  productionPreflightResultSchema,
  productionScopeSchema,
  renderRequestSchema,
  type AiMotionPriority,
  type Id,
  type ProductionAiPolicy,
  type ProductionPlanClassification,
  type ProductionPlanResult,
  type ProductionPlanStage,
  type ProductionPlanUnit,
  type ProductionPreflightIssue,
  type ProductionPreflightResult,
  type ProductionPriorityThreshold,
  type ProductionProfileSettings,
  type ProductionScope,
  type RenderPlan,
  type RenderRequest,
} from '@studio/shared';
import {
  AssetRepository,
  ChapterRepository,
  ProductionProfileRepository,
  ProductionRunRepository,
  PublicationPackageRepository,
  SceneRepository,
  StoryRepository,
  VisualProfileRepository,
  type DatabaseHandle,
  type ProductionProfileRecord,
} from '@studio/database';
import type { FfmpegTools, WorkspacePaths } from '@studio/media';
import { productionFingerprint } from '@studio/database';

export type ProductionReadiness = {
  ready: boolean;
  message?: string;
  status?: string;
};

export type ProductionPreflightProbes = {
  omp?: () => Promise<ProductionReadiness>;
  image?: (projectId: Id) => Promise<ProductionReadiness>;
  aiVideo?: (projectId: Id) => Promise<ProductionReadiness>;
};

export type ProductionPlanningContext = {
  database: DatabaseHandle;
  workspace: WorkspacePaths;
  media: FfmpegTools;
};

function issue(
  code: string,
  severity: ProductionPreflightIssue['severity'],
  stage: ProductionPreflightIssue['stage'],
  message: string,
  action: string,
): ProductionPreflightIssue {
  return { code, severity, stage, message, action };
}

function productionRenderScope(scope: ProductionScope): RenderRequest['scope'] {
  return scope.type === 'FULL_PROJECT'
    ? { kind: 'FULL_STORY' }
    : {
        kind: 'CHAPTER_RANGE',
        startChapterNumber: scope.startChapter,
        endChapterNumber: scope.endChapter,
      };
}

function scopeChapters(
  database: DatabaseHandle,
  projectId: Id,
  scope: ProductionScope,
): Array<{
  id: Id;
  number: number;
  revision: number;
  origin: string;
  continuityStatus: string;
  continuityCheckStatus: string | null;
}> {
  const where = scope.type === 'FULL_PROJECT' ? '' : ' AND number BETWEEN ? AND ?';
  const params =
    scope.type === 'FULL_PROJECT' ? [projectId] : [projectId, scope.startChapter, scope.endChapter];
  return database.sqlite
    .prepare(
      `SELECT id,number,revision,story_origin as origin,continuity_status as continuityStatus,
        continuity_check_status as continuityCheckStatus FROM chapters WHERE project_id=?${where} ORDER BY number`,
    )
    .all(...params) as Array<{
    id: Id;
    number: number;
    revision: number;
    origin: string;
    continuityStatus: string;
    continuityCheckStatus: string | null;
  }>;
}

function currentAsset(
  database: DatabaseHandle,
  projectId: Id,
  role: string,
): {
  id: Id;
  sha256: string;
  inputFingerprint: string | null;
  type: string;
} | null {
  return (
    (database.sqlite
      .prepare(
        "SELECT id,sha256,input_fingerprint as inputFingerprint,type FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, role) as
      { id: Id; sha256: string; inputFingerprint: string | null; type: string } | undefined) ?? null
  );
}

function profileSettings(profile: ProductionProfileRecord | null): ProductionProfileSettings {
  return profile?.settings ?? defaultProductionProfileSettings;
}

export class ProductionPreflightService {
  readonly profiles: ProductionProfileRepository;
  readonly runs: ProductionRunRepository;
  readonly story: StoryRepository;
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly assets: AssetRepository;
  readonly visualProfiles: VisualProfileRepository;

  constructor(
    private readonly context: ProductionPlanningContext,
    private readonly probes: ProductionPreflightProbes = {},
  ) {
    this.profiles = new ProductionProfileRepository(context.database);
    this.runs = new ProductionRunRepository(context.database, this.profiles);
    this.story = new StoryRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.visualProfiles = new VisualProfileRepository(context.database);
  }

  async check(
    projectId: Id,
    scopeInput: ProductionScope,
    profileId?: Id,
  ): Promise<ProductionPreflightResult> {
    const scope = productionScopeSchema.parse(scopeInput);
    const issues: ProductionPreflightIssue[] = [];
    const project = this.context.database.sqlite
      .prepare('SELECT status FROM projects WHERE id=?')
      .get(projectId) as { status: string } | undefined;
    if (!project) {
      issues.push(
        issue(
          'PROJECT_NOT_FOUND',
          'BLOCKING',
          null,
          'Project not found',
          'Choose an existing project',
        ),
      );
      return productionPreflightResultSchema.parse({
        status: 'BLOCKED',
        projectId,
        scope,
        issues,
        checkedAt: new Date().toISOString(),
      });
    }
    if (project.status !== 'ACTIVE')
      issues.push(
        issue(
          'PROJECT_ARCHIVED',
          'BLOCKING',
          null,
          'Archived projects cannot be produced',
          'Restore the project before starting production',
        ),
      );
    const profile = profileId
      ? this.profiles.get(profileId)
      : this.profiles.getCurrent(projectId, 'BALANCED');
    if (profileId && (!profile || profile.projectId !== projectId))
      issues.push(
        issue(
          'PROFILE_NOT_FOUND',
          'BLOCKING',
          null,
          'Production profile is missing for this project',
          'Select a current project profile',
        ),
      );
    const settings = profileSettings(profile);
    if (!profile)
      issues.push(
        issue(
          'PROFILE_DEFAULT',
          'INFO',
          null,
          'Using the unpersisted BALANCED defaults for this read-only check',
          'Create a production run to persist the selected profile revision',
        ),
      );

    let chapters: ReturnType<typeof scopeChapters> = [];
    try {
      chapters = scopeChapters(this.context.database, projectId, scope);
    } catch {
      issues.push(
        issue(
          'SCOPE_INVALID',
          'BLOCKING',
          'CHAPTERS',
          'Chapter scope could not be read',
          'Refresh the project and choose a valid chapter range',
        ),
      );
    }
    if (scope.type === 'CHAPTER_RANGE') {
      if (
        !chapters.length ||
        chapters[0]!.number !== scope.startChapter ||
        chapters.at(-1)!.number !== scope.endChapter ||
        chapters.length !== scope.endChapter - scope.startChapter + 1
      )
        issues.push(
          issue(
            'SCOPE_OUT_OF_RANGE',
            'BLOCKING',
            'CHAPTERS',
            'The selected chapter range is not complete',
            'Select existing contiguous chapters',
          ),
        );
    } else if (!chapters.length) {
      issues.push(
        issue(
          'CHAPTERS_REQUIRED',
          'BLOCKING',
          'CHAPTERS',
          'At least one Chapter is required',
          'Create or generate a Chapter before production',
        ),
      );
    }
    for (const chapter of chapters) {
      if (
        chapter.continuityStatus === 'CONTINUITY_STALE' ||
        chapter.continuityCheckStatus === 'FAIL'
      ) {
        const severity = settings.requireContinuityReview ? 'BLOCKING' : 'WARNING';
        issues.push(
          issue(
            'CONTINUITY_BLOCKER',
            severity,
            'CHAPTERS',
            `Chapter ${chapter.number} has a continuity blocker`,
            'Review continuity and accept a current StoryState checkpoint',
          ),
        );
      } else if (chapter.continuityStatus === 'NOT_ANALYZED') {
        issues.push(
          issue(
            'CONTINUITY_NOT_ANALYZED',
            'WARNING',
            'CHAPTERS',
            `Chapter ${chapter.number} has no continuity analysis`,
            'Run continuity analysis if this production requires it',
          ),
        );
      }
    }

    const storySettings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const storyState = this.story.getStoryState(projectId);
    if (!storyState || storyState.projectId !== projectId)
      issues.push(
        issue(
          'STORY_STATE_INVALID',
          'BLOCKING',
          'STORY',
          'Current StoryState is invalid',
          'Rebuild StoryState from a valid checkpoint',
        ),
      );
    if (!storySettings)
      issues.push(
        issue(
          'STORY_SETTINGS_MISSING',
          'WARNING',
          'STORY',
          'Story settings are not configured',
          'Configure Story settings before generated chapters are needed',
        ),
      );
    if (!blueprint)
      issues.push(
        issue(
          'STORY_BLUEPRINT_MISSING',
          'WARNING',
          'STORY',
          'No generated Story blueprint is current',
          'Generate a blueprint when using the long-story engine',
        ),
      );
    if (storySettings && storySettings.targetChapterCount > 20) {
      const arcs = this.story.getArcs(projectId);
      const windows = this.story.getPlanWindowSummaries(projectId, 100, 0);
      if (!arcs.length)
        issues.push(
          issue(
            'STORY_ARCS_REQUIRED',
            'BLOCKING',
            'STORY',
            'Long-story production requires current arcs',
            'Generate and review bounded Story arcs',
          ),
        );
      if (!windows.length)
        issues.push(
          issue(
            'STORY_PLAN_WINDOWS_REQUIRED',
            'BLOCKING',
            'STORY',
            'Long-story production requires bounded plan windows',
            'Generate and review plan windows for the selected chapters',
          ),
        );
    }
    if (settings.requireStoryApproval && blueprint)
      issues.push(
        issue(
          'STORY_APPROVAL_REQUIRED',
          'BLOCKING',
          'STORY',
          'Story approval is required by the selected profile',
          'Approve the current Story blueprint and chapter plan',
        ),
      );

    const mediaHealth = await this.context.media.health();
    if (!mediaHealth.ffmpeg)
      issues.push(
        issue(
          'FFMPEG_UNAVAILABLE',
          'BLOCKING',
          'RENDER',
          'FFmpeg is unavailable',
          'Install or configure FFmpeg',
        ),
      );
    if (!mediaHealth.ffprobe)
      issues.push(
        issue(
          'FFPROBE_UNAVAILABLE',
          'BLOCKING',
          'RENDER',
          'ffprobe is unavailable',
          'Install or configure ffprobe',
        ),
      );

    let missingImages = 0;
    for (const chapter of chapters.slice(0, 100)) {
      const sceneIds = this.context.database.sqlite
        .prepare(
          "SELECT id,stable_id as stableId FROM scene_revisions WHERE project_id=? AND chapter_id=? AND status='CURRENT' AND is_current=1 ORDER BY scene_number LIMIT 100",
        )
        .all(projectId, chapter.id) as Array<{ id: Id; stableId: string }>;
      for (const scene of sceneIds) {
        if (!this.assets.currentRenderableSceneImage(projectId, scene.stableId)) missingImages += 1;
      }
    }
    if (missingImages > 0) {
      if (this.probes.image) {
        const readiness = await this.probes.image(projectId);
        if (!readiness.ready)
          issues.push(
            issue(
              'IMAGE_PROVIDER_UNAVAILABLE',
              'BLOCKING',
              'SCENE_IMAGES',
              readiness.message ?? 'Image generation is not ready',
              'Configure an image provider or upload current Scene images',
            ),
          );
      } else {
        issues.push(
          issue(
            'IMAGE_PROVIDER_UNCHECKED',
            'WARNING',
            'SCENE_IMAGES',
            'Image provider readiness was not checked',
            'Configure an image provider before the image stage runs',
          ),
        );
      }
    }

    const aiNeeded = settings.aiMotionPolicy !== 'OFF';
    if (aiNeeded && this.probes.aiVideo) {
      const readiness = await this.probes.aiVideo(projectId);
      if (!readiness.ready) {
        if (settings.allowKenBurnsFallback)
          issues.push(
            issue(
              'AI_VIDEO_FALLBACK',
              'WARNING',
              'AI_MOTION',
              readiness.message ?? 'AI video is unavailable; Ken Burns fallback will be used',
              'Configure AI video later or keep the fallback enabled',
            ),
          );
        else
          issues.push(
            issue(
              'AI_VIDEO_REQUIRED',
              'BLOCKING',
              'AI_MOTION',
              readiness.message ?? 'AI video is required by this profile',
              'Configure AI video or enable Ken Burns fallback',
            ),
          );
      }
    } else if (aiNeeded && !settings.allowKenBurnsFallback) {
      issues.push(
        issue(
          'AI_VIDEO_READINESS_UNCHECKED',
          'BLOCKING',
          'AI_MOTION',
          'AI video readiness is required and was not checked',
          'Configure AI video or enable Ken Burns fallback',
        ),
      );
    }

    if (this.probes.omp) {
      const readiness = await this.probes.omp();
      if (!readiness.ready && (!blueprint || !storySettings))
        issues.push(
          issue(
            'OMP_UNAVAILABLE',
            'BLOCKING',
            'STORY',
            readiness.message ?? 'OMP is not ready for required Story work',
            'Configure the OMP runtime and model',
          ),
        );
    }
    try {
      const disk = await statfs(this.context.workspace.root);
      const freeBytes = Number(disk.bavail) * Number(disk.bsize);
      if (freeBytes < settings.minimumFreeBytes)
        issues.push(
          issue(
            'DISK_SPACE_LOW',
            'BLOCKING',
            null,
            'The workspace does not have enough free disk space',
            'Free disk space or lower the profile guardrail',
          ),
        );
    } catch {
      issues.push(
        issue(
          'DISK_CHECK_UNAVAILABLE',
          'WARNING',
          null,
          'Free disk space could not be checked',
          'Check workspace storage before starting production',
        ),
      );
    }

    const status = issues.some((candidate) => candidate.severity === 'BLOCKING')
      ? 'BLOCKED'
      : issues.some((candidate) => candidate.severity === 'WARNING')
        ? 'READY_WITH_WARNINGS'
        : 'READY';
    return productionPreflightResultSchema.parse({
      status,
      projectId,
      scope,
      issues: issues.slice(0, 200),
      checkedAt: new Date().toISOString(),
    });
  }
}

const aiPriorityRank: Record<AiMotionPriority | ProductionPriorityThreshold, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function aiMotionEligible(
  policy: ProductionAiPolicy,
  threshold: ProductionPriorityThreshold,
  source: string,
  priority: AiMotionPriority,
): boolean {
  if (policy === 'OFF' || source === 'KEN_BURNS') return false;
  if (policy === 'SELECTED_ONLY' || policy === 'ALL_ELIGIBLE') return true;
  return aiPriorityRank[priority] >= aiPriorityRank[threshold];
}

function classify(units: ProductionPlanUnit[]): ProductionPlanClassification {
  if (units.some((unit) => unit.classification === 'BLOCKED')) return 'BLOCKED';
  if (units.some((unit) => unit.classification === 'REVIEW')) return 'REVIEW';
  if (units.some((unit) => unit.classification === 'BUILD')) return 'BUILD';
  return 'REUSE';
}

function unit(
  key: string,
  stage: ProductionPlanStage['key'],
  classification: ProductionPlanClassification,
  message: string,
  entityId?: Id,
  dependencies: string[] = [],
): ProductionPlanUnit {
  return { key, stage, classification, message, ...(entityId ? { entityId } : {}), dependencies };
}

function stage(
  key: ProductionPlanStage['key'],
  ordinal: number,
  units: ProductionPlanUnit[],
  warnings: string[] = [],
  blockers: string[] = [],
): ProductionPlanStage {
  const counts = {
    reusableCount: units.filter((item) => item.classification === 'REUSE').length,
    buildCount: units.filter((item) => item.classification === 'BUILD').length,
    reviewCount: units.filter((item) => item.classification === 'REVIEW').length,
    blockedCount: units.filter((item) => item.classification === 'BLOCKED').length,
  };
  const classification =
    blockers.length > 0 || counts.blockedCount > 0 ? 'BLOCKED' : classify(units);
  return {
    key,
    ordinal,
    classification,
    progress: { current: counts.reusableCount, total: units.length },
    ...counts,
    units: units.slice(0, 100),
    warnings: warnings.slice(0, 100),
    blockers: blockers.slice(0, 100),
    estimate: {
      durationMs: classification === 'REUSE' ? 0 : null,
      cost: null,
      currency: null,
      source: 'UNKNOWN',
    },
  };
}

export type ProductionPlannerOptions = {
  preflight: ProductionPreflightService;
  timeline?: { getRenderPlan(projectId: Id, request: RenderRequest): RenderPlan };
};

export class ProductionPlanner {
  readonly profiles: ProductionProfileRepository;
  readonly runs: ProductionRunRepository;
  readonly story: StoryRepository;
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly assets: AssetRepository;
  readonly visualProfiles: VisualProfileRepository;
  readonly packages: PublicationPackageRepository;

  constructor(
    private readonly context: ProductionPlanningContext,
    private readonly options: ProductionPlannerOptions,
  ) {
    this.profiles = options.preflight.profiles;
    this.runs = options.preflight.runs;
    this.story = options.preflight.story;
    this.chapters = options.preflight.chapters;
    this.scenes = options.preflight.scenes;
    this.assets = options.preflight.assets;
    this.visualProfiles = options.preflight.visualProfiles;
    this.packages = new PublicationPackageRepository(context.database);
  }

  async plan(
    projectId: Id,
    scopeInput: ProductionScope,
    profileId?: Id,
  ): Promise<ProductionPlanResult> {
    const scope = productionScopeSchema.parse(scopeInput);
    const profile = profileId
      ? this.profiles.get(profileId)
      : this.profiles.getCurrent(projectId, 'BALANCED');
    if (profileId && (!profile || profile.projectId !== projectId))
      throw new AppError('PROFILE_NOT_FOUND', 'Production profile not found for this project', 404);
    const settings = profileSettings(profile);
    const preflight = await this.options.preflight.check(projectId, scope, profile?.id);
    const chapters = scopeChapters(this.context.database, projectId, scope);
    const stages: ProductionPlanStage[] = [];
    const warnings = preflight.issues
      .filter((candidate) => candidate.severity !== 'BLOCKING')
      .map((candidate) => candidate.message);
    const blockers = preflight.issues
      .filter((candidate) => candidate.severity === 'BLOCKING')
      .map((candidate) => candidate.message);
    const blueprint = this.story.getBlueprint(projectId);
    const storyUnits = [
      unit(
        'story:blueprint',
        'STORY',
        blueprint ? (settings.requireStoryApproval ? 'REVIEW' : 'REUSE') : 'BUILD',
        blueprint ? 'Current Story blueprint is reusable' : 'Story blueprint is missing',
        undefined,
        [],
      ),
      unit(
        'story:state',
        'STORY',
        this.story.getStoryState(projectId) ? 'REUSE' : 'BLOCKED',
        'Current StoryState checkpoint',
      ),
    ];
    stages.push(stage('STORY', 0, storyUnits));

    const chapterUnits = chapters.map((chapter) =>
      unit(
        `chapter:${chapter.id}`,
        'CHAPTERS',
        chapter.origin === 'GENERATED' ? 'REUSE' : 'REUSE',
        `Chapter ${chapter.number} is current`,
        chapter.id,
        ['STORY'],
      ),
    );
    stages.push(
      stage(
        'CHAPTERS',
        1,
        chapterUnits,
        [],
        chapters.length ? [] : ['At least one Chapter is required'],
      ),
    );

    const audioUnits = chapters.map((chapter) => {
      const audio = currentAsset(this.context.database, projectId, `chapter:${chapter.id}:audio`);
      const subtitle = currentAsset(
        this.context.database,
        projectId,
        `chapter:${chapter.id}:subtitle`,
      );
      const classification = audio && subtitle ? 'REUSE' : 'BUILD';
      return unit(
        `audio:${chapter.id}`,
        'AUDIO',
        classification,
        classification === 'REUSE'
          ? `Chapter ${chapter.number} audio and subtitles are current`
          : `Chapter ${chapter.number} needs audio or subtitles`,
        chapter.id,
        ['CHAPTERS'],
      );
    });
    stages.push(stage('AUDIO', 2, audioUnits));

    const sceneUnits = chapters.map((chapter) => {
      const plan = this.scenes.getScenePlan(chapter.id);
      const classification = plan?.status === 'CURRENT' && plan.sceneCount > 0 ? 'REUSE' : 'BUILD';
      return unit(
        `scenes:${chapter.id}`,
        'SCENES',
        classification,
        classification === 'REUSE'
          ? `Chapter ${chapter.number} Scene plan is current`
          : `Chapter ${chapter.number} needs a Scene plan`,
        chapter.id,
        ['CHAPTERS'],
      );
    });
    stages.push(stage('SCENES', 3, sceneUnits));

    const visualUnits: ProductionPlanUnit[] = [];
    const characters = blueprint?.blueprint.characters ?? [];
    for (const character of characters.slice(0, 100)) {
      const profileRow = this.visualProfiles.getCharacter(projectId, character.id);
      const referencesRequired =
        settings.requireReferenceApproval &&
        profileRow?.status === 'APPROVED' &&
        profileRow.payload.referenceAssetIds.length === 0;
      const classification = !profileRow
        ? 'BUILD'
        : profileRow.status !== 'APPROVED' || referencesRequired
          ? 'REVIEW'
          : 'REUSE';
      visualUnits.push(
        unit(
          `character:${character.id}`,
          'VISUAL_PROFILES',
          classification,
          !profileRow
            ? `Character ${character.name} needs a visual profile`
            : profileRow.status !== 'APPROVED'
              ? `Character ${character.name} profile requires approval`
              : referencesRequired
                ? `Character ${character.name} requires an approved reference`
                : `Character ${character.name} profile is current`,
          undefined,
          ['STORY'],
        ),
      );
    }
    const locations = this.scenes.listLocations(projectId, 100, 0);
    for (const location of locations.slice(0, 100 - visualUnits.length)) {
      const profileRow = this.visualProfiles.getLocation(projectId, location.id);
      const classification = !profileRow
        ? 'BUILD'
        : profileRow.status !== 'APPROVED'
          ? 'REVIEW'
          : 'REUSE';
      visualUnits.push(
        unit(
          `location:${location.id}`,
          'VISUAL_PROFILES',
          classification,
          !profileRow
            ? `Location ${location.name} needs a visual profile`
            : profileRow.status !== 'APPROVED'
              ? `Location ${location.name} profile requires approval`
              : `Location ${location.name} profile is current`,
          location.id,
          ['SCENES'],
        ),
      );
    }
    stages.push(
      stage(
        'VISUAL_PROFILES',
        4,
        visualUnits,
        visualUnits.length ? [] : ['No visual profile units are required'],
      ),
    );

    const chapterIds = chapters.map((chapter) => chapter.id);
    const sceneRows = chapterIds.length
      ? (this.context.database.sqlite
          .prepare(
            `SELECT id,chapter_id as chapterId,stable_id as stableId FROM scene_revisions
             WHERE project_id=? AND chapter_id IN (${chapterIds.map(() => '?').join(',')})
               AND status='CURRENT' AND is_current=1 ORDER BY chapter_id,scene_number LIMIT 100`,
          )
          .all(projectId, ...chapterIds) as Array<{ id: Id; chapterId: Id; stableId: string }>)
      : [];
    const promptUnits = sceneRows.map((scene) => {
      const prompt = this.context.database.sqlite
        .prepare(
          'SELECT status FROM visual_prompt_packages WHERE scene_revision_id=? AND is_current=1 LIMIT 1',
        )
        .get(scene.id) as { status: string } | undefined;
      return unit(
        `prompt:${scene.stableId}`,
        'VISUAL_PROMPTS',
        prompt?.status === 'CURRENT' ? 'REUSE' : 'BUILD',
        prompt?.status === 'CURRENT'
          ? 'Visual Prompt Package is current'
          : 'Visual Prompt Package needs to be built',
        scene.id,
        ['SCENES', 'VISUAL_PROFILES'],
      );
    });
    stages.push(stage('VISUAL_PROMPTS', 5, promptUnits));

    const imageUnits = sceneRows.map((scene) => {
      const image = this.assets.currentRenderableSceneImage(projectId, scene.stableId);
      const generation = this.context.database.sqlite
        .prepare(
          'SELECT status,review_status as reviewStatus FROM scene_image_generations WHERE project_id=? AND scene_stable_id=? AND is_current=1 LIMIT 1',
        )
        .get(projectId, scene.stableId) as { status: string; reviewStatus: string } | undefined;
      const waitingForReview =
        !image &&
        generation?.status === 'COMPLETED' &&
        generation.reviewStatus !== 'ACCEPTED' &&
        generation.reviewStatus !== 'REJECTED' &&
        settings.requireImageApproval;
      const classification = image ? 'REUSE' : waitingForReview ? 'REVIEW' : 'BUILD';
      return unit(
        `image:${scene.stableId}`,
        'SCENE_IMAGES',
        classification,
        image
          ? 'Current approved Scene image is reusable'
          : waitingForReview
            ? 'Current Scene image requires review'
            : 'Scene image needs generation or manual upload',
        scene.id,
        ['VISUAL_PROMPTS'],
      );
    });
    stages.push(stage('SCENE_IMAGES', 6, imageUnits));

    const aiUnits = sceneRows.map((scene) => {
      const source = this.context.database.sqlite
        .prepare(
          'SELECT motion_source as motionSource FROM scene_motion_sources WHERE project_id=? AND scene_stable_id=?',
        )
        .get(projectId, scene.stableId) as { motionSource: string } | undefined;
      const plan = this.context.database.sqlite
        .prepare(
          `SELECT priority FROM ai_motion_plan_revisions
           WHERE project_id=? AND scene_stable_id=? AND is_current=1 LIMIT 1`,
        )
        .get(projectId, scene.stableId) as { priority: AiMotionPriority } | undefined;
      const motionSource = source?.motionSource ?? 'KEN_BURNS';
      const eligible = aiMotionEligible(
        settings.aiMotionPolicy,
        settings.aiPriorityThreshold,
        motionSource,
        plan?.priority ?? 'NONE',
      );
      const generation = eligible
        ? (this.context.database.sqlite
            .prepare(
              `SELECT status,review_status as reviewStatus FROM scene_video_generations
               WHERE project_id=? AND scene_stable_id=? AND is_current=1 LIMIT 1`,
            )
            .get(projectId, scene.stableId) as { status: string; reviewStatus: string } | undefined)
        : undefined;
      const classification = !eligible
        ? 'REUSE'
        : generation?.status === 'COMPLETED' && generation.reviewStatus === 'ACCEPTED'
          ? 'REUSE'
          : generation?.status === 'COMPLETED' && generation.reviewStatus !== 'REJECTED'
            ? 'REVIEW'
            : 'BUILD';
      return unit(
        `motion:${scene.stableId}`,
        'AI_MOTION',
        classification,
        !eligible
          ? 'Motion policy selects Ken Burns for this Scene'
          : classification === 'REUSE'
            ? 'Accepted AI motion is reusable'
            : classification === 'REVIEW'
              ? 'AI motion requires review'
              : 'AI motion is eligible for generation',
        scene.id,
        ['SCENE_IMAGES'],
      );
    });
    stages.push(
      stage(
        'AI_MOTION',
        7,
        aiUnits,
        settings.allowKenBurnsFallback
          ? ['Ken Burns remains available as the technical fallback']
          : [],
      ),
    );

    let renderPlan: RenderPlan | null = null;
    if (this.options.timeline) {
      try {
        renderPlan = this.options.timeline.getRenderPlan(
          projectId,
          renderRequestSchema.parse({
            source: 'SCENES',
            scope: productionRenderScope(scope),
            autoBuild: false,
            // Ken Burns is handled by the AI-motion stage; render fallback modes are separate.
            fallbackPolicy: 'FAIL',
            qualityPreset: settings.renderQualityPreset,
          }),
        );
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Timeline render plan could not be read',
        );
      }
    }
    const timelineClassification = renderPlan?.blockers.length
      ? 'BLOCKED'
      : renderPlan?.project.reusable
        ? 'REUSE'
        : 'BUILD';
    stages.push(
      stage(
        'TIMELINE',
        8,
        [
          unit(
            'timeline:project',
            'TIMELINE',
            timelineClassification,
            timelineClassification === 'REUSE'
              ? 'Timeline render plan is reusable'
              : 'Timeline timing and motion require work',
            undefined,
            ['SCENE_IMAGES', 'AI_MOTION'],
          ),
        ],
        [],
        renderPlan?.blockers.map((blocker) => blocker.message) ?? [],
      ),
    );
    const renderClassification = renderPlan?.blockers.length
      ? 'BLOCKED'
      : renderPlan?.project.reusable
        ? 'REUSE'
        : 'BUILD';
    stages.push(
      stage(
        'RENDER',
        9,
        [
          unit(
            'render:project',
            'RENDER',
            renderClassification,
            renderClassification === 'REUSE'
              ? 'Project video is reusable'
              : 'Project video must be rendered',
            undefined,
            ['TIMELINE', 'AUDIO'],
          ),
        ],
        [],
        renderPlan?.blockers.map((blocker) => blocker.message) ?? [],
      ),
    );

    const packageCurrent = this.context.database.sqlite
      .prepare(
        'SELECT status FROM publication_packages WHERE project_id=? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(projectId) as { status: string } | undefined;
    const packageClassification =
      packageCurrent?.status === 'READY' && renderClassification === 'REUSE'
        ? 'REUSE'
        : settings.requireMetadata && !settings.generateMetadataDraft
          ? 'REVIEW'
          : 'BUILD';
    stages.push(
      stage(
        'PUBLICATION_PACKAGE',
        10,
        [
          unit(
            'package:current',
            'PUBLICATION_PACKAGE',
            packageClassification,
            packageClassification === 'REUSE'
              ? 'Publication package is current'
              : 'Publication package must be built',
            undefined,
            ['RENDER'],
          ),
        ],
        settings.requireThumbnail ? ['A thumbnail is required by the selected profile'] : [],
      ),
    );

    const fingerprint = productionFingerprint({
      projectId,
      scope,
      profileId: profile?.id ?? null,
      profileRevision: profile?.revision ?? 0,
      settings,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        number: chapter.number,
        revision: chapter.revision,
        continuityStatus: chapter.continuityStatus,
      })),
      stages: stages.map((candidate) => ({
        key: candidate.key,
        classification: candidate.classification,
        units: candidate.units.map((item) => ({
          key: item.key,
          classification: item.classification,
        })),
      })),
    });
    const result = productionPlanResultSchema.parse({
      projectId,
      scope,
      profileId: profile?.id ?? null,
      profileRevision: profile?.revision ?? 0,
      fingerprint,
      stages,
      warnings: warnings.slice(0, 200),
      blockers: blockers.slice(0, 200),
      estimate: {
        durationMs: stages.every((candidate) => candidate.classification === 'REUSE') ? 0 : null,
        cost: null,
        currency: settings.costCurrency,
        source: 'UNKNOWN',
      },
      createdAt: new Date().toISOString(),
    });
    return result;
  }
}
