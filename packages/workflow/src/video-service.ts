import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  AppError,
  aiVideoBatchSchema,
  sceneMotionSourceUpdateSchema,
  sceneVideoRegenerationSchema,
  sceneVideoReviewUpdateSchema,
  videoGenerationRequestSchema,
  videoGenerationSettingsUpdateSchema,
  VIDEO_OUTPUT_FPS,
  VIDEO_PRESETS,
  type AiMotionPlanDto,
  type Id,
  type MotionSource,
  type SceneDto,
  type SceneVideoGenerationDto,
  type VideoGenerationRequest,
  type VideoGenerationSettingsDto,
  type VideoReadiness,
} from '@studio/shared';
import { z } from 'zod';
import {
  AiMotionPlanRepository,
  SceneMotionSourceRepository,
  SceneRepository,
  SceneVideoGenerationRepository,
  VideoGenerationSettingsRepository,
  WorkflowRepository,
  videoSettingsFingerprint,
  type ClaimedStep,
} from '@studio/database';
import {
  managedMotionRelativePath,
  prepareProjectDirectories,
  promoteFile,
  relativeAssetPath,
  safeWorkspacePath,
  sha256File,
  validateRawAiVideo,
} from '@studio/media';
import {
  ComfyUiVideoProvider,
  VideoProviderError,
  type VideoGenerationProvider,
} from './comfyui-video.js';
import {
  aiMotionPlanFingerprint,
  compileMotionPrompt,
  createDefaultAiMotionPlan,
} from './ai-motion-plan.js';
import type { StudioContext } from './index.js';

const scheduledVideoRequestSchema = z
  .object({
    request: videoGenerationRequestSchema,
    motionPlanFingerprint: z.string().min(1).max(128),
    settingsFingerprint: z.string().min(1).max(128),
  })
  .passthrough();

const videoStepPayloadSchema = z
  .object({ projectId: z.string().uuid(), generationId: z.string().uuid() })
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
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 'image-to-video-v1-mapping-1',
        operation: 'GENERATE_AI_SCENE_VIDEO',
        projectId: input.projectId,
        sceneRevisionId: input.sceneRevisionId,
        sceneStableId: input.sceneStableId,
        motionPlanFingerprint: input.motionPlanFingerprint,
        settingsFingerprint: input.settingsFingerprint,
        request: {
          sourceImageAssetId: input.request.sourceImageAssetId,
          sourceImageSha256: input.request.sourceImageSha256,
          motionPrompt: input.request.motionPrompt,
          negativePrompt: input.request.negativePrompt,
          width: input.request.width,
          height: input.request.height,
          frameCount: input.request.frameCount,
          fps: input.request.fps,
          seed: input.request.seed,
          model: input.request.providerSettings.diffusionModel,
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
  if (error instanceof AppError)
    return {
      code: error.code === 'STALE_INPUT' ? 'STALE_INPUT' : 'GENERATION_FAILED',
      message: error.message,
      retryable: false,
    };
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

  constructor(
    private readonly context: StudioContext,
    private readonly provider: VideoGenerationProvider = new ComfyUiVideoProvider(
      context.workspace.staging,
    ),
  ) {
    this.settings = new VideoGenerationSettingsRepository(context.database);
    this.generations = new SceneVideoGenerationRepository(context.database);
    this.plans = new AiMotionPlanRepository(context.database);
    this.motionSources = new SceneMotionSourceRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.scenes = new SceneRepository(context.database);
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
    const input = z
      .object({
        characterAction: z.string().max(500).optional(),
        environmentMotion: z.string().max(500).optional(),
        cameraMotion: z.string().max(60).optional(),
        intensity: z.string().max(20).optional(),
        priority: z.string().max(20).optional(),
      })
      .strict()
      .parse(value ?? {});
    const scene = this.scene(projectId, sceneId);
    const current = this.ensureMotionPlan(projectId, scene.id, scene);
    const intent = {
      ...current.intent,
      ...(input.characterAction !== undefined ? { characterAction: input.characterAction } : {}),
      ...(input.environmentMotion !== undefined
        ? { environmentMotion: input.environmentMotion }
        : {}),
      ...(input.cameraMotion !== undefined
        ? { cameraMotion: input.cameraMotion as AiMotionPlanDto['intent']['cameraMotion'] }
        : {}),
      ...(input.intensity !== undefined
        ? { intensity: input.intensity as AiMotionPlanDto['intent']['intensity'] }
        : {}),
      ...(input.priority !== undefined
        ? { priority: input.priority as AiMotionPlanDto['intent']['priority'] }
        : {}),
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
      .object({ issues: z.array(z.string().max(60)).max(12).default([]), notes: z.string().max(1_000).default('') })
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

  scheduleBatch(projectId: Id, value: unknown): SceneVideoBatchScheduleResult {
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
      jobs.push(this.scheduleScene(projectId, scene, '', undefined, executionId));
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

  private scheduleScene(
    projectId: Id,
    scene: SceneDto,
    instructions: string,
    seedOverride?: number,
    executionId?: Id,
  ): SceneVideoScheduleResult {
    if (scene.status !== 'CURRENT')
      throw new AppError('PREREQUISITE_MISSING', 'A current scene revision is required', 409);
    const motionSource = this.motionSources.get(projectId, scene.stableId);
    if (motionSource === 'KEN_BURNS')
      throw new AppError(
        'INVALID_INPUT',
        'Scene motion source is KEN_BURNS; set it to AI_VIDEO or HYBRID first',
        409,
      );
    const settings = this.settings.getOrCreate(projectId);
    const settingsFingerprint = videoSettingsFingerprint(settings);
    const plan = this.ensureMotionPlan(projectId, scene.id, scene);
    const image = this.currentImageAsset(projectId, scene.stableId);
    if (!image)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'A current accepted scene image is required before AI video generation',
        409,
      );
    const preset = VIDEO_PRESETS[settings.preset];
    const seed = seedOverride ?? resolveVideoSeed(settings.seedMode, settings.fixedSeed);
    const motionPrompt = instructions
      ? `${plan.motionPrompt} Additional direction: ${instructions.trim()}`
      : plan.motionPrompt;
    const providerJobId = randomUUID();
    const request = videoGenerationRequestSchema.parse({
      projectId,
      sceneId: scene.stableId,
      sceneRevisionId: scene.id,
      providerJobId,
      sourceImageAssetId: image.id,
      sourceImageSha256: image.sha256,
      sourceImagePath: image.path,
      motionPrompt,
      negativePrompt: plan.negativePrompt,
      width: preset.width,
      height: preset.height,
      frameCount: preset.frames,
      fps: VIDEO_OUTPUT_FPS,
      seed,
      providerSettings: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        workflowTemplate: settings.workflowTemplate,
        diffusionModel: settings.diffusionModel,
        textEncoder: settings.textEncoder,
        vaeName: settings.vaeName,
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
    const execution = executionId ?? this.workflow.createExecution(projectId, 'GENERATE_AI_SCENE_VIDEO');
    // Identical deterministic inputs must reuse the existing raw clip instead
    // of spending GPU time again.
    const existing = this.generations.findCompletedByFingerprint(
      projectId,
      scene.stableId,
      inputFingerprint,
    );
    if (existing)
      return { executionId: execution, stepId: null, jobId: null, generation: existing, reused: true };
    const generation = this.generations.create({
      projectId,
      chapterId: scene.chapterId,
      sceneStableId: scene.stableId,
      sceneRevisionId: scene.id,
      aiMotionPlanRevisionId: plan.id,
      provider: settings.provider,
      requestedSeed: seed,
      requestedWidth: request.width,
      requestedHeight: request.height,
      frameCount: request.frameCount,
      fps: request.fps,
      providerJobId,
      workflowTemplate: settings.workflowTemplate,
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
      metadata: { request, motionPlanFingerprint: plan.inputFingerprint, settingsFingerprint },
    });
    const stepId = this.workflow.createStep(
      execution,
      `scene-video:${scene.id}:${generation.revision}`,
      'GENERATE_AI_SCENE_VIDEO',
      scene.id,
      inputFingerprint,
      3,
      { projectId, generationId: generation.id },
    );
    this.generations.linkWorkflowStep(projectId, generation.id, stepId);
    return {
      executionId: execution,
      stepId,
      jobId: this.workflow.createJob('GENERATE_AI_SCENE_VIDEO', generation.id, stepId),
      generation,
      reused: false,
    };
  }

  private currentImageAsset(
    projectId: Id,
    sceneStableId: string,
  ): { id: Id; sha256: string; path: string } | null {
    const row = this.context.database.sqlite
      .prepare(
        `SELECT id,sha256,path FROM assets
         WHERE project_id=? AND role=? AND type='SCENE_IMAGE' AND is_current=1 AND status='READY'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(projectId, `scene:${sceneStableId}:image`) as
      | { id: Id; sha256: string; path: string }
      | undefined;
    return row ?? null;
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
    if (generation.status === 'COMPLETED') return;
    if (!['PENDING', 'RUNNING'].includes(generation.status))
      throw new AppError('STALE_INPUT', 'Scene video generation is not runnable', 409);
    const scheduled = scheduledVideoRequestSchema.parse(generation.metadata);
    const request = scheduled.request;
    if (
      request.projectId !== payload.projectId ||
      request.sceneRevisionId !== generation.sceneRevisionId ||
      request.providerJobId !== generation.providerJobId ||
      generation.inputFingerprint !== step.input_fingerprint
    )
      throw new AppError('STALE_INPUT', 'Scene video generation metadata is stale', 409);
    try {
      this.assertCurrentInputs(payload.projectId, generation.sceneId, generation.sceneRevisionId, scheduled);
      this.generations.markRunning(payload.projectId, generation.id, step.attemptNumber);
      progress(0.1, 'Checking ComfyUI video generation readiness');
      const result = await this.provider.generate(request, signal);
      if (
        result.providerJobId !== request.providerJobId ||
        result.seed !== request.seed ||
        result.videos.length !== 1
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
        managedMotionRelativePath(
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
            fps: result.fps,
            frameCount: result.frameCount,
            clipDurationMs: validated.durationMs,
            generationDurationMs: result.durationMs,
            metadata: {
              provider: result.provider,
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
          throw new AppError('STALE_INPUT', 'Video generation lease was lost before publication', 409);
      } finally {
        await rm(output.stagingPath, { force: true });
      }
      progress(1, 'Scene AI video generation completed');
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
        this.generations.markFailed(payload.projectId, generation.id, failure.code, failure.message);
      }
      throw new VideoProviderError(
        failure.code as VideoProviderError['code'],
        failure.message,
        failure.retryable && step.attemptNumber < step.max_attempts,
      );
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
    },
  ): void {
    const imageSha = this.generations.currentSourceImageSha(projectId, sceneStableId);
    if (!imageSha)
      throw new AppError('STALE_INPUT', 'Scene no longer has a current accepted image', 409);
    if (imageSha !== scheduled.request.sourceImageSha256)
      throw new AppError('STALE_INPUT', 'The accepted scene image changed during generation', 409);
    const settings = this.settings.get(projectId);
    if (!settings || settings.inputFingerprint !== scheduled.settingsFingerprint)
      throw new AppError('STALE_INPUT', 'Video generation settings changed', 409);
    const plan = this.plans.getCurrent(projectId, sceneRevisionId);
    if (!plan || plan.inputFingerprint !== scheduled.motionPlanFingerprint)
      throw new AppError('STALE_INPUT', 'AI motion plan changed', 409);
  }

  private parseStepPayload(step: ClaimedStep): z.infer<typeof videoStepPayloadSchema> {
    try {
      return videoStepPayloadSchema.parse(JSON.parse(step.payload));
    } catch {
      throw new AppError('DATA_CORRUPTION', 'Scene video step payload is invalid', 500);
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
): SceneVideoService {
  return new SceneVideoService(context, provider);
}
