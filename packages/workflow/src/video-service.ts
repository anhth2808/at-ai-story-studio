import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  AppError,
  aiMotionPlanUpdateSchema,
  aiVideoBatchSchema,
  continuationSourceSchema,
  sceneMotionSourceUpdateSchema,
  sceneVideoRegenerationSchema,
  sceneVideoReviewUpdateSchema,
  videoGenerationRequestSchema,
  videoGenerationSettingsUpdateSchema,
  VIDEO_OUTPUT_FPS,
  VIDEO_PRESETS,
  type AiMotionPlanDto,
  type ContinuationSource,
  type Id,
  type MotionSource,
  type SceneDto,
  type SceneVideoGenerationDto,
  type ShotPlanCandidate,
  type ShotPlanDto,
  type VideoGenerationRequest,
  type VideoGenerationSettingsDto,
  type VideoBackend,
  type VideoReadiness,
} from '@studio/shared';
import { z } from 'zod';
import {
  AiMotionPlanRepository,
  AssetRepository,
  MediaCriticEvaluationRepository,
  ProductionProfileRepository,
  SceneMotionSourceRepository,
  SceneRepository,
  SceneVideoGenerationRepository,
  ShotPlanRepository,
  ShotTimingAllocationRepository,
  TimelineRepository,
  VideoGenerationSettingsRepository,
  WorkflowRepository,
  videoSettingsFingerprint,
  type ClaimedStep,
  type CurrentAsset,
} from '@studio/database';
import {
  managedMotionRelativePath,
  managedShotMotionRelativePath,
  prepareProjectDirectories,
  promoteFile,
  relativeAssetPath,
  safeWorkspacePath,
  sha256File,
  validateImageFile,
  validateRawAiVideo,
} from '@studio/media';
import {
  ComfyUiVideoProvider,
  VideoProviderError,
  type VideoGenerationProvider,
} from './comfyui-video.js';
import { allocateFramePlans, resolveVideoBackend, type FramePlan } from './video-backends.js';
import {
  aiMotionPlanFingerprint,
  compileMotionPrompt,
  createDefaultAiMotionPlan,
} from './ai-motion-plan.js';
import { continuationEligibility } from './shot-continuity.js';
import { temporalRetryGuidance, VideoCritic } from './media-critics.js';
import { automaticQualityAction } from './quality-policy.js';
import type { AiAgent } from './omp-agent.js';
import type { StudioContext } from './index.js';

const scheduledVideoRequestSchema = z
  .object({
    request: videoGenerationRequestSchema,
    motionPlanFingerprint: z.string().min(1).max(128),
    shotPlanFingerprint: z.string().min(1).max(128).nullable().optional(),
    settingsFingerprint: z.string().min(1).max(128),
    requireImageApproval: z.boolean().optional(),
    requireHumanApproval: z.boolean().optional(),
    qualityFallback: z.enum(['BLOCK', 'MANUAL_REVIEW', 'ALLOW_DEGRADED_WITH_REVIEW']).optional(),
    temporalRetryLimit: z.number().int().min(0).max(3).optional(),
  })
  .passthrough();

const videoStepPayloadSchema = z
  .object({ projectId: z.string().uuid(), generationId: z.string().uuid() })
  .strict();
const continuationStepPayloadSchema = z
  .object({
    projectId: z.string().uuid(),
    generationId: z.string().uuid(),
    sceneRevisionId: z.string().uuid(),
    sceneStableId: z.string().min(1).max(120),
    shotPlanId: z.string().uuid(),
    shotId: z.string().min(1).max(120),
    sourceShotId: z.string().min(1).max(120),
    sourceVideoAssetId: z.string().uuid(),
    sourceVideoSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    frameAssetId: z.string().uuid(),
    framePath: z.string().min(1).max(1_000),
    framePosition: z.number().min(0).max(1),
    extractorVersion: z.string().min(1).max(80),
  })
  .strict();

export type SceneVideoScheduleResult = {
  executionId: Id;
  stepId: Id | null;
  jobId: Id | null;
  generation: SceneVideoGenerationDto;
  reused: boolean;
};

export type SceneVideoBatchScheduleResult = {
  executionId: Id;
  jobs: SceneVideoScheduleResult[];
  skippedSceneIds: Id[];
};

type SceneIntentInput = {
  sceneNumber: number;
  purpose: string;
  cameraMovementIntent: string | null;
  weather: string;
  mood: string;
  subjectFocus: string;
  characterPositions: Array<{ position?: string }>;
};

// Deterministic issue-to-guidance mapping for regenerate-with-feedback. The
// original motion intent stays canonical; the guidance only shapes the next
// generation request.
const ISSUE_GUIDANCE: Record<string, string> = {
  IDENTITY_DRIFT: 'Preserve the exact face, hair, and clothing from the input image.',
  FACE_DISTORTION: 'Keep the face completely stable; avoid facial motion.',
  BODY_DISTORTION: 'Keep the body pose nearly static; avoid limb motion.',
  EXTRA_LIMBS: 'Avoid any movement that could create extra or duplicated limbs.',
  MOTION_TOO_STRONG: 'Reduce overall motion amplitude; move less and slower.',
  MOTION_TOO_WEAK: 'Increase motion slightly while staying natural.',
  CAMERA_WRONG: 'Use the specified camera move only; no other camera motion.',
  OBJECT_MORPHING: 'Keep important objects rigid and unchanged.',
  BACKGROUND_MORPHING: 'Keep the background geometry stable.',
  FLICKER: 'Avoid flickering and temporal jitter.',
  LOOP_BAD: 'Do not loop or oscillate the motion.',
  OTHER: 'Follow the reviewer notes strictly.',
};
type QualityRetryContext = {
  sourceGenerationId: Id;
  criticEvaluationId: Id;
  issues: string[];
  guidance: string;
};
type VideoQualityPolicy = {
  requireImageApproval: boolean;
  requireHumanApproval: boolean;
  qualityFallback?: 'BLOCK' | 'MANUAL_REVIEW' | 'ALLOW_DEGRADED_WITH_REVIEW';
  temporalRetryLimit?: number;
};

type ShotVideoScheduling = {
  planId: Id;
  planFingerprint: string;
  shotId: string;
  shot: ShotPlanCandidate['shots'][number];
  framePlan: FramePlan;
  sourceImage: CurrentAsset;
  sourceImagePath: string;
  continuationSource: ContinuationSource | null;
  retryCount?: number;
  qualityRetry?: QualityRetryContext;
  qualityPolicy?: VideoQualityPolicy;
};

function buildFeedbackGuidance(issues: string[], notes: string): string {
  const mapped = issues.map((issue) => ISSUE_GUIDANCE[issue] ?? '').filter(Boolean);
  return [...mapped, notes.trim()].filter(Boolean).join(' ');
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 120) || 'scene';
}

function sceneIntentInput(scene: SceneDto): SceneIntentInput {
  return {
    sceneNumber: scene.sceneNumber,
    purpose: scene.purpose,
    cameraMovementIntent: scene.camera.movementIntent,
    weather: scene.weather,
    mood: scene.mood,
    subjectFocus: scene.composition.subjectFocus,
    characterPositions: scene.composition.characterPositions,
  };
}

function resolveVideoSeed(seedMode: 'RANDOM' | 'FIXED', fixedSeed: number | null): number {
  if (seedMode === 'FIXED') {
    if (fixedSeed === null)
      throw new AppError('INVALID_INPUT', 'A fixed seed is required when seed mode is FIXED', 400);
    return fixedSeed;
  }
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
function deterministicRetrySeed(inputFingerprint: string, retryCount: number): number {
  return Number.parseInt(
    createHash('sha256').update(`${inputFingerprint}:${retryCount}`).digest('hex').slice(0, 12),
    16,
  );
}

// Raw generation fingerprint: identical inputs must reuse the identical raw
// asset; any change to image, plan, settings, workflow, model, or seed
// produces a new fingerprint.
export function aiVideoGenerationFingerprint(input: {
  projectId: Id;
  sceneRevisionId: Id;
  sceneStableId: string;
  request: VideoGenerationRequest;
  motionPlanFingerprint: string;
  settingsFingerprint: string;
}): string {
  const continuation = input.request.continuationSource;
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: resolveVideoBackend(input.request.providerSettings.backend).mappingVersion,
        operation: input.request.shotId ? 'GENERATE_AI_SHOT_VIDEO' : 'GENERATE_AI_SCENE_VIDEO',
        projectId: input.projectId,
        sceneRevisionId: input.sceneRevisionId,
        sceneStableId: input.sceneStableId,
        shotPlanId: input.request.shotPlanId ?? null,
        shotId: input.request.shotId ?? null,
        motionPlanFingerprint: input.motionPlanFingerprint,
        settingsFingerprint: input.settingsFingerprint,
        request: {
          sourceImageAssetId: input.request.sourceImageAssetId,
          sourceImageSha256: input.request.sourceImageSha256,
          sourceImagePath: continuation ? null : input.request.sourceImagePath,
          continuationSource: continuation
            ? {
                sourceShotId: continuation.sourceShotId,
                sourceVideoAssetId: continuation.sourceVideoAssetId,
                sourceVideoSha256: continuation.sourceVideoSha256,
                framePosition: continuation.framePosition,
                extractorVersion: continuation.extractorVersion,
              }
            : null,
          motionPrompt: input.request.motionPrompt,
          negativePrompt: input.request.negativePrompt,
          width: input.request.width,
          height: input.request.height,
          frameCount: input.request.frameCount,
          fps: input.request.fps,
          seed: input.request.seed,
          backend: input.request.providerSettings.backend,
          model:
            input.request.providerSettings.backend === 'LTX2_19B_DISTILLED'
              ? input.request.providerSettings.ltxCheckpoint
              : input.request.providerSettings.diffusionModel,
          provider: input.request.providerSettings.provider,
          workflowTemplate: input.request.providerSettings.workflowTemplate,
        },
      }),
    )
    .digest('hex');
}

function videoFailure(
  error: unknown,
  signal?: AbortSignal,
): { code: string; message: string; retryable: boolean } {
  if (signal?.aborted)
    return { code: 'CANCELLED', message: 'Video generation cancelled', retryable: false };
  if (error instanceof VideoProviderError)
    return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof AppError) {
    const code = [
      'STALE_INPUT',
      'CONTINUATION_SOURCE_MISSING',
      'FRAME_GEOMETRY_INVALID',
      'CRITIC_UNAVAILABLE',
      'QUALITY_REJECTED',
    ].includes(error.code)
      ? error.code
      : 'GENERATION_FAILED';
    return { code, message: error.message, retryable: false };
  }
  return {
    code: 'GENERATION_FAILED',
    message: error instanceof Error ? error.message.slice(0, 2_000) : 'Video generation failed',
    retryable: false,
  };
}
export class SceneVideoService {
  readonly settings: VideoGenerationSettingsRepository;
  readonly generations: SceneVideoGenerationRepository;
  readonly plans: AiMotionPlanRepository;
  readonly motionSources: SceneMotionSourceRepository;
  private readonly workflow: WorkflowRepository;
  private readonly scenes: SceneRepository;
  private readonly assets: AssetRepository;
  private readonly shotPlans: ShotPlanRepository;
  private readonly timings: TimelineRepository;
  private readonly shotTiming: ShotTimingAllocationRepository;
  private readonly profiles: ProductionProfileRepository;
  private readonly critic: VideoCritic | null;
  constructor(
    private readonly context: StudioContext,
    private readonly provider: VideoGenerationProvider = new ComfyUiVideoProvider(
      context.workspace.staging,
    ),
    criticAgent?: AiAgent,
  ) {
    this.settings = new VideoGenerationSettingsRepository(context.database);
    this.generations = new SceneVideoGenerationRepository(context.database);
    this.plans = new AiMotionPlanRepository(context.database);
    this.motionSources = new SceneMotionSourceRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.shotPlans = new ShotPlanRepository(context.database);
    this.timings = new TimelineRepository(context.database);
    this.shotTiming = new ShotTimingAllocationRepository(context.database);
    this.profiles = new ProductionProfileRepository(context.database);
    this.critic = criticAgent
      ? new VideoCritic(criticAgent, new MediaCriticEvaluationRepository(context.database))
      : null;
  }

  getSettings(projectId: Id): VideoGenerationSettingsDto {
    this.assertProject(projectId);
    return this.settings.getOrCreate(projectId);
  }

  updateSettings(projectId: Id, value: unknown): VideoGenerationSettingsDto {
    this.assertProject(projectId);
    return this.settings.update(projectId, videoGenerationSettingsUpdateSchema.parse(value));
  }

  async readiness(projectId: Id, signal?: AbortSignal): Promise<VideoReadiness> {
    return await this.provider.readiness(this.getSettings(projectId), signal);
  }
  async readinessForBackend(
    projectId: Id,
    backend: VideoBackend,
    signal?: AbortSignal,
  ): Promise<VideoReadiness> {
    const settings = this.getSettings(projectId);
    return await this.provider.readiness(
      {
        ...settings,
        backend,
        workflowTemplate:
          backend === 'LTX2_19B_DISTILLED' ? 'ltx2-image-to-video-v1' : 'image-to-video-v1',
      },
      signal,
    );
  }

  getMotionSource(projectId: Id, sceneId: Id): MotionSource {
    const scene = this.scene(projectId, sceneId);
    return this.motionSources.get(projectId, scene.stableId);
  }

  setMotionSource(projectId: Id, sceneId: Id, value: unknown): MotionSource {
    const input = sceneMotionSourceUpdateSchema.parse(
      typeof value === 'string' ? { motionSource: value } : value,
    );
    const scene = this.scene(projectId, sceneId);
    this.motionSources.set(projectId, scene.stableId, input.motionSource);
    return input.motionSource;
  }

  getMotionPlan(projectId: Id, sceneId: Id): AiMotionPlanDto | null {
    const scene = this.scene(projectId, sceneId);
    return this.plans.getCurrent(projectId, scene.id);
  }

  listMotionPlans(projectId: Id, sceneId: Id, limit = 50): AiMotionPlanDto[] {
    const scene = this.scene(projectId, sceneId);
    return this.plans.list(projectId, scene.stableId, limit);
  }

  updateMotionPlan(projectId: Id, sceneId: Id, value: unknown): AiMotionPlanDto {
    const input = aiMotionPlanUpdateSchema.parse(value ?? {});
    const scene = this.scene(projectId, sceneId);
    const current = this.ensureMotionPlan(projectId, scene.id, scene);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision)
      throw new AppError('CONFLICT', 'AI motion plan changed; reload and retry', 409);
    const intent = {
      ...current.intent,
      ...(input.characterAction !== undefined ? { characterAction: input.characterAction } : {}),
      ...(input.environmentMotion !== undefined
        ? { environmentMotion: input.environmentMotion }
        : {}),
      ...(input.cameraMotion !== undefined ? { cameraMotion: input.cameraMotion } : {}),
      ...(input.intensity !== undefined ? { intensity: input.intensity } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    const motionPrompt = compileMotionPrompt(intent, sceneIntentInput(scene));
    return this.plans.create({
      projectId,
      chapterId: scene.chapterId,
      sceneStableId: scene.stableId,
      sceneRevisionId: scene.id,
      intent,
      motionPrompt,
      negativePrompt: current.negativePrompt,
      inputFingerprint: aiMotionPlanFingerprint({
        version: 'image-to-video-v1-mapping-1',
        operation: 'AI_MOTION_PLAN',
        sceneNumber: scene.sceneNumber,
        purpose: scene.purpose,
        intent,
        motionPrompt,
        negativePrompt: current.negativePrompt,
      }),
    });
  }

  // Idempotent: a deterministic default plan is created once per scene
  // revision and never overwritten silently.
  ensureMotionPlan(projectId: Id, sceneRevisionId: Id, scene: SceneDto): AiMotionPlanDto {
    const existing = this.plans.getCurrent(projectId, sceneRevisionId);
    if (existing) return existing;
    const draft = createDefaultAiMotionPlan(sceneIntentInput(scene));
    return this.plans.create({
      projectId,
      chapterId: scene.chapterId,
      sceneStableId: scene.stableId,
      sceneRevisionId,
      intent: draft.intent,
      motionPrompt: draft.motionPrompt,
      negativePrompt: draft.negativePrompt,
      inputFingerprint: draft.inputFingerprint,
    });
  }

  getGeneration(projectId: Id, sceneId: Id, generationId: Id): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    return generation;
  }

  listGenerations(projectId: Id, sceneId: Id, limit = 50, offset = 0): SceneVideoGenerationDto[] {
    const scene = this.scene(projectId, sceneId);
    return this.generations.list(projectId, scene.stableId, limit, offset);
  }

  getCurrentGeneration(projectId: Id, sceneId: Id): SceneVideoGenerationDto | null {
    const scene = this.scene(projectId, sceneId);
    return this.generations.getCurrent(projectId, scene.stableId);
  }
  getCurrentRenderableGeneration(
    projectId: Id,
    sceneId: Id,
    options: { requireApproval?: boolean; requireQualityPass?: boolean } = {},
  ) {
    const scene = this.scene(projectId, sceneId);
    return this.generations.currentRenderableSceneVideo(projectId, scene.stableId, options);
  }

  updateReview(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown,
  ): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    return this.generations.updateReview(
      projectId,
      generationId,
      sceneVideoReviewUpdateSchema.parse(value),
    );
  }

  setCurrent(projectId: Id, sceneId: Id, generationId: Id): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    return this.generations.setCurrent(projectId, scene.stableId, generationId);
  }

  accept(projectId: Id, sceneId: Id, generationId: Id, value: unknown): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    // Accept is its own action: issues/notes are optional and the review
    // status flips to ACCEPTED as part of accepting.
    const review = z
      .object({
        issues: z.array(z.string().max(60)).max(12).default([]),
        notes: z.string().max(1_000).default(''),
      })
      .strict()
      .parse(value ?? {});
    this.context.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET review_status='ACCEPTED',review_notes=?,review_issues=?,updated_at=?
         WHERE project_id=? AND id=?`,
      )
      .run(
        review.notes,
        JSON.stringify(review.issues ?? []),
        new Date().toISOString(),
        projectId,
        generationId,
      );
    return this.generations.setCurrent(projectId, scene.stableId, generationId);
  }

  schedule(projectId: Id, sceneId: Id, value: unknown = {}): SceneVideoScheduleResult {
    const input = z
      .object({ instructions: z.string().max(2_000).default('') })
      .strict()
      .parse(value ?? {});
    const scene = this.scene(projectId, sceneId);
    return this.scheduleScene(projectId, scene, input.instructions);
  }
  getShotGeneration(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    generationId: Id,
  ): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId || generation.shotId !== shotId)
      throw new AppError('NOT_FOUND', 'Shot video generation not found', 404);
    return generation;
  }

  listShotGenerations(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    limit = 50,
    offset = 0,
  ): SceneVideoGenerationDto[] {
    const scene = this.scene(projectId, sceneId);
    return this.generations.list(projectId, scene.stableId, limit, offset, shotId);
  }

  getCurrentShotGeneration(
    projectId: Id,
    sceneId: Id,
    shotId: string,
  ): SceneVideoGenerationDto | null {
    const scene = this.scene(projectId, sceneId);
    return this.generations.getCurrent(projectId, scene.stableId, shotId);
  }
  getCurrentRenderableShotVideo(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    options: { requireApproval?: boolean; requireQualityPass?: boolean } = {},
  ) {
    const scene = this.scene(projectId, sceneId);
    return this.generations.currentRenderableShotVideo(projectId, scene.stableId, shotId, options);
  }

  updateShotReview(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    generationId: Id,
    value: unknown,
  ): SceneVideoGenerationDto {
    this.getShotGeneration(projectId, sceneId, shotId, generationId);
    return this.generations.updateReview(
      projectId,
      generationId,
      sceneVideoReviewUpdateSchema.parse(value),
    );
  }

  setShotCurrent(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    generationId: Id,
  ): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    this.getShotGeneration(projectId, sceneId, shotId, generationId);
    return this.generations.setCurrent(projectId, scene.stableId, generationId, shotId);
  }

  acceptShot(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    generationId: Id,
    value: unknown,
  ): SceneVideoGenerationDto {
    const scene = this.scene(projectId, sceneId);
    this.getShotGeneration(projectId, sceneId, shotId, generationId);
    const review = z
      .object({
        issues: z.array(z.string().max(60)).max(12).default([]),
        notes: z.string().max(1_000).default(''),
      })
      .strict()
      .parse(value ?? {});
    this.context.database.sqlite
      .prepare(
        `UPDATE scene_video_generations SET review_status='ACCEPTED',review_notes=?,review_issues=?,updated_at=?
         WHERE project_id=? AND id=? AND shot_stable_id=?`,
      )
      .run(
        review.notes,
        JSON.stringify(review.issues ?? []),
        new Date().toISOString(),
        projectId,
        generationId,
        shotId,
      );
    return this.generations.setCurrent(projectId, scene.stableId, generationId, shotId);
  }

  scheduleShot(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    value: unknown = {},
    backendOverride?: VideoBackend,
    backendFallbackUsed = false,
    qualityPolicy?: VideoQualityPolicy,
  ): SceneVideoScheduleResult {
    const input = z
      .object({
        instructions: z.string().max(2_000).default(''),
        retryCount: z.number().int().min(0).max(3).default(0),
        seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        qualityRetry: z
          .object({
            sourceGenerationId: z.string().uuid(),
            criticEvaluationId: z.string().uuid(),
            issues: z.array(z.string().max(60)).max(20),
            guidance: z.string().max(2_000),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(value ?? {});
    const scene = this.scene(projectId, sceneId);
    const plan = this.shotPlans.getCurrent(projectId, scene.id);
    if (!plan || plan.reviewStatus !== 'APPROVED')
      throw new AppError('PREREQUISITE_MISSING', 'An approved current Shot plan is required', 409);
    const shot = plan.candidate.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new AppError('NOT_FOUND', 'Shot not found', 404);
    const settings = this.settings.getOrCreate(projectId);
    const allocation = this.ensureShotTimingAllocation(
      projectId,
      scene,
      plan,
      shotId,
      backendOverride ?? settings.backend,
    );
    const sourceImage = this.assets.currentRenderableShotImage(projectId, scene.stableId, shotId, {
      requireApproval: qualityPolicy?.requireImageApproval,
    });
    if (!sourceImage)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'A current quality-approved Shot image is required before AI video generation',
        409,
      );
    let continuationSource: ContinuationSource | null = null;
    let continuationFrameAssetId: Id | null = null;
    const sourceImagePath = sourceImage.path;
    const previous = plan.candidate.shots.find(
      (candidate) => candidate.ordinal === shot.ordinal - 1,
    );
    if (previous && continuationEligibility(previous, shot).eligible) {
      const previousGeneration = this.generations.getCurrent(
        projectId,
        scene.stableId,
        previous.id,
      );
      const previousAsset = previousGeneration?.assetId
        ? this.assets.get(previousGeneration.assetId)
        : null;
      if (
        !previousGeneration ||
        previousGeneration.status !== 'COMPLETED' ||
        previousGeneration.freshness !== 'CURRENT' ||
        (previousGeneration.automaticQualityStatus !== 'PASSED' &&
          previousGeneration.reviewStatus !== 'ACCEPTED') ||
        !previousAsset ||
        previousAsset.status !== 'READY'
      )
        throw new AppError(
          'CONTINUATION_SOURCE_MISSING',
          'The eligible previous Shot video is no longer current and accepted',
          409,
        );
      const frameAssetId = randomUUID();
      continuationFrameAssetId = frameAssetId;
      const framePath = `projects/${safePathSegment(projectId)}/video/continuation/${safePathSegment(scene.stableId)}/${safePathSegment(shotId)}/${frameAssetId}.png`;
      const emptyHash = '0'.repeat(64);
      this.assets.registerReference({
        id: frameAssetId,
        projectId,
        type: 'SHOT_CONTINUATION_FRAME',
        role: `shot:${shotId}:continuation-frame`,
        path: framePath,
        mediaType: 'image/png',
        bytes: 0,
        sha256: emptyHash,
        sourceEntityId: previousGeneration.id,
        inputFingerprint: previousGeneration.inputFingerprint,
        validationError: 'Continuation frame extraction is pending',
        metadata: {
          sceneId: scene.stableId,
          shotId,
          sourceShotId: previous.id,
          sourceVideoAssetId: previousAsset.id,
          sourceVideoSha256: previousAsset.sha256,
          framePosition: 1,
          extractorVersion: 'ffmpeg-final-frame-v1',
        },
      });
      continuationSource = {
        sourceShotId: previous.id,
        sourceVideoAssetId: previousAsset.id,
        sourceVideoSha256: previousAsset.sha256,
        frameAssetId,
        frameSha256: emptyHash,
        framePosition: 1,
        extractorVersion: 'ffmpeg-final-frame-v1',
      };
    }
    let result: SceneVideoScheduleResult;
    try {
      result = this.scheduleScene(
        projectId,
        scene,
        input.instructions,
        input.seed,
        undefined,
        {
          planId: plan.id,
          planFingerprint: plan.inputFingerprint,
          shotId,
          shot,
          framePlan: allocation,
          sourceImage,
          sourceImagePath,
          continuationSource,
          retryCount: input.retryCount,
          qualityRetry: input.qualityRetry,
          qualityPolicy,
        },
        input.retryCount,
        backendOverride,
        backendFallbackUsed,
        undefined,
        qualityPolicy,
      );
    } catch (error) {
      if (continuationFrameAssetId)
        this.assets.invalidateRole(projectId, `shot:${shotId}:continuation-frame`);
      throw error;
    }
    if (continuationFrameAssetId && result.reused)
      this.assets.invalidateRole(projectId, `shot:${shotId}:continuation-frame`);
    if (continuationSource && result.stepId) {
      const extractionStepId = this.workflow.createStep(
        result.executionId,
        `shot-continuation:${scene.id}:${shotId}:${result.generation.revision}`,
        'EXTRACT_SHOT_CONTINUATION_FRAME',
        scene.id,
        result.generation.inputFingerprint,
        2,
        {
          projectId,
          generationId: result.generation.id,
          sceneRevisionId: scene.id,
          sceneStableId: scene.stableId,
          shotPlanId: plan.id,
          shotId,
          sourceShotId: continuationSource.sourceShotId,
          sourceVideoAssetId: continuationSource.sourceVideoAssetId,
          sourceVideoSha256: continuationSource.sourceVideoSha256,
          frameAssetId: continuationSource.frameAssetId,
          framePath: this.assets.get(continuationSource.frameAssetId)?.path ?? '',
          framePosition: continuationSource.framePosition,
          extractorVersion: continuationSource.extractorVersion,
        },
      );
      this.workflow.dependency(result.stepId, extractionStepId);
      this.workflow.createJob(
        'EXTRACT_SHOT_CONTINUATION_FRAME',
        continuationSource.frameAssetId,
        extractionStepId,
      );
    }
    return result;
  }

  regenerateShot(
    projectId: Id,
    sceneId: Id,
    shotId: string,
    generationId: Id,
    value: unknown = {},
  ): SceneVideoScheduleResult {
    const input = sceneVideoRegenerationSchema.parse(value ?? {});
    const source = this.getShotGeneration(projectId, sceneId, shotId, generationId);
    if (source.status !== 'COMPLETED' || source.requestedSeed === null)
      throw new AppError('INVALID_INPUT', 'Only a completed generation can be regenerated', 409);
    let instructions = input.instructions;
    if (input.useReviewFeedback) {
      const guidance = buildFeedbackGuidance(source.reviewIssues, source.reviewNotes);
      instructions = [instructions, guidance].filter(Boolean).join(' ');
    }
    return this.scheduleShot(projectId, sceneId, shotId, {
      instructions,
      seed: input.mode === 'SAME_SEED' ? source.requestedSeed : undefined,
    });
  }
  regenerate(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown = {},
  ): SceneVideoScheduleResult {
    const input = sceneVideoRegenerationSchema.parse(value ?? {});
    const scene = this.scene(projectId, sceneId);
    const source = this.generations.get(projectId, generationId);
    if (!source || source.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    if (source.status !== 'COMPLETED' || !source.requestedSeed)
      throw new AppError('INVALID_INPUT', 'Only a completed generation can be regenerated', 409);
    let instructions = input.instructions;
    if (input.useReviewFeedback) {
      const guidance = buildFeedbackGuidance(source.reviewIssues, source.reviewNotes);
      instructions = [instructions, guidance].filter(Boolean).join(' ');
    }
    const seed = input.mode === 'SAME_SEED' ? source.requestedSeed : undefined;
    return this.scheduleScene(projectId, scene, instructions, seed);
  }

  scheduleBatch(
    projectId: Id,
    value: unknown,
    backendOverride?: VideoBackend,
    backendFallbackUsed = false,
    qualityPolicy?: VideoQualityPolicy,
  ): SceneVideoBatchScheduleResult {
    const request = aiVideoBatchSchema.parse(value);
    const executionId = this.workflow.createExecution(projectId, 'GENERATE_AI_SCENE_VIDEO');
    const jobs: SceneVideoScheduleResult[] = [];
    const skippedSceneIds: Id[] = [];
    for (const sceneId of request.sceneIds) {
      const scene = this.scenes.getScene(sceneId);
      if (!scene || scene.projectId !== projectId || scene.status !== 'CURRENT') {
        skippedSceneIds.push(sceneId);
        continue;
      }
      const motionSource = this.motionSources.get(projectId, scene.stableId);
      if (motionSource === 'KEN_BURNS') {
        skippedSceneIds.push(sceneId);
        continue;
      }
      if (request.onlyMissing && this.hasAcceptedCurrentClip(projectId, scene.stableId)) {
        skippedSceneIds.push(sceneId);
        continue;
      }
      jobs.push(
        this.scheduleScene(
          projectId,
          scene,
          '',
          undefined,
          executionId,
          undefined,
          0,
          backendOverride,
          backendFallbackUsed,
          undefined,
          qualityPolicy,
        ),
      );
    }
    return { executionId, jobs, skippedSceneIds };
  }

  scheduleChapterMissing(projectId: Id, chapterId: Id): SceneVideoBatchScheduleResult {
    const scenes = this.scenes.listScenes(chapterId);
    const eligible = scenes.filter(
      (scene) =>
        scene.status === 'CURRENT' &&
        this.motionSources.get(projectId, scene.stableId) !== 'KEN_BURNS' &&
        !this.hasAcceptedCurrentClip(projectId, scene.stableId),
    );
    return this.scheduleBatch(projectId, {
      sceneIds: eligible.map((scene) => scene.id),
      onlyMissing: true,
    });
  }

  private hasAcceptedCurrentClip(projectId: Id, sceneStableId: string): boolean {
    const current = this.generations.getCurrent(projectId, sceneStableId);
    return Boolean(
      current &&
      current.status === 'COMPLETED' &&
      current.freshness === 'CURRENT' &&
      current.reviewStatus === 'ACCEPTED',
    );
  }
  private ensureShotTimingAllocation(
    projectId: Id,
    scene: SceneDto,
    plan: ShotPlanDto,
    shotId: string,
    backend: VideoGenerationSettingsDto['backend'],
  ): FramePlan {
    const timing = this.timings.getCurrentSceneTiming(scene.chapterId);
    const sceneTiming = timing?.items.find((item) => item.sceneId === scene.id);
    if (!timing || !sceneTiming)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Current SceneTiming is required for Shot video',
        409,
      );
    const shots = [...plan.candidate.shots].sort((left, right) => left.ordinal - right.ordinal);
    const totalPlanned = shots.reduce(
      (sum, value) => sum + Math.max(1, value.plannedDurationMs),
      0,
    );
    let assigned = 0;
    const durations = shots.map((shot, index) => {
      const duration =
        index === shots.length - 1
          ? Math.max(1, sceneTiming.durationMs - assigned)
          : Math.max(
              1,
              Math.round(
                (sceneTiming.durationMs * Math.max(1, shot.plannedDurationMs)) / totalPlanned,
              ),
            );
      assigned += duration;
      return duration;
    });
    const fps =
      backend === 'LTX2_19B_DISTILLED'
        ? this.settings.getOrCreate(projectId).ltxFps
        : VIDEO_OUTPUT_FPS;
    const frames = allocateFramePlans(backend, durations, fps);
    this.shotTiming.saveMany(
      shots.map((shot, index) => ({
        projectId,
        sceneTimingRevisionId: timing.id,
        shotPlanId: plan.id,
        shotId: shot.id,
        ordinal: shot.ordinal,
        targetDurationMs: durations[index]!,
        actualDurationMs: frames[index]!.actualDurationMs,
        frameCount: frames[index]!.frameCount,
        fps: frames[index]!.fps,
        residualMs: frames[index]!.residualMs,
        backend,
      })),
    );
    const result = shots.findIndex((shot) => shot.id === shotId);
    if (result < 0) throw new AppError('NOT_FOUND', 'Shot not found', 404);
    return frames[result]!;
  }

  private scheduleScene(
    projectId: Id,
    scene: SceneDto,
    instructions: string,
    seedOverride?: number,
    executionId?: Id,
    shot?: ShotVideoScheduling,
    retryCount = 0,
    backendOverride?: VideoBackend,
    backendFallbackUsed = false,
    qualityRetry?: QualityRetryContext,
    qualityPolicy?: VideoQualityPolicy,
  ): SceneVideoScheduleResult {
    if (scene.status !== 'CURRENT')
      throw new AppError('PREREQUISITE_MISSING', 'A current scene revision is required', 409);
    const motionSource = this.motionSources.get(projectId, scene.stableId);
    if (motionSource === 'KEN_BURNS' && !shot)
      throw new AppError(
        'INVALID_INPUT',
        'Scene motion source is KEN_BURNS; set it to AI_VIDEO or HYBRID first',
        409,
      );
    const settings = this.settings.getOrCreate(projectId);
    const settingsFingerprint = videoSettingsFingerprint(settings);
    const plan = this.ensureMotionPlan(projectId, scene.id, scene);
    // Scheduling must reuse the canonical downstream Scene-image gate: a
    // rejected, unreviewed-while-approval-required, or stale-source current
    // image is never an AI-video source input.
    const image =
      shot?.sourceImage ??
      this.assets.currentRenderableSceneImage(projectId, scene.stableId, {
        requireApproval: qualityPolicy?.requireImageApproval,
      });
    if (!image)
      throw new AppError(
        'PREREQUISITE_MISSING',
        shot
          ? 'A current quality-approved Shot image is required before AI video generation'
          : 'A current accepted scene image is required before AI video generation',
        409,
      );
    const preset = VIDEO_PRESETS[settings.preset];
    const backendId = backendOverride ?? settings.backend;
    const backend = resolveVideoBackend(backendId);
    const fps = backendId === 'LTX2_19B_DISTILLED' ? settings.ltxFps : VIDEO_OUTPUT_FPS;
    const frames =
      shot?.framePlan ?? backend.framePlan((preset.frames * 1_000) / VIDEO_OUTPUT_FPS, fps);
    const seed = seedOverride ?? resolveVideoSeed(settings.seedMode, settings.fixedSeed);
    const shotMotionPrompt = shot
      ? [
          shot.shot.staticIntent.subject,
          shot.shot.staticIntent.action,
          shot.shot.staticIntent.pose,
          shot.shot.dynamicIntent.subjectMotion,
          `Camera: ${shot.shot.dynamicIntent.cameraMotion}`,
          shot.shot.dynamicIntent.environmentMotion,
          shot.shot.dynamicIntent.emotionalTiming,
          shot.shot.dynamicIntent.speakingMotion,
        ]
          .filter(Boolean)
          .join('. ')
      : plan.motionPrompt;
    const motionPrompt = instructions
      ? `${shotMotionPrompt} Additional direction: ${instructions.trim()}`
      : shotMotionPrompt;
    const providerJobId = randomUUID();
    const request = videoGenerationRequestSchema.parse({
      projectId,
      sceneId: scene.stableId,
      sceneRevisionId: scene.id,
      shotPlanId: shot?.planId ?? null,
      shotId: shot?.shotId ?? null,
      backend: backendId,
      continuationSource: shot?.continuationSource ?? null,
      providerJobId,
      sourceImageAssetId: image.id,
      sourceImageSha256: image.sha256,
      sourceImagePath: shot?.sourceImagePath ?? image.path,
      motionPrompt,
      negativePrompt: plan.negativePrompt,
      width: preset.width,
      height: preset.height,
      frameCount: frames.frameCount,
      fps,
      seed,
      providerSettings: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        backend: backendId,
        workflowTemplate:
          backendId === 'LTX2_19B_DISTILLED' ? 'ltx2-image-to-video-v1' : 'image-to-video-v1',
        diffusionModel: settings.diffusionModel,
        textEncoder: settings.textEncoder,
        vaeName: settings.vaeName,
        ltxCheckpoint: settings.ltxCheckpoint,
        ltxTextEncoder: settings.ltxTextEncoder,
        ltxVaeName: settings.ltxVaeName,
        ltxFps: settings.ltxFps,
        sampler: settings.sampler,
        scheduler: settings.scheduler,
        steps: settings.steps,
        guidance: settings.guidance,
        shift: settings.shift,
        preset: settings.preset,
        connectionTimeoutMs: settings.connectionTimeoutMs,
        generationTimeoutMs: settings.generationTimeoutMs,
      },
    });
    const inputFingerprint = aiVideoGenerationFingerprint({
      projectId,
      sceneRevisionId: scene.id,
      sceneStableId: scene.stableId,
      request,
      motionPlanFingerprint: plan.inputFingerprint,
      settingsFingerprint,
    });
    const executionType = shot ? 'GENERATE_AI_SHOT_VIDEO' : 'GENERATE_AI_SCENE_VIDEO';
    const execution = executionId ?? this.workflow.createExecution(projectId, executionType);
    const existing = this.generations.findCompletedByFingerprint(
      projectId,
      scene.stableId,
      inputFingerprint,
      shot?.shotId ?? null,
    );
    if (existing)
      return {
        executionId: execution,
        stepId: null,
        jobId: null,
        generation: existing,
        reused: true,
      };
    const generation = this.generations.create({
      projectId,
      chapterId: scene.chapterId,
      sceneStableId: scene.stableId,
      sceneRevisionId: scene.id,
      shotPlanId: shot?.planId ?? null,
      shotStableId: shot?.shotId ?? null,
      continuationSource: shot?.continuationSource ?? null,
      aiMotionPlanRevisionId: plan.id,
      provider: settings.provider,
      backend: backendId,
      requestedSeed: seed,
      requestedWidth: request.width,
      requestedHeight: request.height,
      frameCount: request.frameCount,
      fps: request.fps,
      providerJobId,
      workflowTemplate: request.providerSettings.workflowTemplate,
      modelSettings: request.providerSettings,
      requestSnapshot: {
        request,
        motionPlanFingerprint: plan.inputFingerprint,
        settingsFingerprint,
      },
      motionPlanFingerprint: plan.inputFingerprint,
      settingsFingerprint,
      inputFingerprint,
      sourceImageAssetId: image.id,
      sourceImageSha256: image.sha256,
      generationInstructions: instructions || null,
      metadata: {
        request,
        motionPlanFingerprint: plan.inputFingerprint,
        shotPlanFingerprint: shot?.planFingerprint ?? null,
        settingsFingerprint,
        retryCount: shot?.retryCount ?? retryCount,
        backend: backendId,
        mappingVersion: backend.mappingVersion,
        requestedDurationMs: frames.requestedDurationMs,
        actualDurationMs: frames.actualDurationMs,
        residualMs: frames.residualMs,
        fallbackUsed: backendFallbackUsed,
        qualityRetry: shot?.qualityRetry ?? qualityRetry ?? null,
        ...(qualityPolicy
          ? {
              requireImageApproval: qualityPolicy.requireImageApproval,
              requireHumanApproval: qualityPolicy.requireHumanApproval,
              qualityFallback: qualityPolicy.qualityFallback ?? 'MANUAL_REVIEW',
              temporalRetryLimit: qualityPolicy.temporalRetryLimit ?? 2,
            }
          : {}),
      },
    });
    const stepType = shot ? 'GENERATE_AI_SHOT_VIDEO' : 'GENERATE_AI_SCENE_VIDEO';
    const stepId = this.workflow.createStep(
      execution,
      `${shot ? 'shot' : 'scene'}-video:${scene.id}:${shot?.shotId ?? generation.revision}`,
      stepType,
      scene.id,
      inputFingerprint,
      3,
      { projectId, generationId: generation.id },
    );
    this.generations.linkWorkflowStep(projectId, generation.id, stepId);
    return {
      executionId: execution,
      stepId,
      jobId: this.workflow.createJob(stepType, generation.id, stepId),
      generation,
      reused: false,
    };
  }

  async executeStep(
    step: ClaimedStep,
    workerId: string,
    signal?: AbortSignal,
    progress: (value: number, message: string) => void = () => undefined,
  ): Promise<void> {
    const payload = this.parseStepPayload(step);
    const generation = this.generations.get(payload.projectId, payload.generationId);
    if (!generation) throw new AppError('NOT_FOUND', 'Scene video generation not found', 404);
    if (generation.status === 'COMPLETED') {
      if (
        generation.criticEvaluationId ||
        (generation.automaticQualityStatus && generation.automaticQualityStatus !== 'NOT_RUN') ||
        !generation.assetId
      )
        return;
      const scheduled = scheduledVideoRequestSchema.safeParse(generation.metadata);
      const asset = this.assets.get(generation.assetId);
      if (!scheduled.success || !asset || asset.status !== 'READY') return;
      const scene = this.sceneByRevisionId(payload.projectId, generation.sceneRevisionId);
      try {
        await this.critiqueVideo(
          payload.projectId,
          scene,
          generation,
          scheduled.data.request,
          safeWorkspacePath(this.context.workspace.root, asset.path),
          signal,
        );
      } catch {
        this.context.database.sqlite
          .prepare(
            "UPDATE scene_video_generations SET automatic_quality_status='UNAVAILABLE',updated_at=? WHERE project_id=? AND id=? AND automatic_quality_status='NOT_RUN'",
          )
          .run(new Date().toISOString(), payload.projectId, generation.id);
      }
      return;
    }
    if (!['PENDING', 'RUNNING'].includes(generation.status))
      throw new AppError('STALE_INPUT', 'Scene video generation is not runnable', 409);
    const scheduled = scheduledVideoRequestSchema.parse(generation.metadata);
    if (
      scheduled.request.projectId !== payload.projectId ||
      scheduled.request.sceneRevisionId !== generation.sceneRevisionId ||
      scheduled.request.providerJobId !== generation.providerJobId ||
      generation.inputFingerprint !== step.input_fingerprint
    )
      throw new AppError('STALE_INPUT', 'Scene video generation metadata is stale', 409);
    try {
      const request = this.assertCurrentInputs(
        payload.projectId,
        generation.sceneId,
        generation.sceneRevisionId,
        scheduled,
      );
      this.generations.markRunning(payload.projectId, generation.id, step.attemptNumber);
      progress(0.1, 'Checking ComfyUI video generation readiness');
      const result = await this.provider.generate(request, signal);
      if (
        result.providerJobId !== request.providerJobId ||
        result.seed !== request.seed ||
        result.videos.length !== 1 ||
        (result.backend && result.backend !== request.providerSettings.backend)
      )
        throw new VideoProviderError(
          'OUTPUT_INVALID',
          'ComfyUI returned an unexpected video result',
          false,
        );
      progress(0.8, 'Validating generated video');
      const output = result.videos[0]!;
      this.assertStagingPath(output.stagingPath);
      const validated = await validateRawAiVideo(this.context.media, output.stagingPath);
      const scene = this.sceneByRevisionId(payload.projectId, request.sceneRevisionId);
      const destination = safeWorkspacePath(
        this.context.workspace.root,
        request.shotId
          ? managedShotMotionRelativePath(
              safePathSegment(payload.projectId),
              safePathSegment(scene.stableId),
              safePathSegment(request.shotId),
              generation.id,
            )
          : managedMotionRelativePath(
              safePathSegment(payload.projectId),
              safePathSegment(scene.stableId),
              generation.id,
            ),
      );
      try {
        await prepareProjectDirectories(this.context.workspace, payload.projectId);
        await promoteFile(output.stagingPath, destination);
        const file = await sha256File(destination);
        const committed = this.generations.commitGenerated(
          {
            generationId: generation.id,
            projectId: payload.projectId,
            sceneStableId: scene.stableId,
            sceneRevisionId: scene.id,
            assetPath: relativeAssetPath(this.context.workspace.root, destination),
            mediaType: output.mediaType,
            bytes: file.bytes,
            sha256: file.hash,
            width: validated.width,
            height: validated.height,
            seed: result.seed,
            fps: validated.fps,
            frameCount: validated.frameCount,
            clipDurationMs: validated.durationMs,
            generationDurationMs: result.durationMs,
            metadata: {
              provider: result.provider,
              backend: result.backend ?? request.providerSettings.backend,
              providerJobId: result.providerJobId,
              warnings: result.warnings,
              providerMetadata: result.metadata,
              requestedClipDurationMs: result.clipDurationMs,
            },
          },
          {
            stepId: step.id,
            attemptId: step.attemptId,
            workerId,
            inputFingerprint: step.input_fingerprint,
          },
        );
        if (!committed)
          throw new AppError(
            'STALE_INPUT',
            'Video generation lease was lost before publication',
            409,
          );
      } finally {
        await rm(output.stagingPath, { force: true });
      }
      const committedGeneration = this.generations.get(payload.projectId, generation.id);
      if (committedGeneration) {
        try {
          await this.critiqueVideo(
            payload.projectId,
            scene,
            committedGeneration,
            request,
            destination,
            signal,
          );
        } catch (error) {
          if (videoFailure(error, signal).code === 'CANCELLED') throw error;
          this.context.database.sqlite
            .prepare(
              "UPDATE scene_video_generations SET automatic_quality_status='UNAVAILABLE',updated_at=? WHERE project_id=? AND id=? AND automatic_quality_status='NOT_RUN'",
            )
            .run(new Date().toISOString(), payload.projectId, generation.id);
        }
      }
      progress(
        1,
        request.shotId
          ? 'Shot AI video generation completed'
          : 'Scene AI video generation completed',
      );
    } catch (error) {
      const failure = videoFailure(error, signal);
      if (failure.code === 'CANCELLED') {
        this.generations.markCancelled(payload.projectId, generation.id, failure.message);
      } else if (failure.retryable && step.attemptNumber < step.max_attempts) {
        this.generations.markRetryPending(
          payload.projectId,
          generation.id,
          failure.code,
          failure.message,
        );
      } else {
        this.generations.markFailed(
          payload.projectId,
          generation.id,
          failure.code,
          failure.message,
        );
      }
      throw new VideoProviderError(
        failure.code as VideoProviderError['code'],
        failure.message,
        failure.retryable && step.attemptNumber < step.max_attempts,
      );
    }
  }
  async executeContinuationStep(
    step: ClaimedStep,
    signal?: AbortSignal,
    progress: (value: number, message: string) => void = () => undefined,
  ): Promise<void> {
    const payload = this.parseContinuationStepPayload(step);
    const failContinuation = (message: string): never => {
      const error = new AppError('CONTINUATION_SOURCE_MISSING', message, 409);
      this.generations.markFailed(
        payload.projectId,
        payload.generationId,
        error.code,
        error.message,
      );
      throw error;
    };
    const sourceAsset = this.assets.get(payload.sourceVideoAssetId);
    const currentSourceGeneration = this.generations.getCurrent(
      payload.projectId,
      payload.sceneStableId,
      payload.sourceShotId,
    );
    if (
      !sourceAsset ||
      sourceAsset.status !== 'READY' ||
      !sourceAsset.isCurrent ||
      sourceAsset.sha256 !== payload.sourceVideoSha256 ||
      !currentSourceGeneration ||
      currentSourceGeneration.assetId !== payload.sourceVideoAssetId ||
      currentSourceGeneration.status !== 'COMPLETED' ||
      currentSourceGeneration.freshness !== 'CURRENT' ||
      (currentSourceGeneration.automaticQualityStatus !== 'PASSED' &&
        currentSourceGeneration.reviewStatus !== 'ACCEPTED')
    )
      return failContinuation('The accepted previous Shot video is no longer current');
    const frameAsset = this.assets.get(payload.frameAssetId);
    if (!frameAsset) return failContinuation('Continuation frame asset is missing');
    if (
      frameAsset.projectId !== payload.projectId ||
      frameAsset.type !== 'SHOT_CONTINUATION_FRAME' ||
      frameAsset.path !== payload.framePath ||
      frameAsset.sourceEntityId !== currentSourceGeneration.id ||
      frameAsset.inputFingerprint !== currentSourceGeneration.inputFingerprint
    )
      return failContinuation('Continuation frame lineage is stale');
    let frameMetadata: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(frameAsset.metadata ?? '{}')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return failContinuation('Continuation frame metadata is invalid');
      frameMetadata = parsed as Record<string, unknown>;
    } catch {
      return failContinuation('Continuation frame metadata is invalid');
    }
    if (
      frameMetadata.sourceShotId !== payload.sourceShotId ||
      frameMetadata.sourceVideoAssetId !== payload.sourceVideoAssetId ||
      frameMetadata.sourceVideoSha256 !== payload.sourceVideoSha256 ||
      frameMetadata.framePosition !== payload.framePosition ||
      frameMetadata.extractorVersion !== payload.extractorVersion
    )
      return failContinuation('Continuation frame metadata is stale');
    if (frameAsset.status === 'READY') {
      if (
        !frameAsset.isCurrent ||
        !/^[0-9a-f]{64}$/u.test(frameAsset.sha256) ||
        frameAsset.sha256 === '0'.repeat(64)
      )
        return failContinuation('Continuation frame asset is not current');
      const continuationSource = continuationSourceSchema.parse({
        sourceShotId: payload.sourceShotId,
        sourceVideoAssetId: payload.sourceVideoAssetId,
        sourceVideoSha256: payload.sourceVideoSha256,
        frameAssetId: payload.frameAssetId,
        frameSha256: frameAsset.sha256,
        framePosition: payload.framePosition,
        extractorVersion: payload.extractorVersion,
      });
      this.generations.updateContinuationSource(
        payload.projectId,
        payload.generationId,
        continuationSource,
      );
      progress(1, 'Shot continuation frame already extracted');
      return;
    }
    const sourcePath = safeWorkspacePath(this.context.workspace.root, sourceAsset.path);
    const stagingPath = join(
      this.context.workspace.staging,
      `continuation-${payload.frameAssetId}.png`,
    );
    const destination = safeWorkspacePath(this.context.workspace.root, payload.framePath);
    try {
      progress(0.2, 'Extracting the accepted previous Shot final frame');
      await this.context.media.extractFinalVideoFrame(sourcePath, stagingPath, signal);
      const image = await validateImageFile(this.context.media, stagingPath);
      await prepareProjectDirectories(this.context.workspace, payload.projectId);
      await promoteFile(stagingPath, destination);
      const file = await sha256File(destination);
      this.assets.completeContinuationFrame({
        projectId: payload.projectId,
        assetId: payload.frameAssetId,
        path: relativeAssetPath(this.context.workspace.root, destination),
        bytes: file.bytes,
        sha256: file.hash,
        width: image.width,
        height: image.height,
        sourceStepId: step.id,
      });
      const generation = this.generations.get(payload.projectId, payload.generationId);
      if (!generation || generation.shotId !== payload.shotId)
        throw new AppError('STALE_INPUT', 'Shot video generation is no longer current', 409);
      const continuationSource = continuationSourceSchema.parse({
        sourceShotId: payload.sourceShotId,
        sourceVideoAssetId: payload.sourceVideoAssetId,
        sourceVideoSha256: payload.sourceVideoSha256,
        frameAssetId: payload.frameAssetId,
        frameSha256: file.hash,
        framePosition: payload.framePosition,
        extractorVersion: payload.extractorVersion,
      });
      this.generations.updateContinuationSource(
        payload.projectId,
        payload.generationId,
        continuationSource,
      );
      progress(1, 'Shot continuation frame extracted');
    } catch (error) {
      const failure = videoFailure(error, signal);
      if (failure.code === 'CANCELLED')
        this.generations.markCancelled(payload.projectId, payload.generationId, failure.message);
      else
        this.generations.markFailed(
          payload.projectId,
          payload.generationId,
          'CONTINUATION_SOURCE_MISSING',
          failure.message,
        );
      throw error;
    } finally {
      await rm(stagingPath, { force: true });
    }
  }

  private assertCurrentInputs(
    projectId: Id,
    sceneStableId: string,
    sceneRevisionId: Id,
    scheduled: {
      request: VideoGenerationRequest;
      motionPlanFingerprint: string;
      settingsFingerprint: string;
      shotPlanFingerprint?: string | null;
      requireImageApproval?: boolean;
    },
  ): VideoGenerationRequest {
    const shotId = scheduled.request.shotId ?? null;
    const imageSha = this.generations.currentSourceImageSha(
      projectId,
      sceneStableId,
      shotId,
      scheduled.requireImageApproval,
    );
    if (!imageSha)
      throw new AppError(
        'STALE_INPUT',
        shotId
          ? 'Shot no longer has a current accepted image'
          : 'Scene no longer has a current accepted image',
        409,
      );
    if (imageSha !== scheduled.request.sourceImageSha256)
      throw new AppError(
        'STALE_INPUT',
        shotId
          ? 'The accepted Shot image changed during generation'
          : 'The accepted scene image changed during generation',
        409,
      );
    const settings = this.settings.get(projectId);
    if (!settings || settings.inputFingerprint !== scheduled.settingsFingerprint)
      throw new AppError('STALE_INPUT', 'Video generation settings changed', 409);
    const plan = this.plans.getCurrent(projectId, sceneRevisionId);
    if (!plan || plan.inputFingerprint !== scheduled.motionPlanFingerprint)
      throw new AppError('STALE_INPUT', 'AI motion plan changed', 409);
    if (shotId) {
      const shotPlan = this.shotPlans.getCurrent(projectId, sceneRevisionId);
      if (
        !shotPlan ||
        shotPlan.id !== scheduled.request.shotPlanId ||
        shotPlan.inputFingerprint !== scheduled.shotPlanFingerprint ||
        !shotPlan.candidate.shots.some((shot) => shot.id === shotId)
      )
        throw new AppError('STALE_INPUT', 'Shot plan changed during generation', 409);
    }
    const continuation = scheduled.request.continuationSource;
    if (!continuation) return scheduled.request;
    const frame = this.assets.get(continuation.frameAssetId);
    const sourceGeneration = this.generations.getCurrent(
      projectId,
      sceneStableId,
      continuation.sourceShotId,
    );
    if (
      !frame ||
      frame.type !== 'SHOT_CONTINUATION_FRAME' ||
      frame.status !== 'READY' ||
      frame.sha256 !== continuation.frameSha256 ||
      !sourceGeneration ||
      sourceGeneration.assetId !== continuation.sourceVideoAssetId ||
      sourceGeneration.status !== 'COMPLETED' ||
      sourceGeneration.freshness !== 'CURRENT' ||
      (sourceGeneration.automaticQualityStatus !== 'PASSED' &&
        sourceGeneration.reviewStatus !== 'ACCEPTED')
    )
      throw new AppError(
        'CONTINUATION_SOURCE_MISSING',
        'The accepted previous Shot final frame is unavailable',
        409,
      );
    return videoGenerationRequestSchema.parse({
      ...scheduled.request,
      sourceImagePath: frame.path,
      continuationSource: {
        ...continuation,
        frameSha256: frame.sha256,
      },
    });
  }

  private parseStepPayload(step: ClaimedStep): z.infer<typeof videoStepPayloadSchema> {
    try {
      return videoStepPayloadSchema.parse(JSON.parse(step.payload));
    } catch {
      throw new AppError('DATA_CORRUPTION', 'Scene video step payload is invalid', 500);
    }
  }
  private parseContinuationStepPayload(
    step: ClaimedStep,
  ): z.infer<typeof continuationStepPayloadSchema> {
    try {
      return continuationStepPayloadSchema.parse(JSON.parse(step.payload));
    } catch {
      throw new AppError('DATA_CORRUPTION', 'Continuation extraction step payload is invalid', 500);
    }
  }
  private async critiqueVideo(
    projectId: Id,
    scene: SceneDto,
    generation: SceneVideoGenerationDto,
    request: VideoGenerationRequest,
    clipPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const settleUnavailable = (): void => {
      this.context.database.sqlite
        .prepare(
          `UPDATE scene_video_generations
           SET automatic_quality_status='UNAVAILABLE',critic_evaluation_id=NULL,updated_at=?
           WHERE project_id=? AND id=?`,
        )
        .run(new Date().toISOString(), projectId, generation.id);
    };
    if (!this.critic || !generation.assetId) {
      settleUnavailable();
      if (generation.reviewStatus !== 'ACCEPTED')
        this.generations.clearCurrent(
          projectId,
          scene.stableId,
          generation.id,
          generation.shotId ?? null,
        );
      return;
    }
    const plan = this.shotPlans.getCurrent(projectId, scene.id);
    const shot = generation.shotId
      ? (plan?.candidate.shots.find((candidate) => candidate.id === generation.shotId) ?? null)
      : (plan?.candidate.shots.find((candidate) => candidate.hero) ??
        plan?.candidate.shots[0] ??
        null);
    const sourceAssetId = request.continuationSource?.frameAssetId ?? request.sourceImageAssetId;
    const source = this.assets.get(sourceAssetId);
    if (!source || source.status !== 'READY') {
      if (generation.reviewStatus !== 'ACCEPTED')
        this.generations.clearCurrent(
          projectId,
          scene.stableId,
          generation.id,
          generation.shotId ?? null,
        );
      return;
    }
    const clipDurationMs =
      generation.clipDurationMs ??
      Math.round(((generation.frameCount ?? 1) / (generation.fps ?? 25)) * 1_000);
    const sampleSpecs = [
      { name: 'first', position: 0, role: 'SAMPLE' as const },
      { name: 'middle', position: 0.5, role: 'SAMPLE' as const },
      { name: 'last', position: 1, role: 'KEYFRAME' as const },
    ];
    const samplePaths = sampleSpecs.map((sample) =>
      join(this.context.workspace.staging, `video-critic-${generation.id}-${sample.name}.png`),
    );
    const sampleDestinations = sampleSpecs.map((sample) =>
      safeWorkspacePath(
        this.context.workspace.root,
        `projects/${projectId}/images/critics/video/${generation.id}-${sample.name}.png`,
      ),
    );
    try {
      await Promise.all(
        sampleSpecs.map((sample, index) =>
          sample.position === 1
            ? this.context.media.extractFinalVideoFrame(clipPath, samplePaths[index]!, signal)
            : this.context.media.extractVideoFrame(
                clipPath,
                samplePaths[index]!,
                clipDurationMs * sample.position,
                signal,
              ),
        ),
      );
      await Promise.all(
        samplePaths.map((path, index) => promoteFile(path, sampleDestinations[index]!)),
      );
      const samples = await Promise.all(sampleDestinations.map((path) => sha256File(path)));
      const sampleAssetIds = samples.map(() => randomUUID());
      for (const [index, sample] of samples.entries()) {
        this.assets.registerReference({
          id: sampleAssetIds[index]!,
          projectId,
          type: 'CRITIC_SAMPLE_IMAGE',
          role: `video-critic:${generation.id}:${sampleSpecs[index]!.name}`,
          path: relativeAssetPath(this.context.workspace.root, sampleDestinations[index]!),
          mediaType: 'image/png',
          bytes: sample.bytes,
          sha256: sample.hash,
          sourceEntityId: generation.id,
          inputFingerprint: generation.inputFingerprint,
          metadata: { generationId: generation.id, samplePosition: sampleSpecs[index]!.position },
        });
      }
      const clip = this.assets.get(generation.assetId);
      if (!clip || clip.status !== 'READY') {
        settleUnavailable();
        return;
      }
      const evaluation = await this.critic.evaluate(
        {
          projectId,
          generationId: generation.id,
          shot,
          sceneRevisionId: scene.id,
          clipAssetId: clip.id,
          clipSha256: clip.sha256,
          keyframeAssetId: sampleAssetIds[2]!,
          keyframeSha256: samples[2]!.hash,
          evidence: [
            { assetId: clip.id, sha256: clip.sha256, role: 'CANDIDATE', samplePosition: null },
            {
              assetId: source.id,
              sha256: source.sha256,
              role: 'REFERENCE',
              samplePosition: null,
            },
            ...sampleAssetIds.map((assetId, index) => ({
              assetId,
              sha256: samples[index]!.hash,
              role: sampleSpecs[index]!.role,
              samplePosition: sampleSpecs[index]!.position,
            })),
          ],
          imagePaths: [
            source.path,
            ...sampleDestinations.map((path) =>
              relativeAssetPath(this.context.workspace.root, path),
            ),
          ],
        },
        signal,
      );
      const criticStatus =
        evaluation.status === 'PASSED' ||
        evaluation.status === 'REJECTED' ||
        evaluation.status === 'UNAVAILABLE' ||
        evaluation.status === 'MANUAL_REVIEW_REQUIRED'
          ? evaluation.status
          : 'UNAVAILABLE';
      const metadata = generation.metadata;
      const profile =
        this.profiles.getCurrent(projectId, 'AUTO') ??
        this.profiles.getCurrent(projectId, 'BALANCED');
      const settings = this.settings.get(projectId);
      const fallback =
        metadata.qualityFallback === 'BLOCK' || metadata.qualityFallback === 'MANUAL_REVIEW'
          ? metadata.qualityFallback
          : (profile?.settings.qualityFallback ?? 'MANUAL_REVIEW');
      const requireHumanApproval =
        typeof metadata.requireHumanApproval === 'boolean'
          ? metadata.requireHumanApproval
          : Boolean(settings?.requireMotionApproval);
      const retryLimit =
        typeof metadata.temporalRetryLimit === 'number' &&
        Number.isInteger(metadata.temporalRetryLimit)
          ? metadata.temporalRetryLimit
          : (profile?.settings.temporalRetryLimit ?? 2);
      const action = automaticQualityAction(criticStatus, fallback);
      const guidance = temporalRetryGuidance(
        evaluation.issues,
        evaluation.guidance,
        evaluation.explanation,
      );
      const outcomeNotes =
        criticStatus === 'PASSED'
          ? null
          : `Automatic temporal quality ${criticStatus}: ${guidance}`.slice(0, 1_000);
      this.context.database.sqlite
        .prepare(
          'UPDATE scene_video_generations SET automatic_quality_status=?,critic_evaluation_id=?,review_notes=COALESCE(?,review_notes),updated_at=? WHERE id=?',
        )
        .run(criticStatus, evaluation.id, outcomeNotes, new Date().toISOString(), generation.id);
      if (action === 'ACCEPT' && settings && !requireHumanApproval)
        this.generations.setCurrent(
          projectId,
          scene.stableId,
          generation.id,
          generation.shotId ?? null,
          requireHumanApproval,
        );
      if (action !== 'ACCEPT' && generation.reviewStatus !== 'ACCEPTED')
        this.generations.clearCurrent(
          projectId,
          scene.stableId,
          generation.id,
          generation.shotId ?? null,
        );
      if (action !== 'RETRY') return;
      const retryCount =
        typeof metadata.retryCount === 'number' && Number.isInteger(metadata.retryCount)
          ? metadata.retryCount
          : 0;
      if (retryCount >= retryLimit) {
        this.context.database.sqlite
          .prepare(
            "UPDATE scene_video_generations SET automatic_quality_status='MANUAL_REVIEW_REQUIRED',review_notes=?,updated_at=? WHERE project_id=? AND id=?",
          )
          .run(
            `Automatic temporal quality retry limit exhausted: ${guidance}`.slice(0, 1_000),
            new Date().toISOString(),
            projectId,
            generation.id,
          );
        return;
      }
      const retryContext: QualityRetryContext = {
        sourceGenerationId: generation.id,
        criticEvaluationId: evaluation.id,
        issues: evaluation.issues,
        guidance,
      };
      const qualityPolicy =
        typeof metadata.requireImageApproval === 'boolean' &&
        typeof metadata.requireHumanApproval === 'boolean'
          ? {
              requireImageApproval: metadata.requireImageApproval,
              requireHumanApproval: metadata.requireHumanApproval,
              qualityFallback: fallback,
              temporalRetryLimit: retryLimit,
            }
          : undefined;
      const retrySeed = deterministicRetrySeed(generation.inputFingerprint, retryCount + 1);
      try {
        if (generation.shotId)
          this.scheduleShot(
            projectId,
            scene.id,
            generation.shotId,
            {
              instructions: guidance,
              retryCount: retryCount + 1,
              seed: retrySeed,
              qualityRetry: retryContext,
            },
            undefined,
            false,
            qualityPolicy,
          );
        else
          this.scheduleScene(
            projectId,
            scene,
            guidance,
            retrySeed,
            undefined,
            undefined,
            retryCount + 1,
            undefined,
            false,
            retryContext,
            qualityPolicy,
          );
      } catch (error) {
        this.context.database.sqlite
          .prepare(
            'UPDATE scene_video_generations SET review_notes=?,updated_at=? WHERE project_id=? AND id=?',
          )
          .run(
            `Automatic retry could not be scheduled: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
            new Date().toISOString(),
            projectId,
            generation.id,
          );
      }
    } finally {
      await Promise.all(samplePaths.map((path) => rm(path, { force: true })));
    }
  }

  private assertStagingPath(filename: string): void {
    const relativePath = relativeAssetPath(this.context.workspace.root, filename);
    if (!relativePath.startsWith('staging/'))
      throw new AppError('UNSAFE_PATH', 'Video provider output must be in managed staging', 400);
  }

  private scene(projectId: Id, sceneId: Id): SceneDto {
    this.assertProject(projectId);
    const scene = this.scenes.getScene(sceneId);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }

  private sceneByRevisionId(projectId: Id, sceneRevisionId: Id): SceneDto {
    const scene = this.scene(projectId, sceneRevisionId);
    if (scene.id !== sceneRevisionId)
      throw new AppError('STALE_INPUT', 'Scene revision no longer current', 409);
    return scene;
  }

  private assertProject(projectId: Id): void {
    const project = this.context.database.sqlite
      .prepare('SELECT 1 FROM projects WHERE id=?')
      .get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
  }
}

export function createSceneVideoService(
  context: StudioContext,
  provider?: VideoGenerationProvider,
  criticAgent?: AiAgent,
): SceneVideoService {
  return new SceneVideoService(context, provider, criticAgent);
}
