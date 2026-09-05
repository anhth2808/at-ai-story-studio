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
  type Shot,
  type VideoBackend,
} from '@studio/shared';
import {
  AssetRepository,
  ChapterRepository,
  ProductionProfileRepository,
  ProductionRunRepository,
  PublicationPackageRepository,
  SceneRepository,
  SceneImageGenerationRepository,
  SceneVideoGenerationRepository,
  ShotPlanRepository,
  StoryRepository,
  VisualProfileRepository,
  VisualPromptPackageRepository,
  VisualReferenceGenerationRepository,
  type CurrentAsset,
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
  aiVideoBackend?: (projectId: Id, backend: VideoBackend) => Promise<ProductionReadiness>;
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
function shotNeedsExactReferences(settings: ProductionProfileSettings, shot: Shot): boolean {
  return (
    settings.strictReferenceRequirement ||
    (settings.imageCandidatePolicy === 'QUALITY' &&
      (shot.hero ||
        shot.importance === 'HIGH' ||
        shot.identitySensitive ||
        shot.dialogueMode === 'SPOKEN' ||
        shot.dialogueMode === 'OFFSCREEN_SPOKEN'))
  );
}
function profileSettings(profile: ProductionProfileRecord | null): ProductionProfileSettings {
  return profile?.settings ?? defaultProductionProfileSettings;
}

export class ProductionPreflightService {
  readonly profiles: ProductionProfileRepository;
  readonly runs: ProductionRunRepository;
  readonly assets: AssetRepository;
  readonly story: StoryRepository;
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly videos: SceneVideoGenerationRepository;
  readonly images: SceneImageGenerationRepository;
  readonly visualProfiles: VisualProfileRepository;
  readonly shotPlans: ShotPlanRepository;
  readonly visualPackages: VisualPromptPackageRepository;
  readonly references: VisualReferenceGenerationRepository;

  constructor(
    private readonly context: ProductionPlanningContext,
    private readonly probes: ProductionPreflightProbes = {},
  ) {
    this.assets = new AssetRepository(context.database);
    this.profiles = new ProductionProfileRepository(context.database);
    this.runs = new ProductionRunRepository(context.database, this.profiles);
    this.story = new StoryRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.images = new SceneImageGenerationRepository(context.database);
    this.videos = new SceneVideoGenerationRepository(context.database);
    this.visualProfiles = new VisualProfileRepository(context.database);
    this.shotPlans = new ShotPlanRepository(context.database);
    this.visualPackages = new VisualPromptPackageRepository(context.database);
    this.references = new VisualReferenceGenerationRepository(context.database);
  }
  private shotReferencesReady(
    projectId: Id,
    scene: { id: Id; locationId: string | null },
    shot: Shot,
    settings: ProductionProfileSettings,
  ): boolean {
    if (!shotNeedsExactReferences(settings, shot)) return true;
    const plan = this.shotPlans.getCurrent(projectId, scene.id);
    const promptPackage = this.visualPackages.getCurrent(projectId, scene.id, shot.id);
    if (
      !plan ||
      plan.reviewStatus !== 'APPROVED' ||
      !promptPackage ||
      promptPackage.status !== 'CURRENT' ||
      promptPackage.payload.shotPlanId !== plan.id ||
      promptPackage.payload.shotPlanRevision !== plan.revision ||
      promptPackage.payload.shotId !== shot.id
    )
      return false;
    const bindings = promptPackage.payload.referenceBindings;
    const approvedAsset = (binding: (typeof bindings)[number], expectedType: string): boolean => {
      const asset = this.assets.get(binding.assetId);
      if (
        !asset ||
        asset.projectId !== projectId ||
        asset.status !== 'READY' ||
        !(
          asset.type === expectedType ||
          (expectedType === 'LOCATION_REFERENCE' && asset.type === 'LOCATION_REFERENCE_IMAGE')
        ) ||
        asset.sha256 !== binding.sha256
      )
        return false;
      try {
        const metadata = JSON.parse(String(asset.metadata ?? '{}')) as Record<string, unknown>;
        if (binding.stageId) {
          const approved = this.references.resolveApproved(
            projectId,
            'CHARACTER_STAGE',
            binding.stageId,
            binding.revision,
          );
          return approved?.assetId === asset.id && approved?.assetSha256 === asset.sha256;
        }
        const profile =
          binding.role === 'LOCATION'
            ? this.visualProfiles.getLocation(projectId, binding.entityId)
            : this.visualProfiles.getCharacter(projectId, binding.entityId);
        if (
          !profile ||
          profile.revision !== binding.revision ||
          !profile.payload.referenceAssetIds?.includes(asset.id)
        )
          return false;
        if (binding.role === 'LOCATION') {
          const approved = this.references.resolveApproved(
            projectId,
            'LOCATION',
            binding.entityId,
            binding.revision,
          );
          return (
            (approved?.assetId === asset.id && approved?.assetSha256 === asset.sha256) ||
            (metadata.approval === 'APPROVED' &&
              (metadata.locationId === binding.entityId ||
                metadata.sourceEntityId === binding.entityId))
          );
        }
        return (
          metadata.approval === 'APPROVED' &&
          metadata.characterId === binding.entityId &&
          (metadata.appearanceStageId === null || metadata.appearanceStageId === undefined)
        );
      } catch {
        return false;
      }
    };
    for (const characterId of shot.visibleCharacterIds) {
      const binding = bindings.find(
        (candidate) =>
          candidate.entityId === characterId &&
          (candidate.role === 'CHARACTER' || candidate.role === 'PRIMARY_CHARACTER') &&
          !candidate.stageId,
      );
      if (!binding || !approvedAsset(binding, 'CHARACTER_REFERENCE_IMAGE')) {
        const stageBinding = bindings.find(
          (candidate) =>
            candidate.entityId === characterId &&
            candidate.stageId !== null &&
            candidate.role !== 'LOCATION',
        );
        if (!stageBinding || !approvedAsset(stageBinding, 'CHARACTER_STAGE_REFERENCE'))
          return false;
      }
    }
    if (scene.locationId) {
      const binding = bindings.find(
        (candidate) => candidate.role === 'LOCATION' && candidate.entityId === scene.locationId,
      );
      if (!binding || !approvedAsset(binding, 'LOCATION_REFERENCE')) return false;
    }
    return true;
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
    let qualityPending = 0;
    let referencePending = 0;
    const missingReferenceTargets: string[] = [];
    const qualityTargets: string[] = [];
    for (const chapter of chapters.slice(0, 100)) {
      const sceneRows = this.context.database.sqlite
        .prepare(
          "SELECT id,stable_id as stableId FROM scene_revisions WHERE project_id=? AND chapter_id=? AND status='CURRENT' AND is_current=1 ORDER BY scene_number LIMIT 100",
        )
        .all(projectId, chapter.id) as Array<{ id: Id; stableId: string }>;
      for (const sceneRow of sceneRows) {
        const scene = this.scenes.getScene(sceneRow.id);
        const plan = scene ? this.shotPlans.getCurrent(projectId, scene.id) : null;
        const shots = plan?.reviewStatus === 'APPROVED' ? plan.candidate.shots : [];
        const targets = shots.length
          ? shots.map((shot) => ({
              key: `${sceneRow.stableId}:shot:${shot.id}`,
              image: this.assets.currentRenderableShotImage(projectId, sceneRow.stableId, shot.id, {
                requireApproval: settings.requireImageApproval,
              }),
              generation: this.images.list(projectId, sceneRow.stableId, 1, 0, shot.id)[0] ?? null,
              referenceReady: scene
                ? this.shotReferencesReady(projectId, scene, shot, settings)
                : false,
            }))
          : [
              {
                key: `${sceneRow.stableId}:scene`,
                image: this.assets.currentRenderableSceneImage(projectId, sceneRow.stableId, {
                  requireApproval: settings.requireImageApproval,
                }),
                generation: this.images.list(projectId, sceneRow.stableId, 1, 0, null)[0] ?? null,
                referenceReady: true,
              },
            ];
        for (const target of targets) {
          if (!target.image) missingImages += 1;
          if (!target.referenceReady) {
            referencePending += 1;
            missingReferenceTargets.push(target.key);
          }
          if (
            settings.imageQualityGate === 'REQUIRED' &&
            target.generation &&
            target.generation.status === 'COMPLETED' &&
            target.generation.freshness === 'CURRENT' &&
            target.generation.reviewStatus !== 'ACCEPTED' &&
            target.generation.automaticQualityStatus !== 'PASSED'
          ) {
            qualityPending += 1;
            qualityTargets.push(target.key);
          }
        }
      }
    }
    if (referencePending > 0)
      issues.push(
        issue(
          'SHOT_REFERENCE_REQUIRED',
          'BLOCKING',
          'SCENE_IMAGES',
          `${referencePending} Shot image target(s) lack exact approved Character-stage or Location references: ${missingReferenceTargets.slice(0, 20).join(', ')}`,
          'Build current Shot prompt packages and approve the exact references before production',
        ),
      );
    if (settings.imageQualityGate === 'REQUIRED' && qualityPending > 0)
      issues.push(
        issue(
          'IMAGE_QUALITY_REVIEW_REQUIRED',
          settings.qualityFallback === 'BLOCK' ? 'BLOCKING' : 'WARNING',
          'SCENE_IMAGES',
          `${qualityPending} current Scene or Shot image(s) lack a passing automatic critic result: ${qualityTargets.slice(0, 20).join(', ')}`,
          settings.qualityFallback === 'BLOCK'
            ? 'Run automatic quality review or choose an explicit permitted fallback'
            : 'Resolve automatic quality review or human approval before final export',
        ),
      );
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
    let aiReadiness: ProductionReadiness | null = null;
    if (aiNeeded && this.probes.aiVideoBackend) {
      aiReadiness = await this.probes.aiVideoBackend(projectId, settings.videoBackendPreference);
      const fallbackBackend = settings.allowedVideoFallback;
      if (
        !aiReadiness.ready &&
        fallbackBackend !== 'NONE' &&
        fallbackBackend !== settings.videoBackendPreference
      ) {
        const fallbackReadiness = await this.probes.aiVideoBackend(projectId, fallbackBackend);
        if (fallbackReadiness.ready) {
          issues.push(
            issue(
              'AI_VIDEO_BACKEND_FALLBACK',
              'WARNING',
              'AI_MOTION',
              `${settings.videoBackendPreference} is unavailable; ${fallbackBackend} is ready as the explicit fallback`,
              'Use the configured fallback backend or restore the preferred backend',
            ),
          );
          aiReadiness = fallbackReadiness;
        } else {
          aiReadiness = {
            ready: false,
            status: aiReadiness.status,
            message: `${aiReadiness.message ?? 'Preferred video backend is unavailable'}; fallback ${fallbackBackend} is also unavailable`,
          };
        }
      }
    } else if (aiNeeded && this.probes.aiVideo) {
      aiReadiness = await this.probes.aiVideo(projectId);
    }
    let motionMissing = 0;
    let motionQualityPending = 0;
    const motionMissingTargets: string[] = [];
    const motionQualityTargets: string[] = [];
    if (aiNeeded) {
      for (const chapter of chapters.slice(0, 100)) {
        const sceneRows = this.context.database.sqlite
          .prepare(
            "SELECT id,stable_id as stableId FROM scene_revisions WHERE project_id=? AND chapter_id=? AND status='CURRENT' AND is_current=1 ORDER BY scene_number LIMIT 100",
          )
          .all(projectId, chapter.id) as Array<{ id: Id; stableId: string }>;
        for (const sceneRow of sceneRows) {
          const scene = this.scenes.getScene(sceneRow.id);
          const plan = scene ? this.shotPlans.getCurrent(projectId, scene.id) : null;
          const shots = plan?.reviewStatus === 'APPROVED' ? plan.candidate.shots : [];
          const targets = shots.length ? shots.map((shot) => ({ id: shot.id })) : [{ id: null }];
          const source = this.context.database.sqlite
            .prepare(
              'SELECT motion_source as motionSource FROM scene_motion_sources WHERE project_id=? AND scene_stable_id=?',
            )
            .get(projectId, sceneRow.stableId) as { motionSource: string } | undefined;
          for (const target of targets) {
            const motionPlan = this.context.database.sqlite
              .prepare(
                `SELECT priority FROM ai_motion_plan_revisions
                 WHERE project_id=? AND scene_stable_id=? AND is_current=1
                   AND ((? IS NULL AND shot_stable_id IS NULL) OR shot_stable_id=?) LIMIT 1`,
              )
              .get(projectId, sceneRow.stableId, target.id, target.id) as
              { priority: AiMotionPriority } | undefined;
            if (
              !aiMotionEligible(
                settings.aiMotionPolicy,
                settings.aiPriorityThreshold,
                source?.motionSource ?? 'KEN_BURNS',
                motionPlan?.priority ?? 'NONE',
              )
            )
              continue;
            const generation = target.id
              ? (this.videos.list(projectId, sceneRow.stableId, 1, 0, target.id)[0] ?? null)
              : (this.videos.list(projectId, sceneRow.stableId, 1, 0, null)[0] ?? null);
            const renderable = target.id
              ? this.videos.currentRenderableShotVideo(projectId, sceneRow.stableId, target.id, {
                  requireApproval: settings.requireQualityReview,
                  requireQualityPass: settings.videoQualityGate !== 'DISABLED',
                })
              : this.videos.currentRenderableSceneVideo(projectId, sceneRow.stableId, {
                  requireApproval: settings.requireQualityReview,
                  requireQualityPass: settings.videoQualityGate !== 'DISABLED',
                });
            if (renderable) continue;
            const key = `${sceneRow.stableId}${target.id ? `:shot:${target.id}` : ''}`;
            const qualityPending =
              generation?.status === 'COMPLETED' &&
              generation.freshness === 'CURRENT' &&
              generation.reviewStatus !== 'ACCEPTED' &&
              (settings.requireQualityReview ||
                (settings.videoQualityGate === 'REQUIRED' &&
                  generation.automaticQualityStatus !== 'PASSED'));
            if (qualityPending) {
              motionQualityPending += 1;
              motionQualityTargets.push(key);
            } else {
              motionMissing += 1;
              motionMissingTargets.push(key);
            }
          }
        }
      }
    }
    if (motionQualityPending > 0)
      issues.push(
        issue(
          'VIDEO_QUALITY_REVIEW_REQUIRED',
          settings.qualityFallback === 'BLOCK' ? 'BLOCKING' : 'WARNING',
          'AI_MOTION',
          `${motionQualityPending} current Scene or Shot clip(s) lack an eligible temporal quality state: ${motionQualityTargets.slice(0, 20).join(', ')}`,
          settings.qualityFallback === 'BLOCK'
            ? 'Run temporal quality review or choose an explicit permitted fallback'
            : 'Resolve temporal quality review or human approval before final export',
        ),
      );
    if (motionMissing > 0)
      issues.push(
        issue(
          'AI_MOTION_WORK_PENDING',
          'WARNING',
          'AI_MOTION',
          `${motionMissing} eligible Scene or Shot clip(s) need generation: ${motionMissingTargets.slice(0, 20).join(', ')}`,
          'Generate accepted AI motion for the listed targets or use the configured fallback',
        ),
      );
    if (aiNeeded && aiReadiness && !aiReadiness.ready) {
      if (settings.allowKenBurnsFallback)
        issues.push(
          issue(
            'AI_VIDEO_FALLBACK',
            'WARNING',
            'AI_MOTION',
            aiReadiness.message ?? 'AI video is unavailable; Ken Burns fallback will be used',
            'Configure AI video later or keep the fallback enabled',
          ),
        );
      else
        issues.push(
          issue(
            'AI_VIDEO_REQUIRED',
            'BLOCKING',
            'AI_MOTION',
            aiReadiness.message ?? 'AI video is required by this profile',
            'Configure AI video or enable Ken Burns fallback',
          ),
        );
    } else if (aiNeeded && !aiReadiness && !settings.allowKenBurnsFallback) {
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
  readonly videos: SceneVideoGenerationRepository;
  readonly shotPlans: ShotPlanRepository;
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
    this.videos = options.preflight.videos;
    this.shotPlans = options.preflight.shotPlans;
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
    const shotTargets = sceneRows
      .flatMap((scene) => {
        const plan = this.shotPlans.getCurrent(projectId, scene.id);
        return plan?.reviewStatus === 'APPROVED'
          ? plan.candidate.shots.map((shot) => ({ scene, shot }))
          : [];
      })
      .slice(0, 500);
    const scenesWithShots = new Set(shotTargets.map((target) => target.scene.id));
    const promptUnits = [
      ...sceneRows
        .filter((scene) => !scenesWithShots.has(scene.id))
        .map((scene) => {
          const prompt = this.context.database.sqlite
            .prepare(
              'SELECT status FROM visual_prompt_packages WHERE scene_revision_id=? AND shot_stable_id IS NULL AND is_current=1 LIMIT 1',
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
        }),
      ...shotTargets.map(({ scene, shot }) => {
        const prompt = this.context.database.sqlite
          .prepare(
            'SELECT status FROM visual_prompt_packages WHERE scene_revision_id=? AND shot_stable_id=? AND is_current=1 LIMIT 1',
          )
          .get(scene.id, shot.id) as { status: string } | undefined;
        return unit(
          `prompt:${scene.stableId}:shot:${shot.id}`,
          'VISUAL_PROMPTS',
          prompt?.status === 'CURRENT' ? 'REUSE' : 'BUILD',
          prompt?.status === 'CURRENT'
            ? 'Shot Visual Prompt Package is current'
            : 'Shot Visual Prompt Package needs to be built',
          scene.id,
          ['SCENES', 'VISUAL_PROFILES'],
        );
      }),
    ];
    stages.push(stage('VISUAL_PROMPTS', 5, promptUnits));

    const imageClassification = (
      image: CurrentAsset | null,
      generation:
        | {
            status: string;
            reviewStatus: string;
            automaticQualityStatus: string;
            freshness: string;
          }
        | null
        | undefined,
    ): ProductionPlanClassification => {
      if (image) return 'REUSE';
      const qualityReview =
        settings.imageQualityGate === 'REQUIRED' &&
        generation?.status === 'COMPLETED' &&
        generation.freshness === 'CURRENT' &&
        generation.reviewStatus !== 'ACCEPTED' &&
        generation.automaticQualityStatus !== 'PASSED';
      const review =
        qualityReview ||
        (generation?.status === 'COMPLETED' &&
          generation.freshness === 'CURRENT' &&
          generation.reviewStatus !== 'ACCEPTED' &&
          generation.reviewStatus !== 'REJECTED' &&
          settings.requireImageApproval);
      return review ? (settings.qualityFallback === 'BLOCK' ? 'BLOCKED' : 'REVIEW') : 'BUILD';
    };
    const imageUnits = [
      ...sceneRows
        .filter((scene) => !scenesWithShots.has(scene.id))
        .map((scene) => {
          const image = this.assets.currentRenderableSceneImage(projectId, scene.stableId, {
            requireApproval: settings.requireImageApproval,
          });
          const generation =
            this.options.preflight.images.list(projectId, scene.stableId, 1, 0, null)[0] ?? null;
          const classification = imageClassification(image, generation);
          return unit(
            `image:${scene.stableId}`,
            'SCENE_IMAGES',
            classification,
            image
              ? 'Current approved Scene image is reusable'
              : classification === 'REVIEW'
                ? 'Current Scene image requires review'
                : classification === 'BLOCKED'
                  ? 'Scene image is blocked by quality policy'
                  : 'Scene image needs generation or manual upload',
            scene.id,
            ['VISUAL_PROMPTS'],
          );
        }),
      ...shotTargets.map(({ scene, shot }) => {
        const image = this.assets.currentRenderableShotImage(projectId, scene.stableId, shot.id, {
          requireApproval: settings.requireImageApproval,
        });
        const generation =
          this.options.preflight.images.list(projectId, scene.stableId, 1, 0, shot.id)[0] ?? null;
        const classification = imageClassification(image, generation);
        return unit(
          `image:${scene.stableId}:shot:${shot.id}`,
          'SCENE_IMAGES',
          classification,
          image
            ? 'Current approved Shot image is reusable'
            : classification === 'REVIEW'
              ? 'Current Shot image requires review'
              : classification === 'BLOCKED'
                ? 'Shot image is blocked by quality policy'
                : 'Shot image needs generation or manual upload',
          scene.id,
          ['VISUAL_PROMPTS'],
        );
      }),
    ];
    stages.push(stage('SCENE_IMAGES', 6, imageUnits));

    const aiTargets = shotTargets.length
      ? shotTargets.map(({ scene, shot }) => ({ scene, shot }))
      : sceneRows.map((scene) => ({ scene, shot: null }));
    const aiUnits = aiTargets.map(({ scene, shot }) => {
      const source = this.context.database.sqlite
        .prepare(
          'SELECT motion_source as motionSource FROM scene_motion_sources WHERE project_id=? AND scene_stable_id=?',
        )
        .get(projectId, scene.stableId) as { motionSource: string } | undefined;
      const plan = this.context.database.sqlite
        .prepare(
          `SELECT priority FROM ai_motion_plan_revisions
           WHERE project_id=? AND scene_stable_id=? AND is_current=1
             AND ((? IS NULL AND shot_stable_id IS NULL) OR shot_stable_id=?) LIMIT 1`,
        )
        .get(projectId, scene.stableId, shot?.id ?? null, shot?.id ?? null) as
        { priority: AiMotionPriority } | undefined;
      const motionSource = source?.motionSource ?? 'KEN_BURNS';
      const eligible = aiMotionEligible(
        settings.aiMotionPolicy,
        settings.aiPriorityThreshold,
        motionSource,
        plan?.priority ?? 'NONE',
      );
      const generation = eligible
        ? shot
          ? (this.videos.getCurrent(projectId, scene.stableId, shot.id) ??
            this.videos.list(projectId, scene.stableId, 1, 0, shot.id)[0] ??
            null)
          : (this.videos.getCurrent(projectId, scene.stableId) ??
            this.videos.list(projectId, scene.stableId, 1, 0, null)[0] ??
            null)
        : null;
      const renderable = eligible
        ? shot
          ? this.videos.currentRenderableShotVideo(projectId, scene.stableId, shot.id, {
              requireApproval: settings.requireQualityReview,
              requireQualityPass: settings.videoQualityGate !== 'DISABLED',
            })
          : this.videos.currentRenderableSceneVideo(projectId, scene.stableId, {
              requireApproval: settings.requireQualityReview,
              requireQualityPass: settings.videoQualityGate !== 'DISABLED',
            })
        : null;
      const retryCount =
        typeof generation?.metadata.retryCount === 'number' &&
        Number.isInteger(generation.metadata.retryCount)
          ? generation.metadata.retryCount
          : 0;
      const reviewRequired =
        generation?.status === 'COMPLETED' &&
        generation.freshness === 'CURRENT' &&
        generation.reviewStatus !== 'ACCEPTED' &&
        (settings.requireQualityReview ||
          generation.automaticQualityStatus === 'UNAVAILABLE' ||
          generation.automaticQualityStatus === 'MANUAL_REVIEW_REQUIRED' ||
          generation.automaticQualityStatus === 'NOT_RUN' ||
          (generation.automaticQualityStatus === 'REJECTED' &&
            retryCount >= settings.temporalRetryLimit));
      const classification = !eligible
        ? 'REUSE'
        : renderable
          ? 'REUSE'
          : reviewRequired
            ? settings.qualityFallback === 'BLOCK'
              ? 'BLOCKED'
              : 'REVIEW'
            : 'BUILD';
      return unit(
        `motion:${scene.stableId}${shot ? `:shot:${shot.id}` : ''}`,
        'AI_MOTION',
        classification,
        !eligible
          ? 'Motion policy selects Ken Burns for this target'
          : classification === 'REUSE'
            ? 'Current quality-approved AI motion is reusable'
            : classification === 'REVIEW'
              ? 'AI motion requires review'
              : classification === 'BLOCKED'
                ? 'AI motion is blocked by quality policy'
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
