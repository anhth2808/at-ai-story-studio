import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import {
  type ImageConditioning,
  type ImageGenerationErrorCode,
  type ImageConditioningCharacter,
  type ImageConditioningMode,
  type ImageQualityIssue,
  type ImageReviewFeedback,
  type ImageWorkflowTemplate,
} from '@studio/shared';
import { z } from 'zod';
import {
  AssetRepository,
  SceneImageCandidateSetRepository,
  MediaCriticEvaluationRepository,
  ImageGenerationSettingsRepository,
  SceneImageGenerationRepository,
  SceneRepository,
  VisualPromptPackageRepository,
  ShotPlanRepository,
  WorkflowRepository,
  type ClaimedStep,
} from '@studio/database';
import {
  AppError,
  imageGenerationBatchSchema,
  imageGenerationRequestSchema,
  imageGenerationSettingsUpdateSchema,
  sceneImageCurrentSelectionSchema,
  sceneImageGenerationScheduleSchema,
  sceneImageReferencePromotionSchema,
  sceneImageRegenerationSchema,
  sceneImageReviewUpdateSchema,
  type Id,
  type ImageGenerationBatch,
  type ImageGenerationSettingsDto,
  type ImageReadiness,
  type VisualPromptPackageDto,
  type SceneDto,
  type SceneImageGenerationDto,
} from '@studio/shared';
import {
  prepareProjectDirectories,
  promoteFile,
  relativeAssetPath,
  safeWorkspacePath,
  sha256File,
  validateImageFile,
} from '@studio/media';
import {
  ComfyUiImageProvider,
  ImageProviderError,
  REFERENCE_CHARACTER_V1_MAX_REFERENCES,
  type ImageProvider,
} from './comfyui.js';
import type { AiAgent } from './omp-agent.js';
import { ImageCritic, rankImageCandidates } from './media-critics.js';
import { fingerprintValue } from './story-prompts.js';
import {
  imageGenerationFingerprint,
  imageSettingsFingerprint,
  IMAGE_CANDIDATE_BATCH_MAX_JOBS,
  resolveCandidateSeeds,
  resolveImageSeed,
} from './image-generation.js';
import type { StudioContext } from './index.js';

function parseAssetMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const scheduledRequestSchema = z
  .object({
    request: imageGenerationRequestSchema,
    packageFingerprint: z.string().min(1).max(128),
    settingsFingerprint: z.string().min(1).max(128),
    conditioningWarnings: z.array(z.string().min(1).max(500)).max(20).default([]),
  })
  .passthrough();

const imageStepPayloadSchema = z
  .object({ projectId: z.string().uuid(), generationId: z.string().uuid() })
  .strict();

export type ImageScheduleResult = {
  executionId: Id;
  stepId: Id;
  jobId: Id;
  generation: SceneImageGenerationDto;
};

export type ImageBatchScheduleResult = {
  executionId: Id;
  jobs: ImageScheduleResult[];
  skippedSceneIds: Id[];
};

export class ImageGenerationService {
  readonly settings: ImageGenerationSettingsRepository;
  readonly generations: SceneImageGenerationRepository;
  private readonly workflow: WorkflowRepository;
  private readonly scenes: SceneRepository;
  private readonly packages: VisualPromptPackageRepository;
  private readonly candidateSets: SceneImageCandidateSetRepository;

  private readonly criticEvaluations: MediaCriticEvaluationRepository;
  private readonly shotPlans: ShotPlanRepository;
  private readonly critic: ImageCritic | null;
  private readonly assets: AssetRepository;
  constructor(
    private readonly context: StudioContext,
    private readonly provider: ImageProvider = new ComfyUiImageProvider(context.workspace.staging),
    criticAgent?: AiAgent,
  ) {
    this.settings = new ImageGenerationSettingsRepository(context.database);
    this.generations = new SceneImageGenerationRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.packages = new VisualPromptPackageRepository(context.database);
    this.candidateSets = new SceneImageCandidateSetRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.criticEvaluations = new MediaCriticEvaluationRepository(context.database);
    this.shotPlans = new ShotPlanRepository(context.database);
    this.critic = criticAgent ? new ImageCritic(criticAgent, this.criticEvaluations) : null;
  }

  // Deterministic issue -> guidance translation. Reads only current Scene
  // and package data; never mutates canonical Story/profile/Scene records.
  private buildReviewFeedback(
    projectId: Id,
    sceneId: Id,
    source: SceneImageGenerationDto,
  ): ImageReviewFeedback | null {
    const review = source.review;
    if (!review || review.status !== 'REJECTED') return null;
    if (!review.issues.length && !review.notes.trim()) return null;
    const scene = this.scene(projectId, sceneId);
    const parts: string[] = [];
    const byIssue = new Set<ImageQualityIssue>(review.issues);
    if (byIssue.has('WRONG_FACE') || byIssue.has('WRONG_HAIR') || byIssue.has('WRONG_CLOTHING'))
      parts.push(
        'Keep the approved reference identity for every character: same face, hair, and clothing as the reference image',
      );
    if (
      byIssue.has('WRONG_POSE') ||
      byIssue.has('WRONG_COMPOSITION') ||
      byIssue.has('WRONG_CAMERA') ||
      byIssue.has('REFERENCE_POSE_BLEED')
    )
      parts.push(
        `Follow the Scene composition and camera exactly (${scene.camera.framing}${
          scene.camera.angle ? `, ${scene.camera.angle}` : ''
        }): ${scene.composition.subjectFocus}. Do not copy the reference image framing or pose`,
      );
    if (byIssue.has('MISSING_OBJECT'))
      parts.push(`Show the required objects clearly: ${scene.importantObjects.join(', ')}`);
    if (byIssue.has('EXTRA_OBJECT') || byIssue.has('DUPLICATE_OBJECT'))
      parts.push(
        `Render only the objects named by the Scene; no extra or duplicated props beyond ${scene.importantObjects.join(', ')}`,
      );
    if (byIssue.has('BAD_HANDS')) parts.push('Render natural, correct hands with five fingers');
    if (byIssue.has('BAD_TEXT')) parts.push('Do not render any readable text');
    if (byIssue.has('STYLE_DRIFT'))
      parts.push('Match the established visual style exactly; no style drift');
    if (review.notes.trim()) parts.push(review.notes.trim());
    const guidance = parts.join('. ').slice(0, 2000);
    return {
      version: 'image-review-feedback-v1',
      sourceGenerationId: source.id,
      sourceReview: {
        status: review.status,
        scores: review.scores,
        issues: review.issues,
        notes: review.notes,
      },
      guidance,
    };
  }

  getSettings(projectId: Id): ImageGenerationSettingsDto {
    this.assertProject(projectId);
    return this.settings.getOrCreate(projectId);
  }

  updateSettings(projectId: Id, value: unknown): ImageGenerationSettingsDto {
    this.assertProject(projectId);
    const settings = this.settings.update(
      projectId,
      imageGenerationSettingsUpdateSchema.parse(value),
    );
    this.workflow.invalidateEntities(
      this.scenes.listProjectCurrentSceneIds(projectId),
      ['GENERATE_SCENE_IMAGE'],
      'Image generation settings changed',
    );
    return settings;
  }

  async readiness(projectId: Id, signal?: AbortSignal): Promise<ImageReadiness> {
    return await this.provider.readiness(this.getSettings(projectId), signal);
  }

  getGeneration(projectId: Id, sceneId: Id, generationId: Id): SceneImageGenerationDto {
    const scene = this.scene(projectId, sceneId);
    const generation = this.generations.get(projectId, generationId);
    if (!generation || generation.sceneId !== scene.stableId)
      throw new AppError('NOT_FOUND', 'Scene image generation not found', 404);
    return generation;
  }

  listGenerations(projectId: Id, sceneId: Id, limit = 50, offset = 0): SceneImageGenerationDto[] {
    const scene = this.scene(projectId, sceneId);
    return this.generations.list(projectId, scene.stableId, limit, offset);
  }

  getCurrentGeneration(projectId: Id, sceneId: Id): SceneImageGenerationDto | null {
    const scene = this.scene(projectId, sceneId);
    return this.generations.getCurrent(projectId, scene.stableId);
  }

  schedule(projectId: Id, sceneId: Id, value: unknown = {}): ImageScheduleResult {
    const request = sceneImageGenerationScheduleSchema.parse(value);
    const scene = this.scene(projectId, sceneId);
    const executionId = this.workflow.createExecution(projectId, 'IMAGE_GENERATION');
    return this.scheduleScene(
      projectId,
      scene,
      request.instructions,
      undefined,
      executionId,
      request.conditioningMode,
      request.candidateCount,
    );
  }
  regenerate(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown = {},
  ): ImageScheduleResult {
    const request = sceneImageRegenerationSchema.parse(value);
    const scene = this.scene(projectId, sceneId);
    const previous = this.getGeneration(projectId, sceneId, generationId);
    const feedback = request.useReviewFeedback
      ? this.buildReviewFeedback(projectId, sceneId, previous)
      : null;
    if (request.useReviewFeedback && !feedback)
      throw new AppError(
        'INVALID_INPUT',
        'Review-feedback regeneration requires a rejected candidate with issues or notes',
        409,
      );
    const seed =
      request.mode === 'SAME_SEED'
        ? (previous.actualSeed ?? previous.requestedSeed)
        : resolveImageSeed('RANDOM', null);
    if (seed === null)
      throw new AppError('INVALID_INPUT', 'The selected image does not have a reusable seed', 409);
    const executionId = this.workflow.createExecution(projectId, 'IMAGE_GENERATION');
    return this.scheduleScene(
      projectId,
      scene,
      request.instructions,
      seed,
      executionId,
      request.conditioningMode,
      1,
      feedback,
    );
  }

  scheduleBatch(projectId: Id, value: unknown): ImageBatchScheduleResult {
    const request = imageGenerationBatchSchema.parse(value);
    const candidateJobs = Math.max(1, request.candidateCount);
    if (
      candidateJobs > 1 &&
      request.sceneIds.length * candidateJobs > IMAGE_CANDIDATE_BATCH_MAX_JOBS
    )
      throw new AppError(
        'INVALID_INPUT',
        `Multi-candidate batches are limited to ${IMAGE_CANDIDATE_BATCH_MAX_JOBS} total jobs`,
        400,
      );
    this.assertProject(projectId);
    const scenes = request.sceneIds.map((sceneId) => this.scene(projectId, sceneId));
    const executionId = this.workflow.createExecution(projectId, 'IMAGE_GENERATION');
    const jobs: ImageScheduleResult[] = [];
    const skippedSceneIds: Id[] = [];
    for (const scene of scenes) {
      const current = this.generations.getCurrent(projectId, scene.stableId);
      if (
        (request.onlyMissing && current?.freshness === 'CURRENT') ||
        (!request.includeStale && current?.freshness === 'STALE')
      ) {
        skippedSceneIds.push(scene.id);
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
          request.candidateCount,
        ),
      );
    }
    return { executionId, jobs, skippedSceneIds };
  }

  scheduleChapterBatch(
    projectId: Id,
    chapterId: Id,
    value: Omit<ImageGenerationBatch, 'sceneIds'>,
  ): ImageBatchScheduleResult {
    const chapter = this.context.database.sqlite
      .prepare('SELECT project_id as projectId FROM chapters WHERE id=?')
      .get(chapterId) as { projectId: Id } | undefined;
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const sceneIds = this.scenes.listScenes(chapterId, 200, 0).map((scene) => scene.id);
    if (!sceneIds.length)
      throw new AppError('PREREQUISITE_MISSING', 'Chapter has no current scenes', 409);
    return this.scheduleBatch(projectId, { ...value, sceneIds });
  }

  // Copies a completed Scene image into a new APPROVED character reference
  // Asset. The source generation and its Asset are never modified.
  async promoteToCharacterReference(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown,
  ): Promise<{ assetId: Id; characterId: string }> {
    const request = sceneImageReferencePromotionSchema.parse(value);
    const scene = this.scene(projectId, sceneId);
    const generation = this.getGeneration(projectId, sceneId, generationId);
    if (generation.status !== 'COMPLETED' || !generation.assetId)
      throw new AppError(
        'INVALID_INPUT',
        'Only a completed generation with an image can be promoted',
        400,
      );
    const asset = this.assets.get(generation.assetId);
    if (!asset || asset.projectId !== projectId || asset.status !== 'READY')
      throw new AppError('NOT_FOUND', 'Generation image asset not found', 404);
    const source = safeWorkspacePath(this.context.workspace.root, asset.path);
    const extension = ['png', 'jpg', 'jpeg', 'webp'].includes(
      extname(source).slice(1).toLowerCase(),
    )
      ? extname(source).toLowerCase()
      : '.png';
    const assetId = randomUUID();
    const destination = safeWorkspacePath(
      this.context.workspace.root,
      `projects/${projectId}/references/${assetId}${extension}`,
    );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const digest = await sha256File(destination);
    this.assets.registerReference({
      id: assetId,
      projectId,
      type: 'CHARACTER_REFERENCE_IMAGE',
      role: 'CHARACTER_REFERENCE_IMAGE',
      path: relativeAssetPath(this.context.workspace.root, destination),
      mediaType: asset.mediaType,
      bytes: digest.bytes,
      sha256: digest.hash,
      sourceEntityId: generation.id,
      metadata: {
        characterId: request.characterId,
        approval: 'APPROVED',
        promotedFromGenerationId: generation.id,
        displayName: `Scene ${scene.stableId} revision ${generation.revision}`,
      },
    });
    return { assetId, characterId: request.characterId };
  }

  updateReview(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown,
  ): SceneImageGenerationDto {
    this.getGeneration(projectId, sceneId, generationId);
    return this.generations.updateReview(
      projectId,
      generationId,
      sceneImageReviewUpdateSchema.parse(value),
    );
  }
  acceptCandidate(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown,
  ): SceneImageGenerationDto {
    const scene = this.scene(projectId, sceneId);
    this.getGeneration(projectId, sceneId, generationId);
    return this.generations.acceptCandidate(
      projectId,
      scene.stableId,
      generationId,
      sceneImageReviewUpdateSchema.parse(value),
    );
  }

  listCandidateSets(projectId: Id, sceneId: Id, limit = 50, offset = 0) {
    const scene = this.scene(projectId, sceneId);
    return this.candidateSets.list(projectId, scene.stableId, limit, offset);
  }

  setCurrent(
    projectId: Id,
    sceneId: Id,
    generationId: Id,
    value: unknown = {},
  ): SceneImageGenerationDto {
    const scene = this.scene(projectId, sceneId);
    this.getGeneration(projectId, sceneId, generationId);
    const request = sceneImageCurrentSelectionSchema.parse(value);
    return this.generations.setCurrent(
      projectId,
      scene.stableId,
      generationId,
      request.expectedSceneRevision,
    );
  }

  async registerManual(
    projectId: Id,
    sceneId: Id,
    stagingPath: string,
    notes = '',
  ): Promise<SceneImageGenerationDto> {
    const scene = this.scene(projectId, sceneId);
    this.assertStagingPath(stagingPath);
    const validated = await validateImageFile(this.context.media, stagingPath);
    const extension = validated.format === 'jpeg' ? 'jpg' : validated.format;
    const generationId = randomUUID();
    const destination = safeWorkspacePath(
      this.context.workspace.root,
      `projects/${projectId}/images/scenes/${safePathSegment(scene.stableId)}/${generationId}.${extension}`,
    );
    try {
      await prepareProjectDirectories(this.context.workspace, projectId);
      await promoteFile(stagingPath, destination);
      const file = await sha256File(destination);
      return this.generations.commitManual({
        generationId,
        projectId,
        sceneStableId: scene.stableId,
        sceneRevisionId: scene.id,
        assetPath: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: validated.mediaType,
        bytes: file.bytes,
        sha256: file.hash,
        width: validated.width,
        height: validated.height,
        notes,
      });
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    } finally {
      await rm(stagingPath, { force: true });
    }
  }
  private async critiqueAndSettle(
    projectId: Id,
    scene: SceneDto,
    generationId: Id,
    packageDto: VisualPromptPackageDto,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.critic) return;
    const generation = this.generations.get(projectId, generationId);
    const candidateAsset = generation?.assetId ? this.assets.get(generation.assetId) : null;
    if (!generation?.assetId || !candidateAsset || candidateAsset.status !== 'READY') return;
    const plan = this.shotPlans.getCurrent(projectId, scene.id);
    const shot =
      plan?.candidate.shots.find((candidate) => candidate.id === packageDto.payload.shotId) ??
      plan?.candidate.shots.find((candidate) => candidate.hero) ??
      plan?.candidate.shots[0];
    if (!shot) {
      this.context.database.sqlite
        .prepare(
          "UPDATE scene_image_generations SET automatic_quality_status='MANUAL_REVIEW_REQUIRED',updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), generation.id);
      return;
    }
    const referenceAssets = (packageDto.payload.referenceBindings ?? []).flatMap((binding) => {
      const asset = this.assets.get(binding.assetId);
      return asset && asset.status === 'READY' && asset.sha256 === binding.sha256 ? [asset] : [];
    });
    const referenceEvidence = referenceAssets.map((asset) => ({
      assetId: asset.id,
      sha256: asset.sha256,
      role: 'REFERENCE' as const,
      samplePosition: null,
    }));
    const evaluation = await this.critic.evaluate(
      {
        projectId,
        generationId: generation.id,
        candidateSetId: generation.candidateSetId,
        shot,
        sceneRevisionId: scene.id,
        assetId: generation.assetId,
        assetSha256: candidateAsset.sha256,
        packageFingerprint: packageDto.payload.inputFingerprint,
        referenceFingerprint: fingerprintValue(packageDto.payload.referenceBindings ?? []),
        evidence: [
          {
            assetId: generation.assetId,
            sha256: candidateAsset.sha256,
            role: 'CANDIDATE',
            samplePosition: null,
          },
          ...referenceEvidence,
        ],
        imagePaths: [candidateAsset.path, ...referenceAssets.map((asset) => asset.path)],
      },
      signal,
    );
    this.context.database.sqlite
      .prepare(
        'UPDATE scene_image_generations SET automatic_quality_status=?,critic_evaluation_id=?,updated_at=? WHERE id=?',
      )
      .run(evaluation.status, evaluation.id, new Date().toISOString(), generation.id);
    if (!generation.candidateSetId) return;
    const candidateSet = this.candidateSets.get(projectId, generation.candidateSetId);
    const siblings = this.generations
      .list(projectId, scene.stableId, 100, 0)
      .filter((candidate) => candidate.candidateSetId === generation.candidateSetId);
    if (
      !candidateSet ||
      siblings.length !== candidateSet.requestedCount ||
      siblings.some((candidate) => candidate.status !== 'COMPLETED')
    )
      return;
    const evaluated = siblings.flatMap((candidate) => {
      const result = this.criticEvaluations.latestImage(candidate.id);
      return result && candidate.candidateIndex
        ? [
            {
              generationId: candidate.id,
              candidateIndex: candidate.candidateIndex,
              evaluation: result,
            },
          ]
        : [];
    });
    if (evaluated.length !== siblings.length) return;
    const ranking = rankImageCandidates(evaluated);
    this.candidateSets.saveRanking(projectId, candidateSet.id, ranking);
    if (ranking.winnerGenerationId)
      this.generations.setCurrent(
        projectId,
        scene.stableId,
        ranking.winnerGenerationId,
        scene.revision,
      );
    else
      this.context.database.sqlite
        .prepare(
          "UPDATE scene_image_generations SET automatic_quality_status='MANUAL_REVIEW_REQUIRED',updated_at=? WHERE candidate_set_id=?",
        )
        .run(new Date().toISOString(), candidateSet.id);
  }

  async executeStep(
    step: ClaimedStep,
    workerId: string,
    signal?: AbortSignal,
    progress: (value: number, message: string) => void = () => undefined,
  ): Promise<void> {
    const payload = this.parseStepPayload(step);
    const generation = this.generations.get(payload.projectId, payload.generationId);
    if (!generation) throw new AppError('NOT_FOUND', 'Scene image generation not found', 404);
    if (generation.status === 'COMPLETED') return;
    if (!['PENDING', 'RUNNING'].includes(generation.status))
      throw new AppError('STALE_INPUT', 'Scene image generation is not runnable', 409);
    const scheduled = scheduledRequestSchema.parse(generation.metadata);
    const request = scheduled.request;
    if (
      request.projectId !== payload.projectId ||
      request.sceneId !== generation.sceneRevisionId ||
      request.providerJobId !== generation.providerJobId ||
      generation.inputFingerprint !== step.input_fingerprint
    )
      throw new AppError('STALE_INPUT', 'Scene image generation metadata is stale', 409);
    try {
      this.assertCurrentInputs(
        payload.projectId,
        request,
        scheduled.packageFingerprint,
        scheduled.settingsFingerprint,
      );
      this.generations.markRunning(payload.projectId, generation.id, step.attemptNumber);
      progress(0.1, 'Checking ComfyUI image generation readiness');
      const result = await this.provider.generate(request, signal);
      if (
        result.providerJobId !== request.providerJobId ||
        result.seed !== request.seed ||
        result.images.length !== 1
      )
        throw new ImageProviderError(
          'OUTPUT_INVALID',
          'ComfyUI returned an unexpected image result',
          false,
        );
      progress(0.8, 'Validating generated image');
      const output = result.images[0]!;
      this.assertStagingPath(output.stagingPath);
      const validated = await validateImageFile(this.context.media, output.stagingPath);
      if (validated.mediaType !== 'image/png')
        throw new ImageProviderError(
          'OUTPUT_INVALID',
          'text-to-image-v1 must return a PNG image',
          false,
        );
      const scene = this.scene(payload.projectId, request.sceneId);
      const destination = safeWorkspacePath(
        this.context.workspace.root,
        `projects/${payload.projectId}/images/scenes/${safePathSegment(scene.stableId)}/${generation.id}.png`,
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
            mediaType: validated.mediaType,
            bytes: file.bytes,
            sha256: file.hash,
            width: validated.width,
            height: validated.height,
            seed: result.seed,
            durationMs: result.durationMs,
            metadata: {
              provider: result.provider,
              providerJobId: result.providerJobId,
              warnings: result.warnings,
              providerMetadata: result.metadata,
            },
          },
          {
            stepId: step.id,
            attemptId: step.attemptId,
            workerId,
            inputFingerprint: step.input_fingerprint,
          },
        );
        if (!committed) {
          throw new AppError(
            'STALE_INPUT',
            'Image generation lease was lost before publication',
            409,
          );
        }
      } finally {
        await rm(output.stagingPath, { force: true });
      }
      const currentPackage = this.packages.get(payload.projectId, request.visualPromptPackageId);
      if (currentPackage) {
        try {
          await this.critiqueAndSettle(
            payload.projectId,
            scene,
            generation.id,
            currentPackage,
            signal,
          );
        } catch {
          this.context.database.sqlite
            .prepare(
              "UPDATE scene_image_generations SET automatic_quality_status='UNAVAILABLE',updated_at=? WHERE id=?",
            )
            .run(new Date().toISOString(), generation.id);
        }
      }
      progress(1, 'Scene image generation completed');
    } catch (error) {
      const failure = imageFailure(error, signal);
      if (failure.code === 'CANCELLED') {
        const cancellationMessage = await this.cancelRemote(request, signal, failure.message);
        this.generations.markCancelled(payload.projectId, generation.id, cancellationMessage);
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
      throw new ImageProviderError(
        failure.code,
        failure.message,
        failure.retryable && step.attemptNumber < step.max_attempts,
      );
    }
  }
  // Creates one candidate set and schedules `candidateCount` independent
  // generations inside one transaction. Seeds are resolved before writes;
  // retry/restart recovery keeps working per candidate via the full request
  // snapshot stored on each generation.
  private scheduleScene(
    projectId: Id,
    scene: SceneDto,
    instructions: string,
    requestedSeed: number | undefined,
    executionId: Id,
    conditioningModeOverride?: ImageConditioningMode,
    candidateCount = 1,
    feedback?: ImageReviewFeedback | null,
  ): ImageScheduleResult {
    this.assertSchedulable(scene);
    const settings = this.settings.getOrCreate(projectId);
    const packageDto = this.packages.getCurrent(projectId, scene.id);
    if (!packageDto || packageDto.status !== 'CURRENT')
      throw new AppError(
        'PREREQUISITE_MISSING',
        'A current Visual Prompt Package is required',
        409,
      );
    if (feedback && requestedSeed === undefined)
      throw new AppError('INVALID_INPUT', 'Feedback regeneration requires a concrete seed', 400);
    const seeds =
      requestedSeed !== undefined
        ? [requestedSeed]
        : resolveCandidateSeeds(settings.seedMode, settings.fixedSeed, candidateCount);
    const references = collectReferenceAssetIds(packageDto.payload).map((assetId) => ({ assetId }));
    const conditioningMode = conditioningModeOverride ?? settings.conditioningMode;
    const { conditioning, workflowTemplate, conditioningWarnings } = this.resolveConditioning(
      projectId,
      packageDto,
      conditioningMode,
    );
    const settingsFingerprint = imageSettingsFingerprint(settings);
    if (settingsFingerprint !== settings.inputFingerprint)
      throw new AppError(
        'DATA_CORRUPTION',
        'Image generation settings fingerprint is invalid',
        500,
      );
    const candidateSet = this.candidateSets.create({
      projectId,
      sceneStableId: scene.stableId,
      sceneRevisionId: scene.id,
      visualPromptPackageId: packageDto.id,
      mode: conditioningMode,
      workflowTemplate,
      packageFingerprint: packageDto.payload.inputFingerprint,
      settingsFingerprint,
      requestedCount: seeds.length,
      sourceGenerationId: feedback?.sourceGenerationId ?? null,
      generationInstructions: instructions || null,
      metadata: {
        conditioningWarnings,
        ...(feedback ? { reviewFeedback: feedback } : {}),
      },
    });
    let lastResult: ImageScheduleResult | null = null;
    seeds.forEach((seed, index) => {
      const providerJobId = randomUUID();
      const request = imageGenerationRequestSchema.parse({
        projectId,
        sceneId: scene.id,
        visualPromptPackageId: packageDto.id,
        providerJobId,
        prompt: packageDto.payload.fullPrompt,
        negativePrompt: packageDto.payload.negativePrompt,
        width: settings.width,
        height: settings.height,
        seed,
        steps: settings.steps,
        guidance: settings.guidance,
        samplerHint: settings.sampler,
        referenceImages: references,
        providerSettings: {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          workflowTemplate,
          diffusionModel: settings.diffusionModel,
          textEncoder: settings.textEncoder,
          vaeName: settings.vaeName,
          sampler: settings.sampler,
          connectionTimeoutMs: settings.connectionTimeoutMs,
          generationTimeoutMs: settings.generationTimeoutMs,
        },
        referenceBindings: packageDto.payload.referenceBindings,
        conditioning,
        generationInstructions: instructions,
        reviewFeedback: feedback ?? null,
      });
      const inputFingerprint = imageGenerationFingerprint({
        operation: 'GENERATE_SCENE_IMAGE',
        projectId,
        sceneId: scene.id,
        sceneStableId: scene.stableId,
        sceneRevision: scene.revision,
        packageId: packageDto.id,
        packageFingerprint: packageDto.payload.inputFingerprint,
        settingsFingerprint,
        workflowTemplate,
        request,
      });
      const generation = this.generations.create({
        projectId,
        sceneStableId: scene.stableId,
        sceneRevisionId: scene.id,
        visualPromptPackageId: packageDto.id,
        source: 'GENERATED',
        provider: settings.provider,
        requestedSeed: seed,
        requestedWidth: request.width,
        requestedHeight: request.height,
        providerJobId,
        workflowTemplate,
        modelSettings: request.providerSettings,
        packageFingerprint: packageDto.payload.inputFingerprint,
        settingsFingerprint,
        inputFingerprint,
        generationInstructions: instructions || null,
        metadata: {
          request,
          packageFingerprint: packageDto.payload.inputFingerprint,
          settingsFingerprint,
          conditioningWarnings,
          candidateSetId: candidateSet.id,
          candidateIndex: index + 1,
          candidateCount: seeds.length,
        },
      });
      this.linkCandidate(projectId, generation.id, candidateSet.id, index + 1);
      const stepId = this.workflow.createStep(
        executionId,
        `scene-image:${scene.id}:${generation.revision}`,
        'GENERATE_SCENE_IMAGE',
        scene.id,
        inputFingerprint,
        3,
        { projectId, generationId: generation.id },
      );
      this.generations.linkWorkflowStep(projectId, generation.id, stepId);
      lastResult = {
        executionId,
        stepId,
        jobId: this.workflow.createJob('GENERATE_SCENE_IMAGE', generation.id, stepId),
        generation,
      };
    });
    return lastResult!;
  }

  private linkCandidate(
    projectId: Id,
    generationId: Id,
    candidateSetId: Id,
    candidateIndex: number,
  ): void {
    this.context.database.sqlite
      .prepare(
        'UPDATE scene_image_generations SET candidate_set_id=?,candidate_index=? WHERE project_id=? AND id=?',
      )
      .run(candidateSetId, candidateIndex, projectId, generationId);
  }

  // Explicit CharacterId -> reference binding. Only the approved PRIMARY
  // reference (first entry) of each profile-resolved character conditions
  // this milestone; the model's tested reference limit caps the mapping.
  private resolveConditioning(
    projectId: Id,
    packageDto: VisualPromptPackageDto,
    mode: ImageConditioningMode,
  ): {
    conditioning: ImageConditioning;
    workflowTemplate: ImageWorkflowTemplate;
    conditioningWarnings: string[];
  } {
    const workflowTemplate: ImageWorkflowTemplate =
      mode === 'REFERENCE_CONDITIONED' ? 'reference-character-v1' : 'text-to-image-v1';
    if (mode !== 'REFERENCE_CONDITIONED')
      return { conditioning: { mode, characters: [] }, workflowTemplate, conditioningWarnings: [] };
    const characters: ImageConditioningCharacter[] = [];
    let excluded = 0;
    for (const resolved of packageDto.payload.characters) {
      const primary = resolved.canonicalAppearance?.referenceAssetIds[0];
      if (!primary || !resolved.characterId || resolved.profileRevision === null) continue;
      if (characters.length >= REFERENCE_CHARACTER_V1_MAX_REFERENCES) {
        excluded += 1;
        continue;
      }
      const asset = this.assets.get(primary);
      const metadata = parseAssetMetadata(asset?.metadata);
      if (
        !asset ||
        asset.projectId !== projectId ||
        asset.status !== 'READY' ||
        asset.type !== 'CHARACTER_REFERENCE_IMAGE' ||
        metadata.approval !== 'APPROVED' ||
        metadata.characterId !== resolved.characterId
      )
        continue;
      characters.push({
        characterId: resolved.characterId,
        referenceAssetId: asset.id,
        referenceSha256: asset.sha256,
        referencePath: asset.path,
        profileRevision: resolved.profileRevision,
      });
    }
    if (!characters.length)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Reference-conditioned generation requires an approved primary character reference on the Scene Visual Prompt Package',
        409,
      );
    const conditioningWarnings = excluded
      ? [
          `${excluded} Scene character(s) were not conditioned: the approved template conditions at most ${REFERENCE_CHARACTER_V1_MAX_REFERENCES} characters`,
        ]
      : [];
    return { conditioning: { mode, characters }, workflowTemplate, conditioningWarnings };
  }

  private assertCurrentInputs(
    projectId: Id,
    request: z.infer<typeof imageGenerationRequestSchema>,
    packageFingerprint: string,
    settingsFingerprint: string,
  ): void {
    const packageDto = this.packages.getCurrent(projectId, request.sceneId);
    if (
      !packageDto ||
      packageDto.id !== request.visualPromptPackageId ||
      packageDto.status !== 'CURRENT' ||
      packageDto.payload.inputFingerprint !== packageFingerprint
    )
      throw new AppError(
        'STALE_INPUT',
        'Visual Prompt Package changed before image generation',
        409,
      );
    const settings = this.settings.getOrCreate(projectId);
    if (settings.inputFingerprint !== settingsFingerprint)
      throw new AppError(
        'STALE_INPUT',
        'Image generation settings changed before image generation',
        409,
      );
  }

  private scene(projectId: Id, sceneId: Id): SceneDto {
    this.assertProject(projectId);
    const scene = this.scenes.getScene(sceneId);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    return scene;
  }

  private assertProject(projectId: Id): void {
    const project = this.context.database.sqlite
      .prepare('SELECT 1 FROM projects WHERE id=?')
      .get(projectId);
    if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
  }

  private assertSchedulable(scene: SceneDto): void {
    const plan = this.scenes.getScenePlan(scene.chapterId);
    if (
      scene.status !== 'CURRENT' ||
      scene.promptStatus !== 'CURRENT' ||
      plan?.status !== 'CURRENT'
    )
      throw new AppError(
        'STALE_INPUT',
        'Scene is stale; rebuild the current Scene and Visual Prompt Package',
        409,
      );
  }

  private parseStepPayload(step: ClaimedStep): z.infer<typeof imageStepPayloadSchema> {
    try {
      return imageStepPayloadSchema.parse(JSON.parse(step.payload));
    } catch {
      throw new AppError('INVALID_INPUT', 'Image workflow step payload is invalid', 400);
    }
  }

  private assertStagingPath(filename: string): void {
    const relativePath = relativeAssetPath(this.context.workspace.root, filename);
    if (!relativePath.startsWith('staging/'))
      throw new AppError('UNSAFE_PATH', 'Image provider output must be in managed staging', 400);
  }

  private async cancelRemote(
    request: z.infer<typeof imageGenerationRequestSchema>,
    signal: AbortSignal | undefined,
    message: string,
  ): Promise<string> {
    if (!signal?.aborted) return message;
    try {
      await this.provider.cancel(request.providerJobId, request.providerSettings);
      return 'Image generation cancelled';
    } catch (error) {
      return `Image generation cancelled locally; remote cancellation unavailable: ${
        error instanceof Error ? error.message.slice(0, 300) : 'unknown error'
      }`;
    }
  }
}

export function createImageGenerationService(
  context: StudioContext,
  provider?: ImageProvider,
  criticAgent?: AiAgent,
): ImageGenerationService {
  return new ImageGenerationService(context, provider, criticAgent);
}

function collectReferenceAssetIds(payload: {
  style: { referenceAssetIds: string[] } | null;
  characters: Array<{ canonicalAppearance: { referenceAssetIds: string[] } | null }>;
  location: { canonicalAppearance: { referenceAssetIds: string[] } | null };
  objects: Array<{ canonicalAppearance: { referenceAssetIds: string[] } | null }>;
}): Id[] {
  return [
    ...new Set([
      ...(payload.style?.referenceAssetIds ?? []),
      ...payload.characters.flatMap((value) => value.canonicalAppearance?.referenceAssetIds ?? []),
      ...(payload.location.canonicalAppearance?.referenceAssetIds ?? []),
      ...payload.objects.flatMap((value) => value.canonicalAppearance?.referenceAssetIds ?? []),
    ]),
  ]
    .slice(0, 12)
    .filter((value): value is Id => z.string().uuid().safeParse(value).success);
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 120) || 'scene';
}

function imageFailure(
  error: unknown,
  signal?: AbortSignal,
): {
  code: ImageGenerationErrorCode;
  message: string;
  retryable: boolean;
} {
  if (signal?.aborted)
    return { code: 'CANCELLED', message: 'Image generation cancelled', retryable: false };
  if (error instanceof ImageProviderError)
    return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof AppError && error.code === 'STALE_INPUT')
    return { code: 'STALE_INPUT', message: error.message, retryable: false };
  return {
    code: 'GENERATION_FAILED',
    message: error instanceof Error ? error.message.slice(0, 2_000) : 'Image generation failed',
    retryable: false,
  };
}
