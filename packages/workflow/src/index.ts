import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  AppearanceStageRepository,
  AssetRepository,
  ChapterRepository,
  ProjectRepository,
  StoryBatchRepository,
  StoryRepository,
  SceneRepository,
  SceneObjectResolutionRepository,
  SceneVideoGenerationRepository,
  ShotPlanRepository,
  VisualProfileRepository,
  VisualPromptPackageRepository,
  VisualReferenceGenerationRepository,
  WorkflowRepository,
  sceneVideoRole,
  type ClaimedStep,
  type ChapterStatusFilter,
  type CurrentAsset,
  type DatabaseHandle,
  type ProductionRunRecord,
} from '@studio/database';
import {
  FfmpegTools,
  ProcessRunner,
  buildChapterVideoArguments,
  buildConcatArguments,
  buildProjectVideoArguments,
  buildRenderArguments,
  buildAiSceneClipArguments,
  buildSceneClipArguments,
  promoteManagedFile,
  safeWorkspacePath,
  type WorkspacePaths,
  initializeWorkspace,
  promoteFile,
  relativeAssetPath,
  sha256File,
  validateHierarchicalVideo,
} from '@studio/media';
import {
  AppError,
  locationSchema,
  locationUpdateSchema,
  sceneBatchRequestSchema,
  sceneEditSchema,
  sceneGenerationRequestSchema,
  motionPlanUpdateSchema,
  sceneTimingUpdateSchema,
  scenePromptRequestSchema,
  shotPlanningRequestSchema,
  shotPlanReviewRequestSchema,
  appearanceStageCreateSchema,
  sceneRegenerationRequestSchema,
  visualProfileGenerateRequestSchema,
  visualObjectKeySchema,
  visualPromptRefinementRequestSchema,
  storyArcSchema,
  storyGenerationBatchRequestSchema,
  storyPlanWindowResultSchema,
  type ChapterDto,
  type ChapterInput,
  type Id,
  type Shot,
  type VideoBackend,
  type JobDto,
  type ProjectDto,
  type ProjectInput,
  type RenderPlan,
  type RenderRequest,
  type SceneDto,
  type SceneStatus,
  type StatusSummary,
  type StoryArc,
  type StoryGenerationBatch,
  type StoryGenerationBatchItem,
  type StoryGenerationBatchRequest,
  type StoryPlanWindowResult,
  type VisualProfileGenerationKind,
  type WorkflowStatus,
  type SceneTimingUpdate,
  renderConfigSchema,
  renderRequestSchema,
} from '@studio/shared';
import { segmentNarrationText, serializeSrt, subtitlesFromSegments } from './text.js';
import {
  buildChapterGenerationContextV2,
  planWindowBoundary,
  renderChapterGenerationPrompt,
  renderSummaryGenerationPrompt,
  type StoryEngine,
} from './story-engine.js';
import { buildSceneGenerationContext, buildSceneRegenerationContext } from './scene-context.js';
import type { AiAgent, AiAgentProgress } from './omp-agent.js';
import { SceneEngine } from './scene-engine.js';
import { renderShotPlanningPrompt } from './shot-prompts.js';
import { VisualConsistencyService, createVisualConsistencyService } from './visual-service.js';
import { ImageGenerationService, createImageGenerationService } from './image-service.js';
import { SceneVideoService, createSceneVideoService } from './video-service.js';
import { imageCandidateCount, imageConditioningModeForShot } from './quality-policy.js';
import { ShotDirector } from './shot-director.js';
import { ttsQualityIssues } from './tts-quality.js';
import { VisualReferenceService } from './visual-reference-service.js';
import { ComfyUiImageProvider, ImageProviderError } from './comfyui.js';
export {
  ComfyUiImageProvider,
  ImageGenerationService,
  ImageProviderError,
  SceneEngine,
  ShotDirector,
  VisualReferenceService,
  VisualConsistencyService,
  createImageGenerationService,
  createVisualConsistencyService,
};
import {
  renderArcPlanningPrompt,
  renderBlueprintPrompt,
  renderChapterGenerationV2Prompt,
  renderChapterPlanWindowPrompt,
  renderChapterPlansPrompt,
  renderSummaryCompactionPrompt,
  renderScenePlanningPrompt,
  renderScenePromptRefreshPrompt,
  renderSceneRegenerationPrompt,
} from './story-prompts.js';
import {
  projectVideoRole,
  renderChapterPayloadSchema,
  renderProjectPayloadSchema,
  renderSceneClipPayloadSchema,
  TimelineWorkflowService,
} from './timeline-workflow.js';
import {
  ProductionOrchestrator,
  type ProductionOrchestratorAdapters,
  type ProductionScheduledWork,
  type ProductionStageInspection,
} from './production-orchestrator.js';
import { ProductionPreflightService } from './production-planning.js';
import { PublicationPackageService } from './publication-package.js';
export {
  imageGenerationFingerprint,
  imageSettingsFingerprint,
  resolveImageSeed,
} from './image-generation.js';
export { projectVideoRole } from './timeline-workflow.js';
export { SceneVideoService, createSceneVideoService } from './video-service.js';
export { ProductionOrchestrator } from './production-orchestrator.js';
export type {
  ProductionAdvanceRequest,
  ProductionOrchestratorAdapters,
  ProductionOrchestratorOptions,
  ProductionScheduledWork,
  ProductionStageAdapter,
  ProductionStageInspection,
  ProductionStatus,
} from './production-orchestrator.js';
export { PublicationPackageService } from './publication-package.js';
export type StudioContext = {
  database: DatabaseHandle;
  workspace: WorkspacePaths;
  media: FfmpegTools;
  runner: ProcessRunner;
};
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class StudioService {
  readonly projects: ProjectRepository;
  readonly chapters: ChapterRepository;
  readonly story: StoryRepository;
  readonly scenes: SceneRepository;
  readonly shotPlans: ShotPlanRepository;
  readonly batches: StoryBatchRepository;
  readonly workflow: WorkflowRepository;
  readonly assets: AssetRepository;
  readonly visualProfiles: VisualProfileRepository;
  readonly sceneObjectResolutions: SceneObjectResolutionRepository;
  readonly visualPackages: VisualPromptPackageRepository;
  readonly visual: VisualConsistencyService;
  readonly images: ImageGenerationService;
  readonly videos: SceneVideoService;
  readonly visualReferences: VisualReferenceService;
  readonly timeline: TimelineWorkflowService;
  readonly publication: PublicationPackageService;
  readonly production: ProductionOrchestrator;
  constructor(
    private readonly context: StudioContext,
    agent?: AiAgent,
  ) {
    this.projects = new ProjectRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.story = new StoryRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.shotPlans = new ShotPlanRepository(context.database);
    this.batches = new StoryBatchRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.visualProfiles = new VisualProfileRepository(context.database);
    this.sceneObjectResolutions = new SceneObjectResolutionRepository(context.database);
    this.visualPackages = new VisualPromptPackageRepository(context.database);
    this.visual = new VisualConsistencyService(
      this.scenes,
      this.chapters,
      this.story,
      this.visualProfiles,
      this.sceneObjectResolutions,
      this.visualPackages,
      this.assets,
      new ShotPlanRepository(context.database),
      new AppearanceStageRepository(context.database),
      new VisualReferenceGenerationRepository(context.database),
    );
    this.images = createImageGenerationService(context, undefined, agent);
    this.videos = createSceneVideoService(context, undefined, agent);
    this.visualReferences = new VisualReferenceService(context);
    this.timeline = new TimelineWorkflowService(context);
    this.publication = new PublicationPackageService(context);
    const preflight = new ProductionPreflightService(context, {
      image: async (projectId) => {
        const readiness = await this.images.readiness(projectId);
        return {
          ready: readiness.status === 'READY',
          message: readiness.message,
          status: readiness.status,
        };
      },
      aiVideo: async (projectId) => {
        const readiness = await this.videos.readiness(projectId);
        return {
          ready: readiness.status === 'READY',
          message: readiness.message,
          status: readiness.status,
        };
      },
      aiVideoBackend: async (projectId, backend) => {
        const readiness = await this.videos.readinessForBackend(projectId, backend);
        return {
          ready: readiness.status === 'READY',
          message: readiness.message,
          status: readiness.status,
        };
      },
    });
    this.production = new ProductionOrchestrator(context, this.productionAdapters(), preflight, {
      timeline: this.timeline,
    });
  }
  private productionChapterRows(
    run: ProductionRunRecord,
    limit = 100,
  ): Array<{ id: Id; number: number }> {
    const filters = ['c.project_id=?', "c.status='ACTIVE'"];
    const parameters: Array<string | number> = [run.projectId];
    if (run.scope.type === 'CHAPTER_RANGE') {
      filters.push('c.number BETWEEN ? AND ?');
      parameters.push(run.scope.startChapter, run.scope.endChapter);
    }
    return this.context.database.sqlite
      .prepare(
        `SELECT c.id,c.number FROM chapters c WHERE ${filters.join(' AND ')}
         ORDER BY c.number LIMIT ?`,
      )
      .all(...parameters, Math.max(1, Math.min(100, limit))) as Array<{ id: Id; number: number }>;
  }

  private productionSceneRows(
    run: ProductionRunRecord,
    limit = 100,
  ): Array<{ id: Id; chapterId: Id; stableId: string }> {
    const filters = ['s.project_id=?', "s.status='CURRENT'", 's.is_current=1', 'p.is_current=1'];
    const parameters: Array<string | number> = [run.projectId];
    if (run.scope.type === 'CHAPTER_RANGE') {
      filters.push('c.number BETWEEN ? AND ?');
      parameters.push(run.scope.startChapter, run.scope.endChapter);
    }
    return this.context.database.sqlite
      .prepare(
        `SELECT s.id,s.chapter_id as chapterId,s.stable_id as stableId
         FROM scene_revisions s
         JOIN chapters c ON c.id=s.chapter_id
         JOIN scene_plan_revisions p ON p.id=s.scene_plan_revision_id
         WHERE ${filters.join(' AND ')}
         ORDER BY c.number,s.scene_number LIMIT ?`,
      )
      .all(...parameters, Math.max(1, Math.min(100, limit))) as Array<{
      id: Id;
      chapterId: Id;
      stableId: string;
    }>;
  }
  private productionShotRows(
    run: ProductionRunRecord,
    limit = 500,
  ): Array<{
    sceneId: Id;
    sceneStableId: string;
    shotPlanId: Id;
    shotPlanRevision: number;
    shotId: string;
    ordinal: number;
    shot: Shot;
  }> {
    const rows: Array<{
      sceneId: Id;
      sceneStableId: string;
      shotPlanId: Id;
      shotPlanRevision: number;
      shotId: string;
      ordinal: number;
      shot: Shot;
    }> = [];
    for (const scene of this.productionSceneRows(run)) {
      const plan = this.shotPlans.getCurrent(run.projectId, scene.id);
      if (!plan || plan.reviewStatus !== 'APPROVED') continue;
      for (const shot of plan.candidate.shots) {
        rows.push({
          sceneId: scene.id,
          sceneStableId: scene.stableId,
          shotPlanId: plan.id,
          shotPlanRevision: plan.revision,
          shotId: shot.id,
          ordinal: shot.ordinal,
          shot,
        });
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  private productionActiveSteps(
    entityId: Id,
    types: string[],
  ): Array<{
    stepId: Id;
    entityId: Id;
    type: string;
    inputFingerprint: string;
  }> {
    if (!types.length) return [];
    const placeholders = types.map(() => '?').join(',');
    return this.context.database.sqlite
      .prepare(
        `SELECT id as stepId,entity_id as entityId,type,input_fingerprint as inputFingerprint
         FROM workflow_steps WHERE entity_id=? AND type IN (${placeholders})
         AND status IN ('PENDING','RUNNING') ORDER BY created_at LIMIT 100`,
      )
      .all(entityId, ...types) as Array<{
      stepId: Id;
      entityId: Id;
      type: string;
      inputFingerprint: string;
    }>;
  }
  private productionActiveShotSteps(
    entityId: Id,
    type: 'BUILD_VISUAL_PROMPT' | 'GENERATE_SHOT_IMAGE' | 'GENERATE_AI_SHOT_VIDEO',
  ): Array<{
    stepId: Id;
    entityId: Id;
    type: string;
    inputFingerprint: string;
    shotId: string;
  }> {
    return this.context.database.sqlite
      .prepare(
        `SELECT ws.id as stepId,ws.entity_id as entityId,ws.type,
          ws.input_fingerprint as inputFingerprint,
          json_extract(ws.payload,'$.shotId') as shotId
         FROM workflow_steps ws
         WHERE ws.entity_id=? AND ws.type=? AND ws.status IN ('PENDING','RUNNING')
           AND json_extract(ws.payload,'$.shotId') IS NOT NULL
         ORDER BY ws.created_at LIMIT 100`,
      )
      .all(entityId, type) as Array<{
      stepId: Id;
      entityId: Id;
      type: string;
      inputFingerprint: string;
      shotId: string;
    }>;
  }
  private productionActiveSceneSteps(
    entityId: Id,
    type: 'BUILD_VISUAL_PROMPT' | 'GENERATE_SCENE_IMAGE' | 'GENERATE_AI_SCENE_VIDEO',
  ): Array<{
    stepId: Id;
    entityId: Id;
    type: string;
    inputFingerprint: string;
  }> {
    return this.context.database.sqlite
      .prepare(
        `SELECT ws.id as stepId,ws.entity_id as entityId,ws.type,
          ws.input_fingerprint as inputFingerprint
         FROM workflow_steps ws
         WHERE ws.entity_id=? AND ws.type=? AND ws.status IN ('PENDING','RUNNING')
           AND json_extract(ws.payload,'$.shotId') IS NULL
         ORDER BY ws.created_at LIMIT 100`,
      )
      .all(entityId, type) as Array<{
      stepId: Id;
      entityId: Id;
      type: string;
      inputFingerprint: string;
    }>;
  }

  private productionStepsForExecution(
    executionId: Id,
    excludedTypes: string[] = [],
  ): Array<{
    stepId: Id;
    entityId: Id;
    type: string;
    inputFingerprint: string;
  }> {
    const clause = excludedTypes.length
      ? ` AND type NOT IN (${excludedTypes.map(() => '?').join(',')})`
      : '';
    return this.context.database.sqlite
      .prepare(
        `SELECT id as stepId,entity_id as entityId,type,input_fingerprint as inputFingerprint
         FROM workflow_steps WHERE execution_id=?${clause} ORDER BY created_at LIMIT 100`,
      )
      .all(executionId, ...excludedTypes) as Array<{
      stepId: Id;
      entityId: Id;
      type: string;
      inputFingerprint: string;
    }>;
  }

  private productionWork(
    step: { stepId: Id; entityId: Id; type: string; inputFingerprint: string },
    unitKey: string,
    classification: ProductionScheduledWork['classification'] = 'BUILD',
  ): ProductionScheduledWork {
    return {
      stepId: step.stepId,
      unitKey,
      entityId: step.entityId,
      classification,
      inputFingerprint: step.inputFingerprint,
      summary: { workflowType: step.type },
    };
  }

  private productionJobWork(
    jobId: Id,
    unitKey: string,
    classification: ProductionScheduledWork['classification'] = 'BUILD',
  ): ProductionScheduledWork {
    const step = this.context.database.sqlite
      .prepare(
        `SELECT ws.id as stepId,ws.entity_id as entityId,ws.type,
          ws.input_fingerprint as inputFingerprint FROM jobs j
         JOIN workflow_steps ws ON ws.id=j.step_id WHERE j.id=?`,
      )
      .get(jobId) as
      { stepId: Id; entityId: Id; type: string; inputFingerprint: string } | undefined;
    if (!step) throw new AppError('NOT_FOUND', 'Scheduled workflow step not found', 500);
    return this.productionWork(step, unitKey, classification);
  }
  private async productionVideoBackend(
    run: ProductionRunRecord,
  ): Promise<{ backend: VideoBackend | undefined; fallbackUsed: boolean }> {
    const settings = this.production.profiles.get(run.profileId)?.settings;
    if (!settings) return { backend: undefined, fallbackUsed: false };
    const preferred = settings.videoBackendPreference;
    const preferredReadiness = await this.videos.readinessForBackend(run.projectId, preferred);
    if (preferredReadiness.status === 'READY') return { backend: preferred, fallbackUsed: false };
    const fallback = settings.allowedVideoFallback;
    if (fallback !== 'NONE' && fallback !== preferred) {
      const fallbackReadiness = await this.videos.readinessForBackend(run.projectId, fallback);
      if (fallbackReadiness.status === 'READY') return { backend: fallback, fallbackUsed: true };
    }
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      `No allowed video backend is ready for this production run (${preferredReadiness.status})`,
      503,
      true,
    );
  }

  private productionScopeRequest(run: ProductionRunRecord): RenderRequest {
    const profile = this.production.profiles.get(run.profileId);
    return renderRequestSchema.parse({
      source: 'SCENES',
      scope:
        run.scope.type === 'FULL_PROJECT'
          ? { kind: 'FULL_STORY' }
          : {
              kind: 'CHAPTER_RANGE',
              startChapterNumber: run.scope.startChapter,
              endChapterNumber: run.scope.endChapter,
            },
      autoBuild: false,
      // Ken Burns is the AI-motion fallback; RenderRequest fallbackPolicy only accepts image fallback modes.
      fallbackPolicy: 'FAIL',
      qualityPreset: profile?.settings.renderQualityPreset,
    });
  }

  private productionAiScenes(run: ProductionRunRecord): Array<{ id: Id; stableId: string }> {
    const settings = this.production.profiles.get(run.profileId)?.settings;
    if (!settings || settings.aiMotionPolicy === 'OFF') return [];
    const { aiMotionPolicy, aiPriorityThreshold, maxAiVideoScenes } = settings;
    const rank: Record<string, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
    const scenes = this.productionSceneRows(run).filter((scene) => {
      const shotPlan = this.shotPlans.getCurrent(run.projectId, scene.id);
      if (shotPlan?.reviewStatus === 'APPROVED') return true;
      const source = this.videos.getMotionSource(run.projectId, scene.id);
      if (source === 'KEN_BURNS') return false;
      if (aiMotionPolicy === 'SELECTED_ONLY' || aiMotionPolicy === 'ALL_ELIGIBLE') return true;
      const priority =
        this.videos.getMotionPlan(run.projectId, scene.id)?.intent.priority ?? 'NONE';
      return (rank[priority] ?? 0) >= (rank[aiPriorityThreshold] ?? 0);
    });
    return scenes.slice(0, maxAiVideoScenes);
  }

  private productionAdapters(): ProductionOrchestratorAdapters {
    return {
      STORY: {
        inspect: (run): ProductionStageInspection => {
          const settings = this.story.getSettings(run.projectId);
          const blueprint = this.story.getBlueprint(run.projectId);
          const profile = this.production?.profiles.get(run.profileId);
          if (!settings)
            return {
              decision: 'BLOCKED',
              message: 'Story settings are required before the Story stage can run',
              blockers: ['Configure Story settings'],
            };
          if (!blueprint)
            return { decision: 'BUILD', message: 'Story blueprint requires generation' };
          if (profile?.settings.requireStoryApproval)
            return {
              decision: 'REVIEW',
              message: 'The current Story blueprint requires approval',
              blockers: ['Approve the current Story blueprint'],
            };
          return {
            decision: 'REUSE',
            current: true,
            message: 'Current Story checkpoint is reusable',
          };
        },
        schedule: (run) => {
          const active = this.productionActiveSteps(run.projectId, ['GENERATE_STORY_BLUEPRINT']);
          if (active.length) return [this.productionWork(active[0]!, 'story:blueprint')];
          const result = this.scheduleStoryBlueprint(run.projectId);
          return [this.productionJobWork(result.jobId, 'story:blueprint')];
        },
      },
      CHAPTERS: {
        inspect: (run): ProductionStageInspection => {
          const chapters = this.productionChapterRows(run);
          return chapters.length
            ? {
                decision: 'REUSE',
                current: true,
                message: 'Current Chapter content is canonical input',
                progress: { current: chapters.length, total: chapters.length },
              }
            : {
                decision: 'BLOCKED',
                message: 'At least one Chapter is required',
                blockers: ['Create or generate a Chapter'],
              };
        },
      },
      AUDIO: {
        inspect: (run): ProductionStageInspection => {
          const chapters = this.productionChapterRows(run);
          const missing = chapters.filter(
            (chapter) =>
              !this.assets.current(run.projectId, `chapter:${chapter.id}:audio`) ||
              !this.assets.current(run.projectId, `chapter:${chapter.id}:subtitle`),
          );
          return {
            decision: missing.length ? 'BUILD' : 'REUSE',
            current: missing.length === 0,
            message: missing.length
              ? `${missing.length} Chapter audio units require work`
              : 'Current audio and subtitles are reusable',
            progress: { current: chapters.length - missing.length, total: chapters.length },
          };
        },
        schedule: (run, _stage, limit) => {
          const output: ProductionScheduledWork[] = [];
          for (const chapter of this.productionChapterRows(run, limit)) {
            const audio = this.assets.current(run.projectId, `chapter:${chapter.id}:audio`);
            const subtitle = this.assets.current(run.projectId, `chapter:${chapter.id}:subtitle`);
            const active = this.productionActiveSteps(chapter.id, [
              'TTS_SEGMENT',
              'MERGE_AUDIO',
              'SUBTITLE',
            ]);
            if (audio && !subtitle) {
              const subtitleStep = active.find((step) => step.type === 'SUBTITLE');
              if (subtitleStep)
                output.push(this.productionWork(subtitleStep, `audio:${chapter.id}:subtitle`));
              else
                output.push(
                  this.productionJobWork(
                    this.scheduleSubtitle(chapter.id),
                    `audio:${chapter.id}:subtitle`,
                  ),
                );
              continue;
            }
            if (active.length) {
              output.push(
                ...active.map((step) =>
                  this.productionWork(step, `audio:${chapter.id}:${step.type}`),
                ),
              );
              continue;
            }
            const tts = this.scheduleChapterTts(chapter.id);
            output.push(
              ...this.productionStepsForExecution(tts.executionId, ['CLEAN_TEXT']).map((step) =>
                this.productionWork(step, `audio:${chapter.id}:${step.type}`),
              ),
            );
            output.push(
              this.productionJobWork(
                this.scheduleSubtitle(chapter.id),
                `audio:${chapter.id}:subtitle`,
              ),
            );
          }
          return output;
        },
      },
      SCENES: {
        inspect: (run): ProductionStageInspection => {
          const chapters = this.productionChapterRows(run);
          const missing = chapters.filter((chapter) => {
            const plan = this.scenes.getScenePlan(chapter.id);
            return !plan || plan.status !== 'CURRENT' || plan.sceneCount === 0;
          });
          return {
            decision: missing.length ? 'BUILD' : 'REUSE',
            current: missing.length === 0,
            message: missing.length
              ? `${missing.length} Chapter Scene plans require work`
              : 'Current Scene plans are reusable',
            progress: { current: chapters.length - missing.length, total: chapters.length },
          };
        },
        schedule: (run, _stage, limit) => {
          const output: ProductionScheduledWork[] = [];
          for (const chapter of this.productionChapterRows(run, limit)) {
            const plan = this.scenes.getScenePlan(chapter.id);
            if (plan?.status === 'CURRENT' && plan.sceneCount > 0) continue;
            const active = this.productionActiveSteps(chapter.id, ['GENERATE_SCENES']);
            if (active.length) output.push(this.productionWork(active[0]!, `scenes:${chapter.id}`));
            else {
              const result = this.scheduleSceneGeneration(run.projectId, chapter.id);
              output.push(this.productionJobWork(result.jobId, `scenes:${chapter.id}`));
            }
          }
          return output;
        },
      },
      VISUAL_PROFILES: {
        inspect: (run): ProductionStageInspection => {
          const blueprint = this.story.getBlueprint(run.projectId);
          const profile = this.production.profiles.get(run.profileId);
          const characters = blueprint?.blueprint.characters ?? [];
          const locations = this.scenes.listLocations(run.projectId, 100, 0);
          const missing = [
            ...characters.filter(
              (character) => !this.visualProfiles.getCharacter(run.projectId, character.id),
            ),
            ...locations.filter(
              (location) => !this.visualProfiles.getLocation(run.projectId, location.id),
            ),
          ];
          if (missing.length)
            return {
              decision: 'BUILD',
              message: `${missing.length} visual profiles require work`,
              progress: {
                current: characters.length + locations.length - missing.length,
                total: characters.length + locations.length,
              },
            };
          const review = [
            ...characters.filter(
              (character) =>
                this.visualProfiles.getCharacter(run.projectId, character.id)?.status !==
                'APPROVED',
            ),
            ...locations.filter(
              (location) =>
                this.visualProfiles.getLocation(run.projectId, location.id)?.status !== 'APPROVED',
            ),
          ];
          if (review.length)
            return {
              decision: 'REVIEW',
              message: `${review.length} visual profiles require approval`,
              blockers: ['Approve the current visual profiles'],
            };
          const missingReferences = profile?.settings.requireReferenceApproval
            ? characters.filter((character) => {
                const visual = this.visualProfiles.getCharacter(run.projectId, character.id);
                return visual?.payload.referenceAssetIds.length === 0;
              })
            : [];
          if (missingReferences.length)
            return {
              decision: 'BLOCKED',
              message: `${missingReferences.length} character references are required`,
              blockers: missingReferences.map(
                (character) => `Add an approved reference for ${character.name}`,
              ),
            };
          return {
            decision: 'REUSE',
            current: true,
            message: 'Current visual profiles are reusable',
            progress: {
              current: characters.length + locations.length,
              total: characters.length + locations.length,
            },
          };
        },
        schedule: (run, _stage, limit) => {
          const output: ProductionScheduledWork[] = [];
          const blueprint = this.story.getBlueprint(run.projectId);
          for (const character of (blueprint?.blueprint.characters ?? []).slice(0, limit)) {
            if (this.visualProfiles.getCharacter(run.projectId, character.id)) continue;
            const active = this.productionActiveSteps(character.id, [
              'GENERATE_CHARACTER_VISUAL_PROFILE',
            ]);
            if (active.length)
              output.push(this.productionWork(active[0]!, `character:${character.id}`));
            else {
              const result = this.scheduleVisualProfileGeneration(
                run.projectId,
                'CHARACTER',
                character.id,
              );
              output.push(this.productionJobWork(result.jobId, `character:${character.id}`));
            }
            if (output.length >= limit) return output;
          }
          for (const location of this.scenes.listLocations(run.projectId, 100, 0)) {
            if (this.visualProfiles.getLocation(run.projectId, location.id)) continue;
            const active = this.productionActiveSteps(location.id, [
              'GENERATE_LOCATION_VISUAL_PROFILE',
            ]);
            if (active.length)
              output.push(this.productionWork(active[0]!, `location:${location.id}`));
            else {
              const result = this.scheduleVisualProfileGeneration(
                run.projectId,
                'LOCATION',
                location.id,
              );
              output.push(this.productionJobWork(result.jobId, `location:${location.id}`));
            }
            if (output.length >= limit) break;
          }
          return output;
        },
      },
      VISUAL_PROMPTS: {
        inspect: (run): ProductionStageInspection => {
          const scenes = this.productionSceneRows(run);
          const shots = this.productionShotRows(run);
          const missingScenes = scenes.filter((scene) => {
            const packageDto = this.visualPackages.getCurrent(run.projectId, scene.id);
            return (
              !packageDto || packageDto.status !== 'CURRENT' || packageDto.payload.shotId !== null
            );
          });
          const missingShots = shots.filter((shot) => {
            const packageDto = this.visualPackages.getCurrent(
              run.projectId,
              shot.sceneId,
              shot.shotId,
            );
            return (
              !packageDto ||
              packageDto.status !== 'CURRENT' ||
              packageDto.payload.shotId !== shot.shotId ||
              packageDto.payload.shotPlanId !== shot.shotPlanId
            );
          });
          const missing = missingScenes.length + missingShots.length;
          const total = scenes.length + shots.length;
          return {
            decision: missing ? 'BUILD' : 'REUSE',
            current: missing === 0,
            message: missing
              ? `${missing} Visual Prompt Packages require work`
              : 'Current Visual Prompt Packages are reusable',
            progress: { current: total - missing, total },
          };
        },
        schedule: (run, _stage, limit) => {
          const scenes = this.productionSceneRows(run);
          const shots = this.productionShotRows(run);
          const sceneWork = scenes
            .filter((scene) => {
              const packageDto = this.visualPackages.getCurrent(run.projectId, scene.id);
              return (
                !packageDto || packageDto.status !== 'CURRENT' || packageDto.payload.shotId !== null
              );
            })
            .map((scene) => ({ kind: 'SCENE' as const, scene }));
          const shotWork = shots
            .filter((shot) => {
              const packageDto = this.visualPackages.getCurrent(
                run.projectId,
                shot.sceneId,
                shot.shotId,
              );
              return (
                !packageDto ||
                packageDto.status !== 'CURRENT' ||
                packageDto.payload.shotId !== shot.shotId ||
                packageDto.payload.shotPlanId !== shot.shotPlanId
              );
            })
            .map((shot) => ({ kind: 'SHOT' as const, shot }));
          const work = [...sceneWork, ...shotWork].slice(0, limit);
          if (!work.length) return [];
          const active = work.flatMap((item) =>
            item.kind === 'SCENE'
              ? this.productionActiveSceneSteps(item.scene.id, 'BUILD_VISUAL_PROMPT').map(
                  (step) => ({
                    ...step,
                    unitKey: `prompt:${item.scene.stableId}`,
                  }),
                )
              : this.productionActiveShotSteps(item.shot.sceneId, 'BUILD_VISUAL_PROMPT').map(
                  (step) => ({
                    ...step,
                    unitKey: `prompt:${item.shot.sceneStableId}:shot:${step.shotId}`,
                  }),
                ),
          );
          if (active.length)
            return active.slice(0, limit).map((step) => this.productionWork(step, step.unitKey));
          return work.map((item) => {
            if (item.kind === 'SCENE') {
              const result = this.scheduleVisualPromptBuild(run.projectId, item.scene.id);
              return this.productionJobWork(result.jobId, `prompt:${item.scene.stableId}`);
            }
            const result = this.scheduleShotVisualPromptBuild(
              run.projectId,
              item.shot.sceneId,
              item.shot.shotId,
            );
            return this.productionJobWork(
              result.jobId,
              `prompt:${item.shot.sceneStableId}:shot:${item.shot.shotId}`,
            );
          });
        },
      },
      SCENE_IMAGES: {
        inspect: (run): ProductionStageInspection => {
          const settings = this.production.profiles.get(run.profileId)?.settings;
          const requireImageApproval = settings ? Boolean(settings.requireImageApproval) : true;
          const qualityFallback = settings?.qualityFallback ?? 'MANUAL_REVIEW';
          const reviewDecision = qualityFallback === 'BLOCK' ? 'BLOCKED' : 'REVIEW';
          const latestImage = (sceneId: Id, sceneStableId: string, shotId: string | null) =>
            this.images.getCurrentGeneration(run.projectId, sceneId, shotId) ??
            this.images.listGenerations(run.projectId, sceneId, 1, 0, shotId)[0] ??
            null;
          const imageNeedsReview = (
            generation: ReturnType<ImageGenerationService['getCurrentGeneration']>,
          ): boolean => {
            if (
              !generation ||
              generation.status !== 'COMPLETED' ||
              generation.freshness !== 'CURRENT'
            )
              return false;
            const retryCount =
              typeof generation.metadata.retryCount === 'number' &&
              Number.isInteger(generation.metadata.retryCount)
                ? generation.metadata.retryCount
                : 0;
            return (
              (requireImageApproval && generation.reviewStatus === 'UNREVIEWED') ||
              generation.automaticQualityStatus === 'UNAVAILABLE' ||
              generation.automaticQualityStatus === 'MANUAL_REVIEW_REQUIRED' ||
              (generation.automaticQualityStatus === 'REJECTED' &&
                retryCount >= (settings?.imageRegenerationLimit ?? 2))
            );
          };
          const scenes = this.productionSceneRows(run);
          const shots = this.productionShotRows(run);
          const shotSceneIds = new Set(shots.map((shot) => shot.sceneId));
          const sceneTargets = scenes.filter((scene) => !shotSceneIds.has(scene.id));
          const missingScenes = sceneTargets.filter(
            (scene) =>
              !this.assets.currentRenderableSceneImage(run.projectId, scene.stableId, {
                requireApproval: requireImageApproval,
              }),
          );
          const missingShots = shots.filter(
            (shot) =>
              !this.assets.currentRenderableShotImage(
                run.projectId,
                shot.sceneStableId,
                shot.shotId,
                { requireApproval: requireImageApproval },
              ),
          );
          const reviewScenes = sceneTargets.filter((scene) =>
            imageNeedsReview(latestImage(scene.id, scene.stableId, null)),
          );
          const reviewShots = shots.filter((shot) =>
            imageNeedsReview(latestImage(shot.sceneId, shot.sceneStableId, shot.shotId)),
          );
          const missing = missingScenes.length + missingShots.length;
          const review = reviewScenes.length + reviewShots.length;
          const total = sceneTargets.length + shots.length;
          return {
            decision: review ? reviewDecision : missing ? 'BUILD' : 'REUSE',
            current: missing === 0 && review === 0,
            message: review
              ? `${review} image outputs require review or intervention`
              : missing
                ? `${missing} Scene or Shot images require generation or upload`
                : 'Current Scene and Shot images are reusable',
            blockers: review
              ? [
                  ...reviewScenes.map((scene) => `Scene ${scene.stableId}`),
                  ...reviewShots.map((shot) => `Shot ${shot.shotId}`),
                ].slice(0, 100)
              : undefined,
            progress: { current: total - missing, total },
          };
        },
        schedule: (run, _stage, limit) => {
          const settings = this.production.profiles.get(run.profileId)?.settings;
          const requireImageApproval = settings ? Boolean(settings.requireImageApproval) : true;
          const scenes = this.productionSceneRows(run);
          const shots = this.productionShotRows(run);
          const shotSceneIds = new Set(shots.map((shot) => shot.sceneId));
          const sceneWork = scenes
            .filter(
              (scene) =>
                !shotSceneIds.has(scene.id) &&
                !this.assets.currentRenderableSceneImage(run.projectId, scene.stableId, {
                  requireApproval: requireImageApproval,
                }),
            )
            .map((scene) => ({ kind: 'SCENE' as const, scene }));
          const shotWork = shots
            .filter(
              (shot) =>
                !this.assets.currentRenderableShotImage(
                  run.projectId,
                  shot.sceneStableId,
                  shot.shotId,
                  { requireApproval: requireImageApproval },
                ),
            )
            .map((shot) => ({ kind: 'SHOT' as const, shot }));
          const work = [...sceneWork, ...shotWork].slice(0, limit);
          if (!work.length) return [];
          const active = work.flatMap((item) =>
            item.kind === 'SCENE'
              ? this.productionActiveSceneSteps(item.scene.id, 'GENERATE_SCENE_IMAGE').map(
                  (step) => ({
                    ...step,
                    unitKey: `image:${item.scene.stableId}`,
                  }),
                )
              : this.productionActiveShotSteps(item.shot.sceneId, 'GENERATE_SHOT_IMAGE').map(
                  (step) => ({
                    ...step,
                    unitKey: `image:${item.shot.sceneStableId}:shot:${step.shotId}`,
                  }),
                ),
          );
          if (active.length)
            return active.slice(0, limit).map((step) => this.productionWork(step, step.unitKey));
          return work.map((item) => {
            if (item.kind === 'SCENE') {
              const result = this.images.scheduleBatch(run.projectId, {
                sceneIds: [item.scene.id],
                candidateCount: settings ? imageCandidateCount(settings) : 1,
                includeStale: false,
                qualityThreshold: settings?.imageAutoAcceptThreshold,
                qualityRetryLimit: settings?.imageRegenerationLimit,
              });
              const job = result.jobs[0];
              if (!job?.stepId)
                throw new AppError('WORKFLOW_ERROR', 'Scene image scheduling produced no job', 500);
              return this.productionWork(
                {
                  stepId: job.stepId,
                  entityId: job.generation.id,
                  type: 'GENERATE_SCENE_IMAGE',
                  inputFingerprint: job.generation.inputFingerprint ?? job.generation.id,
                },
                `image:${item.scene.stableId}`,
              );
            }
            const result = this.images.scheduleShot(
              run.projectId,
              item.shot.sceneId,
              item.shot.shotId,
              {
                candidateCount: settings ? imageCandidateCount(settings, item.shot.shot) : 1,
                conditioningMode: settings
                  ? imageConditioningModeForShot(settings, item.shot.shot)
                  : undefined,
                qualityThreshold: settings?.imageAutoAcceptThreshold,
                qualityRetryLimit: settings?.imageRegenerationLimit,
              },
            );
            if (!result.stepId)
              throw new AppError('WORKFLOW_ERROR', 'Shot image scheduling produced no step', 500);
            return this.productionWork(
              {
                stepId: result.stepId,
                entityId: result.generation.id,
                type: 'GENERATE_SHOT_IMAGE',
                inputFingerprint: result.generation.inputFingerprint ?? result.generation.id,
              },
              `image:${item.shot.sceneStableId}:shot:${item.shot.shotId}`,
            );
          });
        },
      },
      AI_MOTION: {
        inspect: (run): ProductionStageInspection => {
          const settings = this.production.profiles.get(run.profileId)?.settings;
          const requireMotionApproval = settings ? Boolean(settings.requireQualityReview) : true;
          const matchesConfiguredBackend = (
            generation: { backend?: VideoBackend } | null | undefined,
          ): boolean =>
            !settings ||
            (generation !== null &&
              generation !== undefined &&
              generation.backend === settings.videoBackendPreference);
          const scenes = this.productionAiScenes(run);
          const shotRows = this.productionShotRows(run).filter((shot) =>
            scenes.some((scene) => scene.id === shot.sceneId),
          );
          const temporalRetryLimit = settings?.temporalRetryLimit ?? 2;
          const reviewDecision = settings?.qualityFallback === 'BLOCK' ? 'BLOCKED' : 'REVIEW';
          const latestSceneVideo = (sceneId: Id) =>
            this.videos.getCurrentGeneration(run.projectId, sceneId) ??
            this.videos.listGenerations(run.projectId, sceneId, 1, 0)[0] ??
            null;
          const latestShotVideo = (shot: (typeof shotRows)[number]) =>
            this.videos.getCurrentShotGeneration(run.projectId, shot.sceneId, shot.shotId) ??
            this.videos.listShotGenerations(run.projectId, shot.sceneId, shot.shotId, 1, 0)[0] ??
            null;
          const temporalNeedsReview = (
            generation: ReturnType<SceneVideoService['getCurrentGeneration']>,
          ): boolean => {
            if (
              !generation ||
              generation.status !== 'COMPLETED' ||
              generation.freshness !== 'CURRENT' ||
              generation.reviewStatus === 'ACCEPTED'
            )
              return false;
            const retryCount =
              typeof generation.metadata.retryCount === 'number' &&
              Number.isInteger(generation.metadata.retryCount)
                ? generation.metadata.retryCount
                : 0;
            return (
              (requireMotionApproval && generation.reviewStatus === 'UNREVIEWED') ||
              generation.automaticQualityStatus === 'UNAVAILABLE' ||
              generation.automaticQualityStatus === 'MANUAL_REVIEW_REQUIRED' ||
              generation.automaticQualityStatus === 'NOT_RUN' ||
              (generation.automaticQualityStatus === 'REJECTED' && retryCount >= temporalRetryLimit)
            );
          };
          const shotNeedsReview = (shot: (typeof shotRows)[number]): boolean => {
            const generation = latestShotVideo(shot);
            return matchesConfiguredBackend(generation) && temporalNeedsReview(generation);
          };
          const shotSceneIds = new Set(shotRows.map((shot) => shot.sceneId));
          const sceneRows = scenes.filter((scene) => !shotSceneIds.has(scene.id));
          const allScenes = this.productionSceneRows(run);
          const selected = new Set(scenes.map((scene) => scene.id));
          const fallbacks = settings?.allowKenBurnsFallback
            ? allScenes
                .filter((scene) => !selected.has(scene.id))
                .map((scene) => `motion:${scene.stableId}:KEN_BURNS:policy`)
            : [];
          const sceneReview = sceneRows.filter((scene) => {
            const generation = latestSceneVideo(scene.id);
            return matchesConfiguredBackend(generation) && temporalNeedsReview(generation);
          });
          const sceneRejectedOrFailed = sceneRows.filter((scene) => {
            const generation = this.videos.getCurrentGeneration(run.projectId, scene.id);
            return (
              generation &&
              (generation.reviewStatus === 'REJECTED' ||
                generation.status === 'FAILED' ||
                generation.status === 'CANCELLED')
            );
          });
          if (settings?.allowKenBurnsFallback)
            fallbacks.push(
              ...sceneRejectedOrFailed.map(
                (scene) => `motion:${scene.stableId}:KEN_BURNS:provider_or_review_failure`,
              ),
            );
          const missingScene = sceneRows.filter((scene) => {
            const generation = this.videos.getCurrentGeneration(run.projectId, scene.id);
            const fallback =
              settings?.allowKenBurnsFallback &&
              generation &&
              (generation.reviewStatus === 'REJECTED' ||
                generation.status === 'FAILED' ||
                generation.status === 'CANCELLED');
            const accepted = Boolean(
              matchesConfiguredBackend(generation) &&
              this.videos.getCurrentRenderableGeneration(run.projectId, scene.id, {
                requireApproval: requireMotionApproval,
                requireQualityPass: settings?.videoQualityGate !== 'DISABLED',
              }),
            );
            return !accepted && !fallback;
          });
          const missingShots = shotRows.filter((shot) => {
            const renderable = this.videos.getCurrentRenderableShotVideo(
              run.projectId,
              shot.sceneId,
              shot.shotId,
              {
                requireApproval: requireMotionApproval,
                requireQualityPass: settings?.videoQualityGate !== 'DISABLED',
              },
            );
            return !renderable || !matchesConfiguredBackend(renderable.generation);
          });
          const missingImages = shotRows.filter(
            (shot) =>
              !this.assets.currentRenderableShotImage(
                run.projectId,
                shot.sceneStableId,
                shot.shotId,
                { requireApproval: settings ? Boolean(settings.requireImageApproval) : true },
              ),
          );
          if (missingImages.length)
            return {
              decision: 'BLOCKED',
              message: 'Shot motion is blocked by missing quality-approved keyframes',
              blockers: missingImages
                .slice(0, 100)
                .map((shot) => `Shot ${shot.shotId} requires a current accepted image`),
              fallbacks: fallbacks.slice(0, 100),
            };
          if (sceneReview.length)
            return {
              decision: reviewDecision,
              message: `${sceneReview.length} Scene motion clips require review`,
              blockers: ['Accept the current AI motion clip before rendering'],
              fallbacks: fallbacks.slice(0, 100),
            };
          const shotReview = shotRows.filter(shotNeedsReview);
          if (shotReview.length)
            return {
              decision: reviewDecision,
              message: `${shotReview.length} Shot motion clips require review`,
              blockers: ['Accept the current AI Shot motion clips before rendering'],
              fallbacks: fallbacks.slice(0, 100),
            };
          const missing = missingScene.length + missingShots.length;
          if (missing === 0)
            return {
              decision: 'REUSE',
              current: true,
              message: 'Accepted Scene and Shot motion is reusable',
              fallbacks: fallbacks.slice(0, 100),
            };
          return {
            decision: 'BUILD',
            message: `${missing} Scene or Shot motion clips require generation`,
            fallbacks: fallbacks.slice(0, 100),
            progress: {
              current: sceneRows.length + shotRows.length - missing,
              total: sceneRows.length + shotRows.length,
            },
          };
        },
        schedule: async (run, _stage, limit) => {
          const settings = this.production.profiles.get(run.profileId)?.settings;
          const requireImageApproval = settings ? Boolean(settings.requireImageApproval) : true;
          const requireHumanApproval = settings ? Boolean(settings.requireQualityReview) : true;
          const qualityPolicy = {
            requireImageApproval,
            requireHumanApproval,
            qualityFallback: settings?.qualityFallback,
            temporalRetryLimit: settings?.temporalRetryLimit,
          };
          const selection = await this.productionVideoBackend(run);
          const backend = selection.backend;
          const fallbackUsed = selection.fallbackUsed;
          const scenes = this.productionAiScenes(run);
          const shotRows = this.productionShotRows(run).filter((shot) =>
            scenes.some((scene) => scene.id === shot.sceneId),
          );
          const shotSceneIds = new Set(shotRows.map((shot) => shot.sceneId));
          const sceneWork = scenes
            .filter((scene) => {
              if (shotSceneIds.has(scene.id)) return false;
              const renderable = this.videos.getCurrentRenderableGeneration(
                run.projectId,
                scene.id,
                {
                  requireApproval: requireHumanApproval,
                  requireQualityPass: settings?.videoQualityGate !== 'DISABLED',
                },
              );
              return (
                !renderable || (backend !== undefined && renderable.generation.backend !== backend)
              );
            })
            .map((scene) => ({ kind: 'SCENE' as const, scene }));
          const shotWork = shotRows
            .filter((shot) => {
              const renderable = this.videos.getCurrentRenderableShotVideo(
                run.projectId,
                shot.sceneId,
                shot.shotId,
                {
                  requireApproval: requireHumanApproval,
                  requireQualityPass: settings?.videoQualityGate !== 'DISABLED',
                },
              );
              return (
                !renderable || (backend !== undefined && renderable.generation.backend !== backend)
              );
            })
            .map((shot) => ({ kind: 'SHOT' as const, shot }));
          const work = [...sceneWork, ...shotWork].slice(0, limit);
          if (!work.length) return [];
          const active = work.flatMap((item) =>
            item.kind === 'SCENE'
              ? this.productionActiveSceneSteps(item.scene.id, 'GENERATE_AI_SCENE_VIDEO').map(
                  (step) => ({
                    ...step,
                    unitKey: `motion:${item.scene.stableId}`,
                  }),
                )
              : this.productionActiveShotSteps(item.shot.sceneId, 'GENERATE_AI_SHOT_VIDEO').map(
                  (step) => ({
                    ...step,
                    unitKey: `motion:${item.shot.sceneStableId}:shot:${step.shotId}`,
                  }),
                ),
          );
          if (active.length)
            return active.slice(0, limit).map((step) => this.productionWork(step, step.unitKey));
          return work.flatMap((item) => {
            if (item.kind === 'SCENE') {
              const result = this.videos.scheduleBatch(
                run.projectId,
                {
                  sceneIds: [item.scene.id],
                  onlyMissing: true,
                },
                backend,
                fallbackUsed,
                qualityPolicy,
              );
              const job = result.jobs[0];
              if (!job?.stepId || !job.jobId) return [];
              return [
                this.productionWork(
                  {
                    stepId: job.stepId,
                    entityId: job.generation.id,
                    type: 'GENERATE_AI_SCENE_VIDEO',
                    inputFingerprint: job.generation.inputFingerprint ?? job.generation.id,
                  },
                  `motion:${item.scene.stableId}`,
                ),
              ];
            }
            const result = this.videos.scheduleShot(
              run.projectId,
              item.shot.sceneId,
              item.shot.shotId,
              {},
              backend,
              fallbackUsed,
              qualityPolicy,
            );
            if (!result.stepId || !result.jobId) return [];
            return [
              this.productionWork(
                {
                  stepId: result.stepId,
                  entityId: result.generation.id,
                  type: 'GENERATE_AI_SHOT_VIDEO',
                  inputFingerprint: result.generation.inputFingerprint ?? result.generation.id,
                },
                `motion:${item.shot.sceneStableId}:shot:${item.shot.shotId}`,
              ),
            ];
          });
        },
      },
      TIMELINE: {
        inspect: (run): ProductionStageInspection => {
          const request = this.productionScopeRequest(run);
          const plan = this.timeline.getRenderPlan(run.projectId, request);
          const buildBlockers = plan.blockers.filter(
            (blocker) =>
              !['TIMING_REQUIRED', 'SCENE_TIMING_REQUIRED', 'MOTION_PLAN_REQUIRED'].includes(
                blocker.code,
              ),
          );
          if (buildBlockers.length)
            return {
              decision: 'BLOCKED',
              message: 'Timeline inputs are not renderable',
              blockers: buildBlockers.map((blocker) => blocker.message),
            };
          const chapters = this.productionChapterRows(run);
          const missing = chapters.some((chapter) => {
            const timing = this.timeline.timeline.getCurrentSceneTiming(chapter.id);
            if (!timing) return true;
            return this.scenes
              .listScenes(chapter.id, 200, 0)
              .some(
                (scene) => !this.timeline.timeline.getCurrentMotionPlan(scene.stableId, scene.id),
              );
          });
          return {
            decision: missing ? 'BUILD' : 'REUSE',
            current: !missing,
            message: missing
              ? 'Scene timing or MotionPlan requires work'
              : 'Current timeline inputs are reusable',
            progress: { current: missing ? 0 : chapters.length, total: chapters.length },
          };
        },
        schedule: (run, _stage, limit) => {
          for (const chapter of this.productionChapterRows(run, limit)) {
            const timing = this.timeline.timeline.getCurrentSceneTiming(chapter.id);
            if (!timing) {
              const result = this.scheduleSceneTiming(chapter.id);
              return [this.productionJobWork(result.jobId, `timeline:${chapter.id}:timing`)];
            }
            const scenes = this.scenes.listScenes(chapter.id, 200, 0);
            const missingMotion = scenes.some(
              (scene) => !this.timeline.timeline.getCurrentMotionPlan(scene.stableId, scene.id),
            );
            if (missingMotion) {
              const result = this.scheduleMotionPlan(chapter.id);
              return [this.productionJobWork(result.jobId, `timeline:${chapter.id}:motion`)];
            }
          }
          return [];
        },
      },
      RENDER: {
        inspect: (run): ProductionStageInspection => {
          const plan = this.timeline.getRenderPlan(run.projectId, this.productionScopeRequest(run));
          return {
            decision: plan.blockers.length ? 'BLOCKED' : plan.project.reusable ? 'REUSE' : 'BUILD',
            current: plan.blockers.length === 0 && plan.project.reusable,
            message: plan.blockers.length
              ? 'Render inputs are incomplete'
              : plan.project.reusable
                ? 'Current project video is reusable'
                : 'Project video requires rendering',
            blockers: plan.blockers.map((blocker) => blocker.message),
          };
        },
        schedule: async (run) => {
          const result = await this.timeline.scheduleRender(
            run.projectId,
            this.productionScopeRequest(run),
          );
          return result.jobIds.map((jobId) => this.productionJobWork(jobId, `render:${jobId}`));
        },
      },
      PUBLICATION_PACKAGE: {
        inspect: (run): ProductionStageInspection => {
          const row = this.context.database.sqlite
            .prepare(
              'SELECT status FROM publication_packages WHERE project_id=? AND run_id=? ORDER BY updated_at DESC LIMIT 1',
            )
            .get(run.projectId, run.id) as { status: string } | undefined;
          if (row?.status === 'READY')
            return {
              decision: 'REUSE',
              current: true,
              message: 'Current publication package is ready',
            };
          if (row?.status === 'INCOMPLETE')
            return {
              decision: 'BLOCKED',
              message: 'Publication package quality gate is incomplete',
              blockers: ['Resolve package validation issues before publishing'],
            };
          return { decision: 'BUILD', message: 'Publication package requires assembly' };
        },
        schedule: (run) => {
          const active = this.productionActiveSteps(run.id, [
            'GENERATE_PUBLICATION_METADATA',
            'BUILD_PUBLICATION_PACKAGE',
          ]);
          if (active.length)
            return active.map((step) => this.productionWork(step, `package:${step.type}`));
          const result = this.publication.scheduleBuild(run.id);
          return result.stepIds.map((stepId) => {
            const step = this.context.database.sqlite
              .prepare(
                'SELECT id as stepId,entity_id as entityId,type,input_fingerprint as inputFingerprint FROM workflow_steps WHERE id=?',
              )
              .get(stepId) as {
              stepId: Id;
              entityId: Id;
              type: string;
              inputFingerprint: string;
            };
            return this.productionWork(step, `package:${step.type}`);
          });
        },
      },
    };
  }
  createProject(input: ProjectInput): ProjectDto {
    return this.projects.create(input);
  }
  listProjects(): ProjectDto[] {
    return this.projects.list();
  }
  getProject(id: Id): ProjectDto | null {
    return this.projects.get(id);
  }
  updateProject(id: Id, input: Partial<ProjectInput>): ProjectDto {
    if (!this.projects.get(id)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.projects.update(id, input);
  }
  deleteProject(id: Id): void {
    if (!this.projects.get(id)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    this.projects.delete(id);
    rmSync(join(this.context.workspace.projects, id), { recursive: true, force: true });
  }
  listChapters(projectId: Id): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.list(projectId);
  }
  getChapter(id: Id): ChapterDto | null {
    return this.chapters.get(id);
  }
  createChapter(projectId: Id, input: ChapterInput): ChapterDto {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.create(projectId, input);
  }
  listChapterPage(
    projectId: Id,
    limit = 25,
    offset = 0,
    search = '',
    status: ChapterStatusFilter | '' = '',
  ): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.chapters.listPage(projectId, limit, offset, search, status);
  }
  updateChapter(id: Id, input: ChapterInput): ChapterDto {
    const current = this.chapters.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const sceneChanged = input.content !== current.content || input.title !== current.title;
    const narrationChanged = input.content !== current.content;
    let chapter: ChapterDto;
    try {
      chapter = this.chapters.update(id, input);
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      throw error;
    }
    if (sceneChanged) {
      if (narrationChanged) this.invalidateChapterDescendants(chapter.projectId, chapter.id);
      this.scenes.markChapterStale(chapter.id);
      this.timeline.timeline.invalidateSceneTiming(chapter.id, 'Chapter content changed');
      this.invalidateSceneWorkflowForChapter(chapter.id);
      this.story.markManualContinuityReview(chapter.projectId, chapter.number);
    }
    return chapter;
  }
  deleteChapter(id: Id): void {
    const chapter = this.chapters.get(id);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    this.chapters.delete(id);
    this.invalidateRender(chapter.projectId);
  }
  reorderChapters(projectId: Id, ids: Id[]): ChapterDto[] {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      return this.chapters.reorder(projectId, ids);
    } catch (error) {
      if (error instanceof Error && error.message === 'Complete chapter ordering is required')
        throw new AppError('INVALID_ORDER', error.message, 400);
      throw error;
    }
  }
  setRenderConfig(projectId: Id, input: unknown): void {
    const current = this.getRenderConfig(projectId);
    const next = renderConfigSchema.parse(input);
    this.projects.setRenderConfig(projectId, next);
    this.invalidateRender(projectId);
    if (JSON.stringify(current) !== JSON.stringify(next))
      this.timeline.invalidateRenderOutputs(projectId);
  }
  getScenePlan(projectId: Id, chapterId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return this.scenes.getScenePlan(chapterId);
  }
  listSceneChapters(projectId: Id, limit = 25, offset = 0, status: SceneStatus | '' = '') {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.scenes.listProjectSceneChapters(projectId, limit, offset, status);
  }

  listScenes(projectId: Id, chapterId: Id, limit = 100, offset = 0, includeExcerpt = false) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return this.scenes.listScenes(chapterId, limit, offset, includeExcerpt);
  }

  getScene(projectId: Id, sceneId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }

  getSceneById(sceneId: Id) {
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }
  getVisualStyle(projectId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.visual.getStyleBible(projectId);
  }
  saveVisualStyle(projectId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const saved = this.visual.saveStyleBible(projectId, input);
    this.invalidateSceneVisualWorkflowForProject(projectId, 'Visual style changed');
    return saved;
  }

  listLocations(projectId: Id, limit = 100, offset = 0) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.scenes.listLocations(projectId, limit, offset);
  }
  createLocation(projectId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      return this.scenes.createLocation(projectId, locationSchema.parse(input));
    } catch (error) {
      if (error instanceof Error && error.message === 'Location name is invalid')
        throw new AppError('INVALID_INPUT', error.message, 400);
      if (
        error instanceof Error &&
        error.message === 'A location with the same normalized name already exists'
      )
        throw new AppError('LOCATION_CONFLICT', error.message, 409);
      throw error;
    }
  }

  updateLocation(projectId: Id, locationId: Id, input: unknown) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    try {
      const saved = this.scenes.updateLocation(
        projectId,
        locationId,
        locationUpdateSchema.parse(input),
      );
      const sceneIds = this.scenes.listCurrentSceneIds(null, projectId, locationId);
      this.workflow.invalidateEntities(
        sceneIds,
        [
          'REGENERATE_SCENE',
          'GENERATE_SCENE_PROMPT',
          'BUILD_VISUAL_PROMPT',
          'GENERATE_SCENE_IMAGE',
        ],
        'Location changed',
      );
      return saved;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      if (error instanceof Error && error.message === 'Location name is invalid')
        throw new AppError('INVALID_INPUT', error.message, 400);
      if (
        error instanceof Error &&
        error.message === 'A location with the same normalized name already exists'
      )
        throw new AppError('LOCATION_CONFLICT', error.message, 409);
      throw error;
    }
  }

  updateScene(projectId: Id, sceneId: Id, input: unknown) {
    const scene = this.getScene(projectId, sceneId);
    try {
      const saved = this.scenes.updateScene(scene.id, sceneEditSchema.parse(input));
      this.workflow.invalidateEntities(
        [scene.id],
        [
          'REGENERATE_SCENE',
          'GENERATE_SCENE_PROMPT',
          'BUILD_VISUAL_PROMPT',
          'GENERATE_SCENE_IMAGE',
        ],
        'Scene changed',
      );
      return saved;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict')
        throw new AppError('REVISION_CONFLICT', error.message, 409);
      if (error instanceof Error && error.message === 'Location match is ambiguous')
        throw new AppError('LOCATION_AMBIGUOUS', error.message, 409);
      throw error;
    }
  }
  private assertSceneSchedulingCurrent(scene: SceneDto): void {
    const chapter = this.chapters.get(scene.chapterId);
    const plan = this.scenes.getScenePlan(scene.chapterId);
    if (
      !chapter ||
      chapter.revision !== scene.chapterRevision ||
      scene.status !== 'CURRENT' ||
      plan?.status !== 'CURRENT'
    )
      throw new AppError(
        'STALE_INPUT',
        'Scene plan is stale; generate a current scene plan before this operation',
        409,
      );
  }
  private invalidateSceneWorkflowForChapter(chapterId: Id): void {
    const error = 'Scene input changed';
    this.workflow.invalidateSteps(chapterId, ['GENERATE_SCENES'], error);
    const sceneIds = this.scenes.listCurrentSceneIds(chapterId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT', 'BUILD_VISUAL_PROMPT', 'GENERATE_SCENE_IMAGE'],
      error,
    );
  }

  private invalidateSceneVisualWorkflowForProject(projectId: Id, error: string): void {
    const sceneIds = this.scenes.listProjectCurrentSceneIds(projectId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT', 'BUILD_VISUAL_PROMPT', 'GENERATE_SCENE_IMAGE'],
      error,
    );
  }

  scheduleSceneGeneration(
    projectId: Id,
    chapterId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const request = sceneGenerationRequestSchema.parse(requestInput);
    if (
      request.expectedChapterRevision !== undefined &&
      request.expectedChapterRevision !== chapter.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
    const context = buildSceneGenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      chapterId,
      density: request.density,
      targetRange: request.targetRange,
      style: this.scenes.getVisualStyle(projectId),
    });
    const prompt = renderScenePlanningPrompt(
      context,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-planning:${chapterId}:${chapter.revision}:${prompt.inputFingerprint}`,
      'GENERATE_SCENES',
      chapterId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('GENERATE_SCENES', chapterId, stepId),
    };
  }

  scheduleSceneRegeneration(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    this.assertSceneSchedulingCurrent(scene);
    const request = sceneRegenerationRequestSchema.parse(requestInput);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style: this.scenes.getVisualStyle(projectId),
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderSceneRegenerationPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-regeneration:${sceneId}:${scene.revision}:${prompt.inputFingerprint}`,
      'REGENERATE_SCENE',
      sceneId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('REGENERATE_SCENE', sceneId, stepId),
    };
  }

  scheduleScenePromptRefresh(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    this.assertSceneSchedulingCurrent(scene);
    const request = scenePromptRequestSchema.parse(requestInput);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style: this.scenes.getVisualStyle(projectId),
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderScenePromptRefreshPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `scene-prompt:${sceneId}:${scene.revision}:${prompt.inputFingerprint}`,
      'GENERATE_SCENE_PROMPT',
      sceneId,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('GENERATE_SCENE_PROMPT', sceneId, stepId),
    };
  }

  getCurrentShotPlan(projectId: Id, sceneId: Id) {
    const scene = this.getScene(projectId, sceneId);
    return this.shotPlans.getCurrent(projectId, scene.id);
  }
  getShotPlan(projectId: Id, shotPlanId: Id) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const plan = this.shotPlans.getById(projectId, shotPlanId);
    if (!plan) throw new AppError('NOT_FOUND', 'Shot plan not found', 404);
    return plan;
  }
  listChapterShotPlans(projectId: Id, chapterId: Id, limit = 100, offset = 0) {
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    return this.shotPlans.listCurrentForChapter(projectId, chapterId, limit, offset);
  }

  reviewShotPlan(projectId: Id, shotPlanId: Id, requestInput: unknown) {
    const request = shotPlanReviewRequestSchema.parse(requestInput);
    return this.shotPlans.review(projectId, shotPlanId, request);
  }

  scheduleShotPlanning(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    this.assertSceneSchedulingCurrent(scene);
    const request = shotPlanningRequestSchema.parse(requestInput);
    if (
      request.expectedSceneRevision !== undefined &&
      request.expectedSceneRevision !== scene.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const chapterScenes = this.scenes.listScenes(scene.chapterId, 200, 0, false);
    const sceneIndex = chapterScenes.findIndex((entry) => entry.id === scene.id);
    const previous = sceneIndex > 0 ? chapterScenes[sceneIndex - 1] : undefined;
    const next = sceneIndex >= 0 ? chapterScenes[sceneIndex + 1] : undefined;
    const previousPlan = previous ? this.shotPlans.getCurrent(projectId, previous.id) : null;
    const prompt = renderShotPlanningPrompt({
      scene: this.scenes.getScene(scene.id, true)!,
      location: scene.locationId ? this.scenes.getLocation(projectId, scene.locationId) : null,
      previousFinalState: previousPlan?.candidate.shots.at(-1)?.finalState ?? null,
      nextScene: next
        ? {
            stableId: next.stableId,
            summary: next.summary,
            purpose: next.purpose,
            locationId: next.locationId,
          }
        : null,
    });
    const executionId = this.workflow.createExecution(projectId, 'SHOT_PLANNING');
    const stepId = this.workflow.createStep(
      executionId,
      `shot-planning:${scene.id}:${scene.revision}:${prompt.inputFingerprint}`,
      'PLAN_SHOTS',
      scene.id,
      prompt.inputFingerprint,
      3,
      request,
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('PLAN_SHOTS', scene.id, stepId),
    };
  }
  scheduleVisualReference(
    projectId: Id,
    targetKind: 'CHARACTER_PROTOTYPE' | 'CHARACTER_STAGE' | 'LOCATION',
    targetEntityId: string,
  ) {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    return this.visualReferences.schedule(projectId, targetKind, targetEntityId);
  }

  listVisualReferences(
    projectId: Id,
    targetKind: 'CHARACTER_PROTOTYPE' | 'CHARACTER_STAGE' | 'LOCATION',
    targetEntityId: string,
    limit = 50,
  ) {
    return this.visualReferences.list(projectId, targetKind, targetEntityId, limit);
  }

  reviewVisualReference(projectId: Id, generationId: Id, approval: 'APPROVED' | 'REJECTED') {
    return this.visualReferences.review(projectId, generationId, approval);
  }

  saveAppearanceStage(projectId: Id, characterId: string, input: unknown) {
    const value = appearanceStageCreateSchema.parse(input);
    return this.visualReferences.stages.saveCurrent({
      projectId,
      characterId,
      stableId: value.stableId,
      profileId: value.profileId,
      profileRevision: value.profileRevision,
      name: value.name,
      payload: value.payload,
      provenance: value.provenance,
      reviewStatus: value.reviewStatus,
      inputFingerprint: fingerprint(value),
      expectedRevision: value.expectedRevision,
    });
  }

  listAppearanceStages(projectId: Id, characterId: string, limit = 50) {
    return this.visualReferences.stages.listCharacter(projectId, characterId, limit);
  }

  scheduleSceneBatch(
    projectId: Id,
    requestInput: unknown,
  ): { executionId: Id; jobIds: Id[]; skippedChapterIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const request = sceneBatchRequestSchema.parse(requestInput);
    const executionId = this.workflow.createExecution(projectId, 'SCENE_GENERATION');
    const jobIds: Id[] = [];
    const skippedChapterIds: Id[] = [];
    for (const chapterId of request.chapterIds) {
      const chapter = this.chapters.get(chapterId);
      if (!chapter || chapter.projectId !== projectId)
        throw new AppError('NOT_FOUND', 'Chapter not found', 404);
      const currentPlan = this.scenes.getScenePlan(chapterId);
      if (request.onlyMissing && currentPlan?.status === 'CURRENT' && currentPlan.sceneCount > 0) {
        skippedChapterIds.push(chapterId);
        continue;
      }
      const context = buildSceneGenerationContext({
        story: this.story,
        chapters: this.chapters,
        scenes: this.scenes,
        projectId,
        chapterId,
        density: request.density,
        targetRange: request.targetRange,
        style: this.scenes.getVisualStyle(projectId),
      });
      const prompt = renderScenePlanningPrompt(
        context,
        this.story.getSettings(projectId)?.generation.model ?? null,
      );
      const stepId = this.workflow.createStep(
        executionId,
        `scene-planning:${chapterId}:${chapter.revision}:${prompt.inputFingerprint}`,
        'GENERATE_SCENES',
        chapterId,
        prompt.inputFingerprint,
        3,
        {
          density: request.density,
          targetRange: request.targetRange,
          expectedChapterRevision: chapter.revision,
        },
      );
      jobIds.push(this.workflow.createJob('GENERATE_SCENES', chapterId, stepId));
    }
    return { executionId, jobIds, skippedChapterIds };
  }
  scheduleVisualProfileGeneration(
    projectId: Id,
    kind: VisualProfileGenerationKind,
    subjectId: string,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (!['CHARACTER', 'LOCATION', 'OBJECT'].includes(kind))
      throw new AppError('INVALID_INPUT', 'Unknown visual profile kind', 400);
    const request = visualProfileGenerateRequestSchema.parse(requestInput);
    const visualSubjectId = kind === 'OBJECT' ? visualObjectKeySchema.parse(subjectId) : subjectId;
    if (
      kind === 'CHARACTER' &&
      !this.story
        .getBlueprint(projectId)
        ?.blueprint.characters.some((item) => item.id === visualSubjectId)
    )
      throw new AppError('NOT_FOUND', 'Story character not found', 404);
    if (kind === 'LOCATION' && !this.scenes.getLocation(projectId, visualSubjectId))
      throw new AppError('NOT_FOUND', 'Location not found', 404);
    if (kind === 'OBJECT' && !visualSubjectId)
      throw new AppError('INVALID_INPUT', 'Object key is required', 400);
    const settings = this.story.getSettings(projectId);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const operation = `${kind}_VISUAL_PROFILE`;
    const stepType = `GENERATE_${operation}`;
    const stepId = this.workflow.createStep(
      executionId,
      `visual-profile:${kind.toLocaleLowerCase('en-US')}:${visualSubjectId}`,
      stepType,
      visualSubjectId,
      fingerprint({ operation, projectId, subjectId: visualSubjectId, request }),
      settings?.generation.maxRetries ?? 3,
      { projectId, kind, subjectId: visualSubjectId, instructions: request.instructions },
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob(stepType, visualSubjectId, stepId),
    };
  }

  scheduleVisualPromptBuild(
    projectId: Id,
    sceneId: Id,
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const inputFingerprint = fingerprint({
      operation: 'BUILD_VISUAL_PROMPT',
      projectId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
    });
    const stepId = this.workflow.createStep(
      executionId,
      `visual-prompt:${scene.id}:${scene.revision}`,
      'BUILD_VISUAL_PROMPT',
      scene.id,
      inputFingerprint,
      3,
      { projectId, sceneId: scene.id, sceneRevision: scene.revision },
    );
    return {
      executionId,
      jobId: this.workflow.createJob('BUILD_VISUAL_PROMPT', scene.id, stepId),
      stepId,
    };
  }
  scheduleVisualPromptBatch(
    projectId: Id,
    chapterId: Id,
    limit = 200,
    offset = 0,
  ): { executionId: Id; jobIds: Id[]; stepIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const scenes = this.scenes.listScenes(
      chapterId,
      Math.min(200, Math.max(1, limit)),
      Math.max(0, offset),
    );
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const jobIds: Id[] = [];
    const stepIds: Id[] = [];
    for (const scene of scenes) {
      const inputFingerprint = fingerprint({
        operation: 'BUILD_VISUAL_PROMPT',
        projectId,
        sceneId: scene.id,
        sceneRevision: scene.revision,
      });
      const stepId = this.workflow.createStep(
        executionId,
        `visual-prompt:${scene.id}:${scene.revision}`,
        'BUILD_VISUAL_PROMPT',
        scene.id,
        inputFingerprint,
        3,
        { projectId, sceneId: scene.id, sceneRevision: scene.revision },
      );
      stepIds.push(stepId);
      jobIds.push(this.workflow.createJob('BUILD_VISUAL_PROMPT', scene.id, stepId));
    }
    return { executionId, jobIds, stepIds };
  }
  scheduleShotVisualPromptBuild(
    projectId: Id,
    sceneId: Id,
    shotId: string,
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const scene = this.getScene(projectId, sceneId);
    const plan = this.shotPlans.getCurrent(projectId, scene.id);
    const shot = plan?.candidate.shots.find((candidate) => candidate.id === shotId);
    if (!plan || !shot) throw new AppError('NOT_FOUND', 'Shot not found in current Shot plan', 404);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const inputFingerprint = fingerprint({
      operation: 'BUILD_VISUAL_PROMPT',
      projectId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      shotPlanId: plan.id,
      shotPlanRevision: plan.revision,
      shotId: shot.id,
    });
    const stepId = this.workflow.createStep(
      executionId,
      `visual-prompt:${scene.id}:${scene.revision}:shot:${shot.id}`,
      'BUILD_VISUAL_PROMPT',
      scene.id,
      inputFingerprint,
      3,
      {
        projectId,
        sceneId: scene.id,
        sceneRevision: scene.revision,
        shotPlanId: plan.id,
        shotPlanRevision: plan.revision,
        shotId: shot.id,
      },
    );
    return {
      executionId,
      jobId: this.workflow.createJob('BUILD_VISUAL_PROMPT', scene.id, stepId),
      stepId,
    };
  }

  scheduleVisualPromptRefinement(
    projectId: Id,
    packageId: Id,
    requestInput: unknown = {},
  ): { executionId: Id; jobId: Id; stepId: Id } {
    const request = visualPromptRefinementRequestSchema.parse(requestInput);
    const packageDto = this.visualPackages.get(projectId, packageId);
    if (!packageDto) throw new AppError('NOT_FOUND', 'Visual prompt package not found', 404);
    if (packageDto.status !== 'CURRENT')
      throw new AppError('STALE_INPUT', 'Visual prompt package is stale', 409);
    if (
      request.expectedPackageRevision !== undefined &&
      request.expectedPackageRevision !== packageDto.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Visual prompt package revision is stale', 409);
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_CONSISTENCY');
    const inputFingerprint = fingerprint({
      operation: 'VISUAL_PROMPT_REFINEMENT',
      projectId,
      packageId,
      packageRevision: packageDto.revision,
      instructions: request.instructions,
    });
    const stepId = this.workflow.createStep(
      executionId,
      `visual-prompt-refinement:${packageId}:${packageDto.revision}`,
      'REFINE_VISUAL_PROMPT',
      packageId,
      inputFingerprint,
      3,
      { projectId, packageId, request },
    );
    return {
      executionId,
      stepId,
      jobId: this.workflow.createJob('REFINE_VISUAL_PROMPT', packageId, stepId),
    };
  }

  scheduleStoryBlueprint(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      renderBlueprintPrompt(settings).inputFingerprint,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, stepId),
    };
  }
  scheduleStoryPlans(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const blueprint = this.story.getBlueprint(projectId);
    const settings = this.story.getSettings(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    if (settings.targetChapterCount > 20)
      throw new AppError(
        'INVALID_PLAN',
        'Stories over 20 chapters require arcs and bounded planning windows',
        422,
      );
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-plans:${projectId}:${blueprint.revision}`,
      'GENERATE_CHAPTER_PLANS',
      projectId,
      renderChapterPlansPrompt(settings, blueprint.blueprint).inputFingerprint,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_PLANS', projectId, stepId),
    };
  }
  scheduleStoryStages(projectId: Id): { executionId: Id; jobIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const blueprintStep = this.workflow.createStep(
      executionId,
      `story-blueprint:${projectId}`,
      'GENERATE_STORY_BLUEPRINT',
      projectId,
      renderBlueprintPrompt(settings).inputFingerprint,
    );
    const longStory = settings.targetChapterCount > 20;
    const planningType = longStory ? 'GENERATE_STORY_ARCS' : 'GENERATE_CHAPTER_PLANS';
    const planningStep = this.workflow.createStep(
      executionId,
      longStory ? `story-arcs:${projectId}` : `story-plans:${projectId}`,
      planningType,
      projectId,
      fingerprint({
        operation: longStory ? 'ARC_PLANNING_DEFERRED' : 'CHAPTER_PLANS_DEFERRED',
        settingsRevision: settings.revision,
      }),
    );
    this.workflow.dependency(planningStep, blueprintStep);
    return {
      executionId,
      jobIds: [
        this.workflow.createJob('GENERATE_STORY_BLUEPRINT', projectId, blueprintStep),
        this.workflow.createJob(planningType, projectId, planningStep),
      ],
    };
  }
  scheduleStoryArcs(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-arcs:${projectId}:${blueprint.revision}`,
      'GENERATE_STORY_ARCS',
      projectId,
      renderArcPlanningPrompt(settings, blueprint.blueprint).inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );

    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_STORY_ARCS', projectId, stepId),
    };
  }
  updateArc(projectId: Id, arcId: string, input: unknown): StoryArc {
    const current = this.story.getArc(projectId, arcId);
    if (!current) throw new AppError('NOT_FOUND', 'Arc not found', 404);
    const arc = storyArcSchema.parse(input);
    if (arc.id !== arcId)
      throw new AppError('INVALID_ARC_PLAN', 'Arc identifier cannot change', 400);
    const saved = this.story.saveArc(
      projectId,
      arc,
      null,
      this.story.fingerprint({ operation: 'MANUAL_ARC', arcId, arc }),
    );
    const planItemIds = this.story.markArcDependentsStale(projectId, arcId);
    for (const planItemId of planItemIds)
      this.story.invalidateScope({ projectId, kind: 'PLAN_ITEM', stableId: planItemId });
    return saved;
  }

  scheduleStoryPlanWindow(
    projectId: Id,
    arcId: string,
    startChapter: number,
    endChapter: number,
  ): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const arc = this.story.getArc(projectId, arcId);
    if (!settings || !blueprint || !arc)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Story settings, blueprint, and arc are required',
        409,
      );
    if (
      !Number.isInteger(startChapter) ||
      !Number.isInteger(endChapter) ||
      startChapter < arc.startChapter ||
      endChapter > arc.endChapter ||
      startChapter > endChapter ||
      endChapter - startChapter + 1 > (settings.generation.planningWindow ?? 20)
    )
      throw new AppError(
        'INVALID_PLAN_WINDOW',
        'Requested plan window is outside its configured bounds',
        400,
      );
    const previousWindow =
      this.story
        .getPlanWindows(projectId)
        .filter((window) => window.window.endChapter < startChapter)
        .sort((left, right) => right.window.endChapter - left.window.endChapter)[0] ?? null;
    const prompt = renderChapterPlanWindowPrompt(
      settings,
      blueprint.blueprint,
      arc,
      planWindowBoundary(previousWindow),
      startChapter,
      endChapter,
    );
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-plan-window:${arcId}:${startChapter}:${endChapter}`,
      'GENERATE_CHAPTER_PLAN_WINDOW',
      projectId,
      prompt.inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_PLAN_WINDOW', projectId, stepId),
    };
  }
  updatePlanWindow(projectId: Id, windowId: string, input: unknown): StoryPlanWindowResult {
    const current = this.story.getPlanWindow(projectId, windowId);
    if (!current) throw new AppError('NOT_FOUND', 'Plan window not found', 404);
    const result = storyPlanWindowResultSchema.parse(input);
    if (result.window.id !== windowId)
      throw new AppError('INVALID_PLAN_WINDOW', 'Plan window identifier cannot change', 400);
    const blueprint = this.story.getBlueprint(projectId);
    if (!blueprint || result.window.sourceBlueprintRevision !== blueprint.revision)
      throw new AppError('STALE_INPUT', 'Blueprint revision is no longer current', 409);
    const normalized = {
      ...result,
      window: {
        ...result.window,
        status: 'CURRENT' as const,
      },
    };
    const saved = this.story.savePlanWindow(
      projectId,
      normalized,
      this.story.fingerprint({ operation: 'MANUAL_PLAN_WINDOW', windowId, result: normalized }),
    );
    const planItemIds = new Set([
      ...current.items.map((item) => item.id),
      ...saved.items.map((item) => item.id),
    ]);
    for (const planItemId of planItemIds)
      this.story.invalidateScope({ projectId, kind: 'PLAN_ITEM', stableId: planItemId });
    return saved;
  }

  scheduleStoryChapterV2(projectId: Id, planItemId: string): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const planItem = this.story.getPlanItem(projectId, planItemId)?.item;
    if (!settings || !blueprint || !planItem)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Long-story settings, blueprint, and plan item are required',
        409,
      );
    if (planItem.chapterNumber > settings.targetChapterCount)
      throw new AppError('INVALID_PLAN', 'Chapter plan is outside the configured target', 400);
    const manual = this.context.database.sqlite
      .prepare(
        "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='MANUAL' LIMIT 1",
      )
      .get(projectId, planItem.chapterNumber) as { id: Id } | undefined;
    if (manual)
      throw new AppError(
        'MANUAL_EDIT_CONFLICT',
        'A manual chapter occupies the requested chapter number',
        409,
      );
    const active = this.context.database.sqlite
      .prepare(
        `SELECT s.id FROM workflow_steps s
         JOIN workflow_executions e ON e.id=s.execution_id
         WHERE e.project_id=? AND s.type IN ('GENERATE_CHAPTER_V2','GENERATE_CHAPTER') AND s.entity_id=?
           AND s.status IN ('PENDING','RUNNING') LIMIT 1`,
      )
      .get(projectId, planItemId) as { id: Id } | undefined;
    if (active)
      throw new AppError('WORKFLOW_CONFLICT', 'Chapter generation is already scheduled', 409);
    const state = this.story.getStoryState(projectId);
    const followsSkippedGap =
      planItem.chapterNumber === state.currentChapter + 2 &&
      state.gapMarkers.some((marker) => marker.chapterNumber === state.currentChapter + 1);
    if (planItem.chapterNumber > state.currentChapter + 1 && !followsSkippedGap) {
      const existing = this.context.database.sqlite
        .prepare(
          "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='GENERATED' LIMIT 1",
        )
        .get(projectId, planItem.chapterNumber) as { id: Id } | undefined;
      if (!existing)
        throw new AppError(
          'CONTINUITY_ERROR',
          `Chapter ${planItem.chapterNumber} must follow chapter ${state.currentChapter}`,
          409,
        );
      throw new AppError(
        'CONTINUITY_ERROR',
        `Chapter ${planItem.chapterNumber} has no current checkpoint; rebuild continuity before regeneration`,
        409,
      );
    }
    const context = buildChapterGenerationContextV2(this.story, this.chapters, projectId, planItem);
    const prompt = renderChapterGenerationV2Prompt(context, planItem, settings.generation.model);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-chapter-v2:${planItemId}:${planItem.chapterNumber}`,
      'GENERATE_CHAPTER_V2',
      planItemId,
      prompt.inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_V2', planItemId, stepId),
    };
  }

  scheduleStoryStateAnalysis(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const settings = this.story.getSettings(chapter.projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-state-analysis:${chapter.id}:${chapter.revision}`,
      'ANALYZE_STORY_STATE',
      chapter.id,
      fingerprint({ operation: 'STATE_ANALYSIS_DEFERRED', chapterId, revision: chapter.revision }),
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('ANALYZE_STORY_STATE', chapter.id, stepId),
    };
  }

  scheduleContinuityCheck(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const settings = this.story.getSettings(chapter.projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `continuity:${chapter.id}:${chapter.revision}`,
      'CHECK_CONTINUITY',
      chapter.id,
      fingerprint({
        operation: 'CONTINUITY_CHECK_DEFERRED',
        chapterId,
        revision: chapter.revision,
      }),
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('CHECK_CONTINUITY', chapter.id, stepId),
    };
  }

  scheduleStorySummaryCompaction(projectId: Id): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const state = this.story.getStoryState(projectId);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-summary-compaction:${projectId}:${state.revision}`,
      'SUMMARY_COMPACTION',
      projectId,
      renderSummaryCompactionPrompt(state, settings.generation.model).inputFingerprint,
      (settings.generation.maxRetries ?? 3) + 1,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('SUMMARY_COMPACTION', projectId, stepId),
    };
  }

  scheduleStoryBatch(
    projectId: Id,
    input: StoryGenerationBatchRequest,
  ): { batch: StoryGenerationBatch; executionId: Id; jobIds: Id[] } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const request = storyGenerationBatchRequestSchema.parse(input);
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    const state = this.story.getStoryState(projectId);
    const startChapter =
      request.mode === 'RANGE' ? request.startChapter! : state.currentChapter + 1;
    if (startChapter > state.currentChapter + 1)
      throw new AppError(
        'CONTINUITY_ERROR',
        `Batch must start at chapter ${state.currentChapter + 1}`,
        409,
      );
    const endChapter =
      request.mode === 'RANGE'
        ? request.endChapter!
        : request.mode === 'NEXT'
          ? startChapter + request.count! - 1
          : settings.targetChapterCount;
    if (startChapter > endChapter || startChapter > settings.targetChapterCount)
      throw new AppError('INVALID_BATCH', 'No chapters remain in the configured target', 400);
    if (endChapter > settings.targetChapterCount)
      throw new AppError('INVALID_BATCH', 'Batch exceeds the configured target chapter count', 400);
    const total = endChapter - startChapter + 1;
    const maxChapters = settings.generation.maxChaptersPerBatch ?? 25;
    if (total > maxChapters)
      throw new AppError(
        'INVALID_BATCH',
        `Batch exceeds maxChaptersPerBatch (${maxChapters})`,
        400,
      );
    const planItems: Array<{ chapterNumber: number; planItemId: string }> = [];
    for (let chapterNumber = startChapter; chapterNumber <= endChapter; chapterNumber += 1) {
      const planItem = this.story.getPlanItemForChapter(projectId, chapterNumber)?.item;
      if (!planItem)
        throw new AppError(
          'PREREQUISITE_MISSING',
          `A chapter plan item is required for chapter ${chapterNumber}`,
          409,
        );
      const manual = this.context.database.sqlite
        .prepare(
          "SELECT id FROM chapters WHERE project_id=? AND number=? AND story_origin='MANUAL' LIMIT 1",
        )
        .get(projectId, chapterNumber) as { id: Id } | undefined;
      if (manual)
        throw new AppError(
          'MANUAL_EDIT_CONFLICT',
          `Manual chapter ${chapterNumber} requires continuity review`,
          409,
        );
      const active = this.batches.activeChapter(projectId, chapterNumber);
      if (active)
        throw new AppError(
          'BATCH_CONFLICT',
          `Chapter ${chapterNumber} already has active work`,
          409,
        );
      planItems.push({ chapterNumber, planItemId: planItem.id });
    }
    const schedule = this.context.database.sqlite.transaction(() => {
      const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
      const jobIds: Id[] = [];
      const seeds: Array<{ chapterNumber: number; planItemId: string; workflowStepId: Id }> = [];
      let previousStepId: Id | null = null;
      for (const item of planItems) {
        const stepId = this.workflow.createStep(
          executionId,
          `story-batch:${executionId}:${item.chapterNumber}:${item.planItemId}`,
          'GENERATE_CHAPTER_V2',
          item.planItemId,
          fingerprint({
            operation: 'CHAPTER_GENERATION_V2_DEFERRED',
            projectId,
            chapterNumber: item.chapterNumber,
            planItemId: item.planItemId,
          }),
          (settings.generation.maxRetries ?? 3) + 1,
        );
        if (previousStepId) this.workflow.dependency(stepId, previousStepId);
        jobIds.push(this.workflow.createJob('GENERATE_CHAPTER_V2', item.planItemId, stepId));
        seeds.push({ ...item, workflowStepId: stepId });
        previousStepId = stepId;
      }
      const batch = this.batches.create({
        projectId,
        startChapter,
        endChapter,
        mode: request.mode,
        items: seeds,
      });
      return { batch, executionId, jobIds };
    });
    return schedule();
  }

  retryStoryBatchItem(batchId: Id, chapterNumber: number): StoryGenerationBatchItem {
    return this.batches.retry(batchId, chapterNumber);
  }

  skipStoryBatchItem(batchId: Id, chapterNumber: number, reason: string): StoryGenerationBatchItem {
    const item = this.batches.skip(batchId, chapterNumber, reason);
    this.story.recordGapMarker(item.projectId, chapterNumber, reason);
    return item;
  }

  cancelStoryBatch(batchId: Id): StoryGenerationBatch {
    return this.batches.cancel(batchId);
  }
  scheduleStoryChapter(projectId: Id, planItemId: string): { executionId: Id; jobId: Id } {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const item = this.story.getPlanItem(projectId, planItemId);
    if (!item) throw new AppError('PREREQUISITE_MISSING', 'Chapter plan item is required', 409);
    if (!this.story.getBlueprint(projectId))
      throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const executionId = this.workflow.createExecution(projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-chapter:${planItemId}`,
      'GENERATE_CHAPTER',
      planItemId,
      renderChapterGenerationPrompt(this.story, this.chapters, projectId, item.item)
        .inputFingerprint,
    );
    return { executionId, jobId: this.workflow.createJob('GENERATE_CHAPTER', planItemId, stepId) };
  }
  scheduleStorySummary(chapterId: Id): { executionId: Id; jobId: Id } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'STORY_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `story-summary:${chapterId}:${chapter.revision}`,
      'GENERATE_CHAPTER_SUMMARY',
      chapterId,
      renderSummaryGenerationPrompt(this.story, this.chapters, chapterId).inputFingerprint,
    );
    return {
      executionId,
      jobId: this.workflow.createJob('GENERATE_CHAPTER_SUMMARY', chapterId, stepId),
    };
  }
  getRenderConfig(projectId: Id) {
    return renderConfigSchema.parse({
      ...renderConfigSchema.parse({}),
      ...this.projects.getRenderConfig(projectId),
    });
  }
  getChapterTimeline(projectId: Id, chapterId: Id) {
    return this.timeline.getChapterTimeline(projectId, chapterId);
  }
  scheduleSceneTiming(chapterId: Id, update?: SceneTimingUpdate) {
    return this.timeline.scheduleSceneTiming(chapterId, update);
  }
  scheduleMotionPlan(chapterId: Id, replace = false) {
    return this.timeline.scheduleMotionPlan(chapterId, replace);
  }
  async buildSceneTiming(chapterId: Id, update?: SceneTimingUpdate) {
    return await this.timeline.buildSceneTiming(chapterId, update);
  }
  buildMotionPlans(chapterId: Id, replace = false) {
    return this.timeline.buildMotionPlans(chapterId, replace);
  }
  getRenderPlan(projectId: Id, request: RenderRequest): RenderPlan {
    return this.timeline.getRenderPlan(projectId, request);
  }
  async scheduleTimelineRender(projectId: Id, request: RenderRequest) {
    return this.timeline.scheduleRender(projectId, request);
  }
  updateMotionPlan(projectId: Id, sceneId: Id, input: unknown) {
    return this.timeline.updateMotionPlan(projectId, sceneId, motionPlanUpdateSchema.parse(input));
  }
  getStatus(projectId: Id, chapterId?: Id): StatusSummary {
    if (!this.projects.get(projectId)) throw new AppError('NOT_FOUND', 'Project not found', 404);
    if (chapterId) {
      const chapter = this.chapters.get(chapterId);
      if (!chapter || chapter.projectId !== projectId)
        throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    }
    const latestStep = (type: string, entityId: Id): WorkflowStatus => {
      const row = this.context.database.sqlite
        .prepare(
          'SELECT status FROM workflow_steps WHERE type=? AND entity_id=? ORDER BY updated_at DESC LIMIT 1',
        )
        .get(type, entityId) as { status: WorkflowStatus } | undefined;
      return row?.status ?? 'PENDING';
    };
    const jobs = this.context.database.sqlite
      .prepare(
        'SELECT id,type,entity_id as entityId,status,progress,error,attempts,created_at as createdAt,started_at as startedAt,completed_at as completedAt FROM jobs WHERE entity_id=? ORDER BY created_at DESC',
      )
      .all(chapterId ?? projectId) as JobDto[];
    const background = this.assets.current(projectId, 'project:background');
    return {
      projectId,
      ...(chapterId ? { chapterId } : {}),
      narration: chapterId ? latestStep('MERGE_AUDIO', chapterId) : 'PENDING',
      subtitles: chapterId ? latestStep('SUBTITLE', chapterId) : 'PENDING',
      background: background ? 'COMPLETED' : 'PENDING',
      render: latestStep('RENDER', projectId),
      timeline: this.timeline.status(projectId, chapterId),
      jobs,
      story: this.story.getLongStoryCounts(projectId),
    };
  }
  scheduleChapterTts(chapterId: Id): { executionId: Id; jobIds: Id[] } {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'CHAPTER_AUDIO');
    const cleanId = this.workflow.createStep(
      executionId,
      `clean:${chapter.id}:${chapter.revision}`,
      'CLEAN_TEXT',
      chapter.id,
      fingerprint({ chapterId, content: chapter.content }),
    );
    this.workflow.markCompleted(cleanId);
    const segments = segmentNarrationText(chapter.content);
    const jobIds: Id[] = [];
    let prior = cleanId;
    for (const segment of segments) {
      const segmentFingerprint = fingerprint({ chapterId, segment: segment.textHash });
      const stepId = this.workflow.createStep(
        executionId,
        `tts:${chapter.id}:${segment.index}:${segment.textHash}`,
        'TTS_SEGMENT',
        chapter.id,
        segmentFingerprint,
      );
      this.workflow.dependency(stepId, prior);
      const existing = this.context.database.sqlite
        .prepare(
          "SELECT t.id,t.status,t.text_hash as textHash,t.audio_asset_id as audioAssetId FROM tts_segments t LEFT JOIN assets a ON a.id=t.audio_asset_id AND a.status='READY' AND a.is_current=1 WHERE t.chapter_id=? AND t.segment_index=?",
        )
        .get(chapter.id, segment.index) as
        { id: Id; status: string; textHash: string; audioAssetId: Id | null } | undefined;
      if (existing?.audioAssetId && existing.textHash === segment.textHash) {
        this.workflow.markCompleted(stepId);
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,status='COMPLETED',fingerprint=?,chapter_revision=?,source_start_offset=?,source_end_offset=?,source_text=?,error=NULL WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segmentFingerprint,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
            chapter.id,
            segment.index,
          );
      } else if (existing) {
        this.context.database.sqlite
          .prepare(
            "UPDATE tts_segments SET id=?,text=?,text_hash=?,chapter_revision=?,source_start_offset=?,source_end_offset=?,source_text=?,status='PENDING',audio_asset_id=NULL,duration_ms=NULL,error=NULL,fingerprint=? WHERE chapter_id=? AND segment_index=?",
          )
          .run(
            stepId,
            segment.text,
            segment.textHash,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
            segmentFingerprint,
            chapter.id,
            segment.index,
          );
        jobIds.push(this.workflow.createJob('TTS_SEGMENT', chapter.id, stepId));
      } else {
        this.context.database.sqlite
          .prepare(
            'INSERT INTO tts_segments(id,chapter_id,segment_index,text,text_hash,chapter_revision,source_start_offset,source_end_offset,source_text,status,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            stepId,
            chapter.id,
            segment.index,
            segment.text,
            segment.textHash,
            chapter.revision,
            segment.sourceStartOffset,
            segment.sourceEndOffset,
            segment.sourceText,
            'PENDING',
            segmentFingerprint,
          );
        jobIds.push(this.workflow.createJob('TTS_SEGMENT', chapter.id, stepId));
      }
      prior = stepId;
    }
    const mergeId = this.workflow.createStep(
      executionId,
      `merge:${chapter.id}:${chapter.revision}`,
      'MERGE_AUDIO',
      chapter.id,
      fingerprint({
        chapterId,
        segments: segments.map((segment) => segment.textHash),
      }),
    );
    this.workflow.dependency(mergeId, prior);
    jobIds.push(this.workflow.createJob('MERGE_AUDIO', chapter.id, mergeId));
    return { executionId, jobIds };
  }
  scheduleSubtitle(chapterId: Id): Id {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const executionId = this.workflow.createExecution(chapter.projectId, 'SUBTITLE');
    const step = this.workflow.createStep(
      executionId,
      `subtitle:${chapter.id}:${chapter.revision}`,
      'SUBTITLE',
      chapter.id,
      fingerprint({ chapterId, content: chapter.content }),
    );
    return this.workflow.createJob('SUBTITLE', chapter.id, step);
  }
  private renderFingerprint(projectId: Id): string {
    const inputs = this.context.database.sqlite
      .prepare('SELECT role,sha256 FROM assets WHERE project_id=? AND is_current=1 ORDER BY role')
      .all(projectId) as Array<{ role: string; sha256: string }>;
    return fingerprint({ projectId, config: this.getRenderConfig(projectId), inputs });
  }
  scheduleRender(projectId: Id): Id {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
    const executionId = this.workflow.createExecution(projectId, 'RENDER');
    const step = this.workflow.createStep(
      executionId,
      `render:${projectId}`,
      'RENDER',
      projectId,
      this.renderFingerprint(projectId),
    );
    return this.workflow.createJob('RENDER', projectId, step);
  }
  private invalidateRender(projectId: Id): void {
    this.assets.invalidateRole(projectId, 'project:render');
    this.workflow.invalidateSteps(projectId, ['RENDER']);
  }
  invalidateRenderForAsset(projectId: Id): void {
    this.invalidateRender(projectId);
  }
  private invalidateChapterDescendants(projectId: Id, chapterId: Id): void {
    this.story.invalidateScope({ projectId, kind: 'CHAPTER', chapterId });
  }
}
export type TtsProvider = {
  synthesize(text: string, voice: string, outputFile: string, signal?: AbortSignal): Promise<void>;
};
export class EdgeTtsProvider implements TtsProvider {
  private readonly script = fileURLToPath(new URL('./edge-tts-cli.js', import.meta.url));
  constructor(
    private readonly runner: ProcessRunner,
    private readonly executable = process.env.EDGE_TTS_COMMAND ?? process.execPath,
  ) {}
  async synthesize(
    text: string,
    voice: string,
    outputFile: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const argumentsList =
      this.executable === process.execPath
        ? [this.script, text, voice, outputFile]
        : ['--voice', voice, '--text', text, '--write-media', outputFile];
    const options = { executable: this.executable, arguments: argumentsList, timeoutMs: 120_000 };
    if (signal) await this.runner.run({ ...options, signal });
    else await this.runner.run(options);
  }
}
export class WorkerExecutor {
  private readonly workflow: WorkflowRepository;
  private readonly timeline: TimelineWorkflowService;
  private readonly sceneVideos: SceneVideoGenerationRepository;
  constructor(
    private readonly context: StudioContext,
    private readonly workerId: string,
    private readonly tts: TtsProvider = new EdgeTtsProvider(context.runner),
    private readonly storyEngine?: StoryEngine,
    private readonly sceneEngine?: SceneEngine,
    private readonly visualService?: VisualConsistencyService,
    private readonly imageService?: ImageGenerationService,
    private readonly videoService?: SceneVideoService,
    private readonly production?: ProductionOrchestrator,
    private readonly publication?: PublicationPackageService,
    private readonly shotDirector?: ShotDirector,
    private readonly visualReferenceService?: VisualReferenceService,
  ) {
    this.workflow = new WorkflowRepository(context.database);
    this.timeline = new TimelineWorkflowService(context);
    this.sceneVideos = new SceneVideoGenerationRepository(context.database);
  }
  async execute(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    if (step.type === 'ADVANCE_PRODUCTION_RUN') {
      if (!this.production)
        throw new AppError('CONFIGURATION_ERROR', 'Production worker is not configured', 500);
      await this.production.executeAdvanceStep(step, signal);
      return;
    }
    if (
      step.type === 'GENERATE_PUBLICATION_METADATA' ||
      step.type === 'BUILD_PUBLICATION_PACKAGE' ||
      step.type === 'EXPORT_PUBLICATION_PACKAGE'
    ) {
      if (!this.publication)
        throw new AppError('CONFIGURATION_ERROR', 'Publication worker is not configured', 500);
      if (step.type === 'GENERATE_PUBLICATION_METADATA')
        await this.publication.executeMetadataStep(step);
      else if (step.type === 'BUILD_PUBLICATION_PACKAGE')
        await this.publication.executePackageStep(step);
      else await this.publication.executeExport(step, signal);
      return;
    }
    if (step.type === 'GENERATE_SCENE_IMAGE' || step.type === 'GENERATE_SHOT_IMAGE') {
      if (!this.imageService)
        throw new AppError('CONFIGURATION_ERROR', 'Image generation worker is not configured', 500);
      await this.imageService.executeStep(step, this.workerId, signal, (progress, message) => {
        this.workflow.progress(step, progress, message);
      });
      return;
    }
    if (step.type === 'GENERATE_AI_SCENE_VIDEO' || step.type === 'GENERATE_AI_SHOT_VIDEO') {
      if (!this.videoService)
        throw new AppError('CONFIGURATION_ERROR', 'Video generation worker is not configured', 500);
      await this.videoService.executeStep(step, this.workerId, signal, (progress, message) => {
        this.workflow.progress(step, progress, message);
      });
      return;
    }
    if (step.type === 'EXTRACT_SHOT_CONTINUATION_FRAME') {
      if (!this.videoService)
        throw new AppError('CONFIGURATION_ERROR', 'Video generation worker is not configured', 500);
      await this.videoService.executeContinuationStep(step, signal, (progress, message) => {
        this.workflow.progress(step, progress, message);
      });
      return;
    }
    if (step.type === 'GENERATE_VISUAL_REFERENCE') {
      if (!this.visualReferenceService)
        throw new AppError('CONFIGURATION_ERROR', 'Visual reference worker is not configured', 500);
      await this.visualReferenceService.executeStep(step, signal);
      return;
    }
    if (
      step.type === 'GENERATE_CHARACTER_VISUAL_PROFILE' ||
      step.type === 'GENERATE_LOCATION_VISUAL_PROFILE' ||
      step.type === 'GENERATE_OBJECT_VISUAL_PROFILE'
    ) {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const subjectId = this.stepString(payload, 'subjectId');
      const options = {
        projectId,
        subjectId,
        instructions: typeof payload.instructions === 'string' ? payload.instructions : '',
        workflowStepId: step.id,
        signal,
        isCurrent: () => this.stepIsCurrent(step),
        onProgress: (event: Parameters<AiAgentProgress>[0]) => {
          const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
            event.stage
          ];
          this.workflow.progress(step, progress, event.message);
        },
      };
      if (step.type === 'GENERATE_CHARACTER_VISUAL_PROFILE')
        await this.visualService.generateCharacterProfile({ ...options, characterId: subjectId });
      else if (step.type === 'GENERATE_LOCATION_VISUAL_PROFILE')
        await this.visualService.generateLocationProfile({ ...options, locationId: subjectId });
      else
        await this.visualService.generateObjectProfile({
          ...options,
          objectKey: subjectId,
          objectName: subjectId,
        });
      return;
    }
    if (step.type === 'BUILD_VISUAL_PROMPT') {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      if (!this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Visual prompt build input is stale', 409);
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const sceneId = this.stepString(payload, 'sceneId');
      const expectedSceneRevision =
        payload.sceneRevision === undefined ? undefined : this.stepNumber(payload, 'sceneRevision');
      if (typeof payload.shotId === 'string') {
        this.visualService.buildShotPromptPackage({
          projectId,
          sceneId,
          shotId: this.stepString(payload, 'shotId'),
          expectedSceneRevision,
          expectedShotPlanRevision:
            payload.shotPlanRevision === undefined
              ? undefined
              : this.stepNumber(payload, 'shotPlanRevision'),
          generationId: step.id,
        });
      } else {
        this.visualService.buildPromptPackage({
          projectId,
          sceneId,
          expectedSceneRevision,
          generationId: step.id,
        });
      }
      this.workflow.progress(step, 1, 'Visual prompt package is current');
      return;
    }
    if (step.type === 'REFINE_VISUAL_PROMPT') {
      if (!this.visualService)
        throw new AppError(
          'CONFIGURATION_ERROR',
          'Visual Consistency worker is not configured',
          500,
        );
      const payload = this.parseStepPayload(step);
      const projectId = this.stepString(payload, 'projectId');
      const packageId = this.stepString(payload, 'packageId');
      const requestValue: Record<string, unknown> =
        payload.request && typeof payload.request === 'object' && !Array.isArray(payload.request)
          ? (payload.request as Record<string, unknown>)
          : {};
      const request = {
        instructions:
          typeof requestValue.instructions === 'string' ? requestValue.instructions : '',
        ...(typeof requestValue.expectedPackageRevision === 'number'
          ? { expectedPackageRevision: requestValue.expectedPackageRevision }
          : {}),
      };
      await this.visualService.refinePromptPackage(
        projectId,
        packageId,
        request,
        step.id,
        signal,
        (event) => {
          const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
            event.stage
          ];
          this.workflow.progress(step, progress, event.message);
        },
        () => this.stepIsCurrent(step),
      );
      return;
    }
    if (step.type === 'PLAN_SHOTS') {
      if (!this.shotDirector)
        throw new AppError('CONFIGURATION_ERROR', 'Shot Director worker is not configured', 500);
      await this.shotDirector.executeStep(step, signal, (event) => {
        const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
          event.stage
        ];
        this.workflow.progress(step, progress, event.message);
      });
      return;
    }
    if (
      step.type === 'GENERATE_SCENES' ||
      step.type === 'REGENERATE_SCENE' ||
      step.type === 'GENERATE_SCENE_PROMPT'
    ) {
      if (!this.sceneEngine)
        throw new AppError('CONFIGURATION_ERROR', 'Scene Engine worker is not configured', 500);
      await this.sceneEngine.executeStep(step, signal, (event) => {
        const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
          event.stage
        ];
        this.workflow.progress(step, progress, event.message);
      });
      return;
    }
    if (
      step.type === 'GENERATE_STORY_BLUEPRINT' ||
      step.type === 'GENERATE_CHAPTER_PLANS' ||
      step.type === 'GENERATE_CHAPTER' ||
      step.type === 'GENERATE_CHAPTER_SUMMARY' ||
      step.type === 'GENERATE_STORY_ARCS' ||
      step.type === 'GENERATE_CHAPTER_PLAN_WINDOW' ||
      step.type === 'GENERATE_CHAPTER_V2' ||
      step.type === 'ANALYZE_STORY_STATE' ||
      step.type === 'CHECK_CONTINUITY' ||
      step.type === 'SUMMARY_COMPACTION'
    ) {
      if (!this.storyEngine)
        throw new AppError('CONFIGURATION_ERROR', 'Story Engine worker is not configured', 500);
      await this.storyEngine.executeStep(step, signal, (event) => {
        const progress = { STARTING: 0.05, AUTHENTICATING: 0.1, GENERATING: 0.5, PARSING: 0.9 }[
          event.stage
        ];
        this.workflow.progress(step, progress, event.message);
      });
      return;
    }
    if (step.type === 'BUILD_SCENE_TIMING') {
      const payload = this.parseStepPayload(step);
      if (fingerprint(payload) !== step.input_fingerprint || !this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Scene timing input is stale', 409);
      const update =
        payload.update === undefined ? undefined : sceneTimingUpdateSchema.parse(payload.update);
      this.workflow.progress(step, 0.1, 'Measuring chapter audio and mapping TTS source spans');
      await this.timeline.buildSceneTiming(this.stepString(payload, 'chapterId'), update);
      this.workflow.progress(step, 1, 'Scene timing is current');
      return;
    }
    if (step.type === 'BUILD_MOTION_PLAN') {
      const payload = this.parseStepPayload(step);
      if (fingerprint(payload) !== step.input_fingerprint || !this.stepIsCurrent(step))
        throw new AppError('STALE_INPUT', 'Motion Plan input is stale', 409);
      const replace = payload.replace === true;
      this.workflow.progress(step, 0.1, 'Building deterministic Motion Plans');
      const plans = this.timeline.buildMotionPlans(this.stepString(payload, 'chapterId'), replace);
      this.workflow.progress(step, 1, `${plans.length} Motion Plans are current`);
      return;
    }
    if (step.type === 'CLEAN_TEXT') return;
    if (step.type === 'TTS_SEGMENT') {
      await this.executeTts(step, signal);
      return;
    }
    if (step.type === 'MERGE_AUDIO') {
      await this.executeMerge(step, signal);
      return;
    }
    if (step.type === 'SUBTITLE') {
      await this.executeSubtitle(step);
      return;
    }
    if (step.type === 'RENDER_SCENE_CLIP') {
      await this.executeSceneClipRender(step, signal);
      return;
    }
    if (step.type === 'RENDER_CHAPTER_VIDEO') {
      await this.executeChapterVideoRender(step, signal);
      return;
    }
    if (step.type === 'RENDER_PROJECT_VIDEO') {
      await this.executeProjectVideoRender(step, signal);
      return;
    }
    if (step.type === 'RENDER') {
      await this.executeRender(step, signal);
      return;
    }
    throw new Error(`Unknown workflow step: ${step.type}`);
  }
  private stepIsCurrent(step: ClaimedStep): boolean {
    const current = this.context.database.sqlite
      .prepare(
        "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=? AND input_fingerprint=?",
      )
      .get(step.id, step.attemptId, this.workerId, step.input_fingerprint);
    return Boolean(current);
  }
  private parseStepPayload(step: ClaimedStep): Record<string, unknown> {
    try {
      const payload = JSON.parse(step.payload || '{}') as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload))
        return payload as Record<string, unknown>;
    } catch {
      // Fall through to the typed workflow error below.
    }
    throw new AppError('INVALID_INPUT', 'Workflow step payload is invalid', 400);
  }
  private stepNumber(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
      throw new AppError('INVALID_INPUT', `Workflow step ${key} must be a positive integer`, 400);
    return value;
  }

  private stepString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim())
      throw new AppError('INVALID_INPUT', `Workflow step ${key} is required`, 400);
    return value;
  }

  private async executeTts(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const segment = this.context.database.sqlite
      .prepare(
        'SELECT chapter_id as chapterId,text,text_hash as textHash,status,fingerprint FROM tts_segments WHERE id=? AND chapter_id=?',
      )
      .get(step.id, step.entity_id) as
      | { chapterId: Id; text: string; textHash: string; status: string; fingerprint: string }
      | undefined;
    if (!segment || segment.fingerprint !== step.input_fingerprint || segment.status !== 'PENDING')
      throw new Error('TTS segment is stale or unavailable');
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    if (!this.stepIsCurrent(step)) throw new Error('TTS segment input is stale');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, `${step.id}.mp3`);
    await this.tts.synthesize(
      segment.text,
      process.env.EDGE_TTS_VOICE ?? 'vi-VN-HoaiMyNeural',
      output,
      signal,
    );
    if (!this.stepIsCurrent(step)) throw new Error('TTS segment input changed during synthesis');
    const measured = await this.context.media.measureAudioDuration(output);
    const silence = await this.context.media.detectAudioSilence(output, measured.durationMs);
    const durationMs = measured.durationMs;
    const qualityIssues = ttsQualityIssues({
      durationMs,
      activityRatio: silence.activityRatio,
      textLength: segment.text.trim().length,
      provider: 'EDGE_TTS',
    });
    if (qualityIssues.length)
      throw new AppError(
        'TTS_QUALITY_REJECTED',
        `TTS audio failed quality checks: ${qualityIssues.join(', ')}`,
        422,
        true,
      );
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'audio',
      'segments',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    const assetId = randomUUID();
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
        id: assetId,
        projectId: chapter.projectId,
        type: 'TTS_SEGMENT_AUDIO',
        role: `segment:${step.id}`,
        path: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: 'audio/mpeg',
        bytes: digest.bytes,
        sha256: digest.hash,
        sourceEntityId: chapter.id,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
        metadata: {
          durationMs,
          durationProvenance: measured.provenance,
          activityRatio: silence.activityRatio,
          totalSilenceMs: silence.totalSilenceMs,
        },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('TTS segment input changed before promotion');
    }
    const result = this.context.database.sqlite
      .prepare(
        "UPDATE tts_segments SET status='COMPLETED',audio_asset_id=?,duration_ms=?,error=NULL WHERE id=? AND fingerprint=?",
      )
      .run(assetId, durationMs, step.id, step.input_fingerprint);
    if (result.changes !== 1) {
      assets.invalidateRole(chapter.projectId, `segment:${step.id}`);
      throw new Error('TTS segment record changed before completion');
    }
  }
  private async executeMerge(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    const rows = this.context.database.sqlite
      .prepare(
        'SELECT t.status,t.text_hash as textHash,a.path,a.status as assetStatus,a.is_current as isCurrent FROM tts_segments t LEFT JOIN assets a ON a.id=t.audio_asset_id WHERE t.chapter_id=? ORDER BY t.segment_index',
      )
      .all(chapter.id) as Array<{
      status: string;
      textHash: string;
      path: string | null;
      assetStatus: string | null;
      isCurrent: number | null;
    }>;
    const expectedFingerprint = fingerprint({
      chapterId: chapter.id,
      segments: rows.map((row) => row.textHash),
    });
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.status !== 'COMPLETED' ||
          !row.path ||
          row.assetStatus !== 'READY' ||
          row.isCurrent !== 1,
      ) ||
      expectedFingerprint !== step.input_fingerprint
    )
      throw new Error('TTS segments are incomplete or stale');
    if (!this.stepIsCurrent(step)) throw new Error('Merge input is stale');
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const list = join(staging, 'concat.txt');
    await writeFile(
      list,
      rows
        .map(
          (row) => `file '${join(this.context.workspace.root, row.path!).replaceAll('\\', '/')}'`,
        )
        .join('\n'),
      'utf8',
    );
    const output = join(staging, 'chapter.mp3');
    await this.context.media.run(buildConcatArguments(list, output), { signal });
    if (!this.stepIsCurrent(step)) throw new Error('Merge input changed during execution');
    const probe = await this.context.media.probe(output);
    const durationMs = Math.round(
      Number((probe['format'] as { duration?: string })?.duration ?? 0) * 1000,
    );
    if (!durationMs) throw new Error('Merged audio produced no duration');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'audio',
      `${chapter.id}-${step.id}.mp3`,
    );
    await promoteFile(output, destination);
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
        id: randomUUID(),
        projectId: chapter.projectId,
        type: 'CHAPTER_AUDIO',
        role: `chapter:${chapter.id}:audio`,
        path: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: 'audio/mpeg',
        bytes: digest.bytes,
        sha256: digest.hash,
        sourceEntityId: chapter.id,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
        metadata: { durationMs },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('Merge input changed before promotion');
    }
  }
  private async executeSubtitle(step: ClaimedStep): Promise<void> {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId,id,content FROM chapters WHERE id=?')
      .get(step.entity_id) as { projectId: Id; id: Id; content: string } | undefined;
    if (!chapter) throw new Error('Chapter not found');
    if (
      fingerprint({ chapterId: chapter.id, content: chapter.content }) !== step.input_fingerprint ||
      !this.stepIsCurrent(step)
    )
      throw new Error('Subtitle input is stale');
    const segments = this.context.database.sqlite
      .prepare(
        "SELECT text,duration_ms as durationMs FROM tts_segments WHERE chapter_id=? AND status='COMPLETED' ORDER BY segment_index",
      )
      .all(chapter.id) as Array<{ text: string; durationMs: number }>;
    if (!segments.length || segments.some((segment) => !segment.durationMs))
      throw new Error('TTS durations are incomplete');
    const srt = serializeSrt(subtitlesFromSegments(segments));
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, 'chapter.srt');
    await writeFile(output, srt, 'utf8');
    if (!this.stepIsCurrent(step)) throw new Error('Subtitle input changed during execution');
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      chapter.projectId,
      'subtitles',
      `${chapter.id}-${step.id}.srt`,
    );
    await promoteFile(output, destination);
    const assets = new AssetRepository(this.context.database);
    const registered = assets.registerIfCurrentStep(
      {
        id: randomUUID(),
        projectId: chapter.projectId,
        type: 'SUBTITLE',
        role: `chapter:${chapter.id}:subtitle`,
        path: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: 'text/plain',
        bytes: digest.bytes,
        sha256: digest.hash,
        sourceEntityId: chapter.id,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(destination, { force: true });
      throw new Error('Subtitle input changed before promotion');
    }
  }
  private renderJob(step: ClaimedStep) {
    const job = this.timeline.renderJobs.getByStep(step.id);
    if (!job) throw new AppError('RENDER_JOB_NOT_FOUND', 'Render job is missing', 500);
    return job;
  }
  private async recoverRegisteredRender(
    step: ClaimedStep,
    assetType: 'SCENE_VIDEO_CLIP' | 'CHAPTER_VIDEO' | 'PROJECT_VIDEO',
  ): Promise<boolean> {
    const row = this.context.database.sqlite
      .prepare(
        `SELECT id,path,metadata
         FROM assets
         WHERE source_step_id=? AND input_fingerprint=? AND type=? AND status='READY' AND is_current=1
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(step.id, step.input_fingerprint, assetType) as
      { id: string; path: string; metadata: string } | undefined;
    if (!row) return false;
    try {
      await stat(safeWorkspacePath(this.context.workspace.root, row.path));
    } catch {
      return false;
    }
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        metadata = parsed as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    const durationMs =
      typeof metadata.durationMs === 'number' && Number.isInteger(metadata.durationMs)
        ? metadata.durationMs
        : null;
    const job = this.renderJob(step);
    this.timeline.renderJobs.linkAssets(job.id, null, row.id);
    if (durationMs !== null)
      this.timeline.renderJobs.updateProgress(job.id, durationMs, durationMs);
    return true;
  }

  private reportRenderProgress(
    step: ClaimedStep,
    jobId: Id,
    timeMs: number | null,
    durationMs: number,
  ): void {
    if (timeMs === null) return;
    const progress = Math.max(0, Math.min(1, timeMs / durationMs));
    this.workflow.progress(step, progress, `FFmpeg ${Math.round(progress * 100)}%`);
    this.timeline.renderJobs.updateProgress(jobId, Math.max(0, Math.round(timeMs)));
  }

  private async executeSceneClipRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderSceneClipPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.sceneId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Scene Clip inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'SCENE_VIDEO_CLIP')) return;
    const assets = new AssetRepository(this.context.database);
    const currentImage = assets.currentRenderableSceneImage(
      payload.projectId,
      payload.sceneStableId,
    );
    const sourceAsset = payload.imagePath
      ? (this.context.database.sqlite
          .prepare(
            `SELECT id,path,role,type,sha256,input_fingerprint as inputFingerprint,metadata
             FROM assets WHERE project_id=? AND path=? AND sha256=? AND status='READY' LIMIT 1`,
          )
          .get(payload.projectId, payload.imagePath, payload.imageSha256) as
          | {
              id: Id;
              path: string;
              role: string;
              type: string;
              sha256: string;
              inputFingerprint: string | null;
              metadata: string;
            }
          | undefined)
      : null;
    if (payload.imagePath && !sourceAsset)
      throw new AppError('STALE_INPUT', 'Scene fallback asset is no longer available', 409);
    if (payload.fallbackPolicy === 'BLACK' && payload.imagePath)
      throw new AppError(
        'RENDER_INPUT_INVALID',
        'BLACK fallback cannot include an image source',
        409,
      );
    if (sourceAsset) {
      const expectedCurrent =
        sourceAsset.role === `scene:${payload.sceneStableId}:image`
          ? currentImage
          : sourceAsset.role === 'project:background'
            ? assets.current(payload.projectId, 'project:background')
            : null;
      const historicalHold =
        payload.fallbackPolicy === 'HOLD_PREVIOUS' &&
        sourceAsset.role === `scene:${payload.sceneStableId}:image` &&
        !currentImage;
      if (!historicalHold && (!expectedCurrent || expectedCurrent.sha256 !== sourceAsset.sha256))
        throw new AppError('STALE_INPUT', 'Scene image fallback changed before rendering', 409);
    }
    const sourcePath = payload.imagePath
      ? safeWorkspacePath(this.context.workspace.root, payload.imagePath)
      : null;
    if (sourcePath && payload.imageSha256) {
      const sourceDigest = await sha256File(sourcePath);
      if (sourceDigest.hash !== payload.imageSha256)
        throw new AppError('STALE_INPUT', 'Scene image content changed before rendering', 409);
    }
    const stagingRelativePath = `staging/${step.attemptId}/scene-clip.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    const job = this.renderJob(step);
    let rawClipPath = payload.rawClipPath
      ? safeWorkspacePath(this.context.workspace.root, payload.rawClipPath)
      : null;
    let rawClipDurationMs = payload.rawClipDurationMs ?? 0;
    const shotAssets: Array<{ asset: CurrentAsset; durationMs: number }> = [];
    if (payload.shotClips.length > 0) {
      for (const clip of payload.shotClips) {
        const generation = this.sceneVideos.getCurrent(
          payload.projectId,
          payload.sceneStableId,
          clip.shotId,
        );
        const asset = assets.current(
          payload.projectId,
          sceneVideoRole(payload.sceneStableId, clip.shotId),
        );
        if (
          !generation ||
          generation.status !== 'COMPLETED' ||
          generation.freshness !== 'CURRENT' ||
          generation.assetId !== asset?.id ||
          (generation.automaticQualityStatus !== 'PASSED' &&
            generation.reviewStatus !== 'ACCEPTED') ||
          !asset ||
          asset.path !== clip.path ||
          asset.sha256 !== clip.sha256 ||
          asset.inputFingerprint !== clip.fingerprint
        )
          throw new AppError('STALE_INPUT', `Shot ${clip.shotId} is no longer current`, 409);
        shotAssets.push({ asset, durationMs: clip.durationMs });
      }
      const concatListPath = join(dirname(stagingPath), 'shot-clips.txt');
      await writeFile(
        concatListPath,
        shotAssets
          .map(
            ({ asset }) =>
              `file '${safeWorkspacePath(this.context.workspace.root, asset.path).replaceAll('\\', '/')}'`,
          )
          .join('\n'),
        'utf8',
      );
      const concatPath = join(dirname(stagingPath), 'shot-clips.mp4');
      await this.context.media.run(buildConcatArguments(concatListPath, concatPath), {
        cwd: this.context.workspace.root,
        signal,
      });
      const concatProbe = await this.context.media.probe(concatPath);
      rawClipDurationMs = Math.round(
        Number((concatProbe['format'] as { duration?: string })?.duration ?? 0) * 1000,
      );
      if (!rawClipDurationMs)
        throw new AppError('RENDER_INPUT_INVALID', 'Shot videos produced no duration', 409);
      rawClipPath = concatPath;
    }
    const isAiClip = payload.clipSource !== 'KEN_BURNS' && Boolean(rawClipPath);
    if (payload.clipSource !== 'KEN_BURNS' && !isAiClip)
      throw new AppError(
        'RENDER_INPUT_INVALID',
        'AI scene clip has no accepted motion source',
        409,
      );
    const needsSourceImage = isAiClip && rawClipDurationMs < payload.timing.durationMs;
    if (needsSourceImage && (!sourcePath || !payload.imageWidth || !payload.imageHeight))
      throw new AppError(
        'RENDER_INPUT_INVALID',
        'AI scene clip needs an accepted image to cover its remaining duration',
        400,
      );
    const clipArguments = isAiClip
      ? buildAiSceneClipArguments({
          rawClipPath: rawClipPath!,
          rawClipDurationMs,
          sourceImagePath: sourcePath ?? '',
          sourceWidth: payload.imageWidth ?? 0,
          sourceHeight: payload.imageHeight ?? 0,
          outputPath: stagingPath,
          sceneDurationMs: payload.timing.durationMs,
          crossfadeMs: payload.crossfadeMs,
          profile: {
            width: payload.config.width,
            height: payload.config.height,
            fps: payload.config.fps,
            qualityPreset: payload.config.qualityPreset,
          },
          fitMode: payload.config.fitMode,
          continuationMotion: payload.motionPlan,
        })
      : buildSceneClipArguments({
          sourcePath,
          outputPath: stagingPath,
          durationMs: payload.timing.durationMs,
          sourceWidth: payload.imageWidth,
          sourceHeight: payload.imageHeight,
          profile: {
            width: payload.config.width,
            height: payload.config.height,
            fps: payload.config.fps,
            qualityPreset: payload.config.qualityPreset,
          },
          fitMode: payload.config.fitMode,
          motionPlan: payload.motionPlan,
          fallback: payload.fallbackPolicy === 'BLACK' ? 'BLACK' : undefined,
        });
    await this.context.media.runWithProgress(
      clipArguments,
      (update) =>
        this.reportRenderProgress(step, job.id, update.outTimeMs, payload.timing.durationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.timing.durationMs,
      durationToleranceMs: 250,
      requireAudio: false,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'SCENE_VIDEO_CLIP',
        role: `scene:${payload.sceneStableId}:video`,
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.sceneId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: {
          durationMs: payload.timing.durationMs,
          sceneRevision: payload.motionPlan.sceneRevision,
          timingRevision: payload.timingRevision,
          motionPlanId: payload.motionPlan.id,
          fallbackPolicy: payload.fallbackPolicy,
          shotClips: payload.shotClips,
          probe,
        },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Scene Clip inputs changed before asset registration', 409);
    }
    if (sourceAsset) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: sourceAsset.id,
        role: payload.fallbackPolicy === 'HOLD_PREVIOUS' ? 'SCENE_IMAGE_FALLBACK' : 'SCENE_IMAGE',
        sourceHash: sourceAsset.sha256,
      });
    }
    for (const { asset } of shotAssets)
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: asset.id,
        role: 'SHOT_VIDEO',
        sourceHash: asset.sha256,
      });
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(
      job.id,
      payload.timing.durationMs,
      payload.timing.durationMs,
    );
  }

  private async executeChapterVideoRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderChapterPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.chapterId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Chapter Video inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'CHAPTER_VIDEO')) return;
    const assets = new AssetRepository(this.context.database);
    const clips = payload.clips.map((clip) => {
      const asset = assets.current(payload.projectId, `scene:${clip.sceneStableId}:video`);
      if (!asset || asset.inputFingerprint !== clip.fingerprint)
        throw new AppError('STALE_INPUT', `Scene Clip ${clip.sceneId} is not current`, 409);
      return { asset, durationMs: clip.durationMs };
    });
    const narration = assets.current(payload.projectId, `chapter:${payload.chapterId}:audio`);
    const subtitle = assets.current(payload.projectId, `chapter:${payload.chapterId}:subtitle`);
    if (
      !narration ||
      !subtitle ||
      narration.path !== payload.narrationPath ||
      subtitle.path !== payload.subtitlePath ||
      narration.sha256 !== payload.narrationSha256 ||
      subtitle.sha256 !== payload.subtitleSha256
    )
      throw new AppError(
        'STALE_INPUT',
        'Chapter narration or subtitles changed before rendering',
        409,
      );
    const stagingRelativePath = `staging/${step.attemptId}/chapter-video.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    const job = this.renderJob(step);
    await this.context.media.runWithProgress(
      buildChapterVideoArguments({
        clips: clips.map(({ asset, durationMs }) => ({
          path: safeWorkspacePath(this.context.workspace.root, asset.path),
          durationMs,
        })),
        narrationPath: safeWorkspacePath(this.context.workspace.root, narration.path),
        subtitlePath: safeWorkspacePath(this.context.workspace.root, subtitle.path),
        outputPath: stagingPath,
        durationMs: payload.durationMs,
        profile: {
          width: payload.config.width,
          height: payload.config.height,
          fps: payload.config.fps,
          qualityPreset: payload.config.qualityPreset,
        },
        transition: payload.config.transition,
        transitionDurationMs: payload.config.transitionDurationMs,
        subtitleStyle: {
          position: payload.config.subtitlePosition,
          fontSize: payload.config.subtitleFontSize,
          outlineWidth: payload.config.subtitleOutlineWidth,
        },
        narrationVolume: payload.config.narrationVolume,
      }),
      (update) => this.reportRenderProgress(step, job.id, update.outTimeMs, payload.durationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.durationMs,
      durationToleranceMs: 350,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Chapter Video inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Chapter Video inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'CHAPTER_VIDEO',
        role: `chapter:${payload.chapterId}:video`,
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.chapterId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: { durationMs: payload.durationMs, timingRevision: payload.timingRevision, probe },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError(
        'STALE_INPUT',
        'Chapter Video inputs changed before asset registration',
        409,
      );
    }
    for (const clip of clips) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: clip.asset.id,
        role: 'SCENE_VIDEO_CLIP',
        sourceHash: clip.asset.sha256,
      });
    }
    assets.addDependency({
      assetId: outputAssetId,
      dependsOnAssetId: narration.id,
      role: 'NARRATION',
      sourceHash: narration.sha256,
    });
    assets.addDependency({
      assetId: outputAssetId,
      dependsOnAssetId: subtitle.id,
      role: 'SUBTITLE',
      sourceHash: subtitle.sha256,
    });
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(job.id, payload.durationMs, payload.durationMs);
  }

  private async executeProjectVideoRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const payload = renderProjectPayloadSchema.parse(this.parseStepPayload(step));
    if (
      payload.fingerprint !== step.input_fingerprint ||
      payload.projectId !== step.entity_id ||
      !this.stepIsCurrent(step)
    )
      throw new AppError('STALE_INPUT', 'Project Video inputs are stale', 409);
    if (await this.recoverRegisteredRender(step, 'PROJECT_VIDEO')) return;
    const assets = new AssetRepository(this.context.database);
    const chapters = payload.chapters.map((chapter) => {
      const asset = assets.current(payload.projectId, `chapter:${chapter.chapterId}:video`);
      if (!asset || asset.inputFingerprint !== chapter.fingerprint)
        throw new AppError('STALE_INPUT', `Chapter Video ${chapter.chapterId} is not current`, 409);
      return { asset, chapterId: chapter.chapterId, durationMs: chapter.durationMs };
    });
    const music = payload.config.musicEnabled
      ? assets.current(payload.projectId, 'project:music')
      : null;
    if (
      payload.config.musicEnabled &&
      (!music ||
        !payload.musicPath ||
        !payload.musicSha256 ||
        music.path !== payload.musicPath ||
        music.sha256 !== payload.musicSha256)
    )
      throw new AppError('STALE_INPUT', 'Project music changed before rendering', 409);
    const stagingRoot = `staging/${step.attemptId}`;
    const stagingRelativePath = `${stagingRoot}/project-video.mp4`;
    const stagingPath = safeWorkspacePath(this.context.workspace.root, stagingRelativePath);
    const chapterListRelativePath = `${stagingRoot}/chapters.txt`;
    const chapterListPath = safeWorkspacePath(this.context.workspace.root, chapterListRelativePath);
    await mkdir(dirname(stagingPath), { recursive: true });
    await writeFile(
      chapterListPath,
      `${chapters
        .map(
          ({ asset }) =>
            `file '${safeWorkspacePath(this.context.workspace.root, asset.path).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`,
        )
        .join(String.fromCharCode(10))}${String.fromCharCode(10)}`,
      'utf8',
    );
    const job = this.renderJob(step);
    await this.context.media.runWithProgress(
      buildProjectVideoArguments({
        chapters: chapters.map(({ asset, chapterId, durationMs }) => ({
          chapterId,
          path: safeWorkspacePath(this.context.workspace.root, asset.path),
          durationMs,
        })),
        chapterListPath,
        outputPath: stagingPath,
        durationMs: payload.expectedDurationMs,
        profile: {
          width: payload.config.width,
          height: payload.config.height,
          fps: payload.config.fps,
          qualityPreset: payload.config.qualityPreset,
        },
        musicPath: music
          ? safeWorkspacePath(this.context.workspace.root, payload.musicPath!)
          : undefined,
        musicEnabled: payload.config.musicEnabled,
        loopMusic: payload.config.loopMusic,
        narrationVolume: payload.config.narrationVolume,
        musicVolume: payload.config.musicVolume,
      }),
      (update) =>
        this.reportRenderProgress(step, job.id, update.outTimeMs, payload.expectedDurationMs),
      { cwd: this.context.workspace.root, signal },
    );
    const probe = await validateHierarchicalVideo(this.context.media, stagingPath, {
      width: payload.config.width,
      height: payload.config.height,
      fps: payload.config.fps,
      expectedDurationMs: payload.expectedDurationMs,
      durationToleranceMs: 500,
      requireAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioSampleRate: 48_000,
      container: 'mp4',
    });
    if (!this.stepIsCurrent(step))
      throw new AppError('STALE_INPUT', 'Project Video inputs changed during rendering', 409);
    const promoted = await promoteManagedFile(
      this.context.workspace,
      stagingRelativePath,
      payload.outputPath,
    );
    const outputPath = safeWorkspacePath(this.context.workspace.root, payload.outputPath);
    if (!this.stepIsCurrent(step)) {
      await rm(outputPath, { force: true });
      throw new AppError('STALE_INPUT', 'Project Video inputs changed before promotion', 409);
    }
    const outputAssetId = randomUUID();
    const registered = assets.registerIfCurrentStep(
      {
        id: outputAssetId,
        projectId: payload.projectId,
        type: 'PROJECT_VIDEO',
        role: projectVideoRole(payload.projectId, payload.scope),
        path: promoted.relativePath,
        mediaType: 'video/mp4',
        bytes: promoted.bytes,
        sha256: promoted.hash,
        sourceEntityId: payload.projectId,
        sourceStepId: step.id,
        inputFingerprint: payload.fingerprint,
        metadata: {
          durationMs: payload.expectedDurationMs,
          scope: payload.scope,
          chapters: payload.chapters,
          probe,
        },
      },
      {
        stepId: step.id,
        attemptId: step.attemptId,
        workerId: this.workerId,
        inputFingerprint: step.input_fingerprint,
      },
    );
    if (!registered) {
      await rm(outputPath, { force: true });
      throw new AppError(
        'STALE_INPUT',
        'Project Video inputs changed before asset registration',
        409,
      );
    }
    for (const chapter of chapters) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: chapter.asset.id,
        role: 'CHAPTER_VIDEO',
        sourceHash: chapter.asset.sha256,
      });
    }
    if (music) {
      assets.addDependency({
        assetId: outputAssetId,
        dependsOnAssetId: music.id,
        role: 'MUSIC',
        sourceHash: music.sha256,
      });
    }
    this.timeline.renderJobs.linkAssets(job.id, null, outputAssetId);
    this.timeline.renderJobs.updateProgress(
      job.id,
      payload.expectedDurationMs,
      payload.expectedDurationMs,
    );
  }

  private async executeRender(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const projectId = step.entity_id;
    const chapter = this.context.database.sqlite
      .prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY number LIMIT 1')
      .get(projectId) as { id: Id } | undefined;
    const audio = chapter
      ? (this.context.database.sqlite
          .prepare('SELECT path FROM assets WHERE project_id=? AND role=? AND is_current=1')
          .get(projectId, `chapter:${chapter.id}:audio`) as { path: string } | undefined)
      : undefined;
    const background = this.context.database.sqlite
      .prepare(
        "SELECT path,type FROM assets WHERE project_id=? AND role='project:background' AND is_current=1",
      )
      .get(projectId) as { path: string; type: string } | undefined;
    const subtitle = chapter
      ? (this.context.database.sqlite
          .prepare('SELECT path FROM assets WHERE project_id=? AND role=? AND is_current=1')
          .get(projectId, `chapter:${chapter.id}:subtitle`) as { path: string } | undefined)
      : undefined;
    const music = this.context.database.sqlite
      .prepare(
        "SELECT path FROM assets WHERE project_id=? AND role='project:music' AND is_current=1",
      )
      .get(projectId) as { path: string } | undefined;
    if (!audio || !background || !subtitle)
      throw new Error('Current chapter audio, subtitles, and background are required');
    const project = this.context.database.sqlite
      .prepare('SELECT render_config as renderConfig FROM projects WHERE id=?')
      .get(projectId) as { renderConfig: string };
    const config = renderConfigSchema.parse(JSON.parse(project.renderConfig));
    const audioPath = join(this.context.workspace.root, audio.path);
    const staging = join(this.context.workspace.staging, step.attemptId);
    await mkdir(staging, { recursive: true });
    const output = join(staging, 'render.mp4');
    const probe = await this.context.media.probe(audioPath);
    const duration = Number((probe.format as { duration?: string } | undefined)?.duration ?? 0);
    const musicPath =
      config.musicEnabled && music ? join(this.context.workspace.root, music.path) : undefined;
    const backgroundPath = join(this.context.workspace.root, background.path);
    const subtitlePath = join(this.context.workspace.root, subtitle.path);
    const currentInputs = this.context.database.sqlite
      .prepare(
        'SELECT role,path,sha256 FROM assets WHERE project_id=? AND is_current=1 ORDER BY role',
      )
      .all(projectId) as Array<{ role: string; path: string; sha256: string }>;
    if (
      fingerprint({
        projectId,
        config,
        inputs: currentInputs.map(({ role, sha256 }) => ({ role, sha256 })),
      }) !== step.input_fingerprint
    )
      throw new Error('Render inputs are stale');
    const manifest = {
      version: 1,
      projectId,
      chapterId: chapter?.id ?? null,
      durationMs: Math.round(duration * 1000),
      configuration: config,
      inputs: currentInputs,
    };
    const manifestStaging = join(staging, 'timeline.json');
    await writeFile(manifestStaging, JSON.stringify(manifest), 'utf8');
    await this.context.media.run(
      [
        ...buildRenderArguments({
          backgroundPath,
          backgroundType: background.type as 'BACKGROUND_IMAGE' | 'BACKGROUND_VIDEO',
          narrationPath: audioPath,
          subtitlePath,
          subtitleFontSize: config.subtitleFontSize,
          musicPath,
          loopMusic: config.loopMusic,
          durationSeconds: duration,
          width: config.width,
          height: config.height,
          fps: config.fps,
          narrationVolume: config.narrationVolume,
          musicVolume: config.musicVolume,
        }),
        output,
      ],
      { cwd: this.context.workspace.root, signal },
    );
    const outputProbe = await this.context.media.probe(output);
    const outputStreams = Array.isArray(outputProbe.streams) ? outputProbe.streams : [];
    const videoStream = outputStreams.find(
      (stream): stream is { codec_type?: string; width?: number; height?: number } =>
        Boolean(
          stream &&
          typeof stream === 'object' &&
          'codec_type' in stream &&
          stream.codec_type === 'video',
        ),
    );
    const audioStream = outputStreams.some(
      (stream) =>
        stream &&
        typeof stream === 'object' &&
        'codec_type' in stream &&
        stream.codec_type === 'audio',
    );
    const outputDuration = Number(
      (outputProbe.format as { duration?: string } | undefined)?.duration ?? 0,
    );
    if (
      !videoStream ||
      !audioStream ||
      videoStream.width !== config.width ||
      videoStream.height !== config.height ||
      outputDuration <= 0
    )
      throw new Error('Rendered MP4 failed validation');
    const assets = new AssetRepository(this.context.database);
    const timelineDestination = join(
      this.context.workspace.projects,
      projectId,
      'renders',
      `${step.id}.timeline.json`,
    );
    const timelineDigest = await sha256File(manifestStaging);
    await promoteFile(manifestStaging, timelineDestination);
    const guard = {
      stepId: step.id,
      attemptId: step.attemptId,
      workerId: this.workerId,
      inputFingerprint: step.input_fingerprint,
    };
    const timelineRegistered = assets.registerIfCurrentStep(
      {
        id: randomUUID(),
        projectId,
        type: 'TIMELINE_MANIFEST',
        role: 'project:timeline',
        path: relativeAssetPath(this.context.workspace.root, timelineDestination),
        mediaType: 'application/json',
        bytes: timelineDigest.bytes,
        sha256: timelineDigest.hash,
        sourceEntityId: projectId,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
        metadata: manifest,
      },
      guard,
    );
    if (!timelineRegistered) {
      await rm(timelineDestination, { force: true });
      throw new Error('Render inputs changed before manifest promotion');
    }
    const digest = await sha256File(output);
    const destination = join(
      this.context.workspace.projects,
      projectId,
      'renders',
      `${step.id}.mp4`,
    );
    await promoteFile(output, destination);
    const renderRegistered = assets.registerIfCurrentStep(
      {
        id: randomUUID(),
        projectId,
        type: 'RENDERED_VIDEO',
        role: 'project:render',
        path: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: 'video/mp4',
        bytes: digest.bytes,
        sha256: digest.hash,
        sourceEntityId: projectId,
        sourceStepId: step.id,
        inputFingerprint: step.input_fingerprint,
        metadata: { duration, probe: outputProbe },
      },
      guard,
    );
    if (!renderRegistered) {
      await rm(destination, { force: true });
      throw new Error('Render inputs changed before output promotion');
    }
  }
}

export async function createContext(root: string, db: DatabaseHandle): Promise<StudioContext> {
  const workspace = await initializeWorkspace(root);
  return {
    database: db,
    workspace,
    runner: new ProcessRunner(),
    media: new FfmpegTools(new ProcessRunner()),
  };
}
export {
  parseSrt,
  segmentNarrationText,
  serializeSrt,
  subtitlesFromSegments,
  validateSubtitleCues,
} from './text.js';
export * from './omp-agent.js';
export * from './story-context.js';
export * from './story-prompts.js';
export * from './story-engine.js';
export * from './story-state.js';
export * from './scene-timing.js';
export * from './motion-plan.js';
export * from './timeline-workflow.js';
export * from './media-critics.js';
export * from './quality-policy.js';
export * from './shot-continuity.js';
export * from './shot-director.js';
export * from './shot-validation.js';
export * from './tts-quality.js';
export * from './video-backends.js';
export * from './visual-references.js';
