import { randomInt, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  AppError,
  imageGenerationRequestSchema,
  type Id,
  type ImageGenerationRequest,
  type VisualReferenceGeneration,
  type VisualReferenceTargetKind,
} from '@studio/shared';
import {
  AppearanceStageRepository,
  AssetRepository,
  ImageGenerationSettingsRepository,
  SceneRepository,
  VisualProfileRepository,
  VisualReferenceGenerationRepository,
  WorkflowRepository,
  type ClaimedStep,
} from '@studio/database';
import {
  prepareProjectDirectories,
  promoteFile,
  relativeAssetPath,
  safeWorkspacePath,
  sha256File,
  validateImageFile,
} from '@studio/media';
import type { StudioContext } from './index.js';
import { ComfyUiImageProvider, type ImageProvider } from './comfyui.js';
import {
  compileAppearanceStagePrompt,
  compileCharacterPrototypePrompt,
  compileLocationReferencePrompt,
} from './visual-references.js';
import { fingerprintValue } from './story-prompts.js';

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 120) || 'reference';
}

export class VisualReferenceService {
  readonly generations: VisualReferenceGenerationRepository;
  readonly stages: AppearanceStageRepository;
  private readonly assets: AssetRepository;
  private readonly imageSettings: ImageGenerationSettingsRepository;
  private readonly profiles: VisualProfileRepository;
  private readonly scenes: SceneRepository;
  private readonly workflow: WorkflowRepository;

  constructor(
    private readonly context: StudioContext,
    private readonly provider: ImageProvider = new ComfyUiImageProvider(context.workspace.staging),
  ) {
    this.generations = new VisualReferenceGenerationRepository(context.database);
    this.stages = new AppearanceStageRepository(context.database);
    this.assets = new AssetRepository(context.database);
    this.imageSettings = new ImageGenerationSettingsRepository(context.database);
    this.profiles = new VisualProfileRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
  }

  schedule(projectId: Id, targetKind: VisualReferenceTargetKind, targetEntityId: string) {
    const style = this.scenes.getVisualStyle(projectId);
    let targetRevision: number;
    let conditioningProfileRevision: number | null = null;
    let sourcePrototypeAssetId: Id | null = null;
    let sourcePrototypeSha256: string | null = null;
    let compiled: { prompt: string; inputFingerprint: string };
    if (targetKind === 'CHARACTER_PROTOTYPE') {
      const profile = this.profiles.getCharacter(projectId, targetEntityId);
      if (!profile || profile.status !== 'APPROVED')
        throw new AppError(
          'INVALID_REFERENCE',
          'An approved current Character profile is required',
          409,
        );
      targetRevision = profile.revision;
      conditioningProfileRevision = profile.revision;
      compiled = compileCharacterPrototypePrompt(profile, style);
    } else if (targetKind === 'CHARACTER_STAGE') {
      const stage = this.stages.get(projectId, targetEntityId);
      if (!stage || !stage.isCurrent || stage.reviewStatus !== 'APPROVED')
        throw new AppError(
          'INVALID_REFERENCE',
          'An approved current appearance stage is required',
          409,
        );
      const profile = this.profiles.getCharacter(
        projectId,
        stage.characterId,
        stage.profileRevision,
      );
      if (!profile)
        throw new AppError(
          'INVALID_REFERENCE',
          'Appearance-stage Character profile is unavailable',
          409,
        );
      const prototype = this.generations.resolveApproved(
        projectId,
        'CHARACTER_PROTOTYPE',
        stage.characterId,
        stage.profileRevision,
      );
      if (!prototype?.assetId || !prototype.assetSha256)
        throw new AppError(
          'INVALID_REFERENCE',
          'An exact approved current Character prototype is required',
          409,
        );
      targetRevision = stage.revision;
      conditioningProfileRevision = stage.profileRevision;
      sourcePrototypeAssetId = prototype.assetId;
      sourcePrototypeSha256 = prototype.assetSha256;
      compiled = compileAppearanceStagePrompt(
        profile,
        stage.payload,
        { assetId: prototype.assetId, sha256: prototype.assetSha256 },
        style,
      );
    } else {
      const profile = this.profiles.getLocation(projectId, targetEntityId);
      if (!profile || profile.status !== 'APPROVED')
        throw new AppError(
          'INVALID_REFERENCE',
          'An approved current Location profile is required',
          409,
        );
      targetRevision = profile.revision;
      compiled = compileLocationReferencePrompt(
        targetEntityId,
        profile.revision,
        {
          environmentType: profile.payload.environmentType,
          architecture: profile.payload.architecture,
          spatialLayout: profile.payload.overallDescription,
          walls: '',
          windows: '',
          doors: '',
          fixedFurniture: profile.payload.recurringObjects,
          terrain: profile.payload.terrain,
          permanentLandmarks: profile.payload.importantLandmarks,
        },
        style,
      );
    }
    const settings = this.imageSettings.getOrCreate(projectId);
    const providerJobId = randomUUID();
    const workflowTemplate = sourcePrototypeAssetId ? 'reference-character-v1' : 'text-to-image-v1';
    const sourceAsset = sourcePrototypeAssetId ? this.assets.get(sourcePrototypeAssetId) : null;
    const request = imageGenerationRequestSchema.parse({
      projectId,
      sceneId: randomUUID(),
      visualPromptPackageId: randomUUID(),
      providerJobId,
      prompt: compiled.prompt,
      negativePrompt: 'text, watermark, extra people, duplicate body, distorted anatomy',
      width: settings.width,
      height: settings.height,
      seed: settings.seedMode === 'FIXED' ? settings.fixedSeed : randomInt(0, 2_147_483_647),
      steps: settings.steps,
      guidance: settings.guidance,
      samplerHint: settings.sampler,
      referenceImages: sourcePrototypeAssetId ? [{ assetId: sourcePrototypeAssetId }] : [],
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
      conditioning:
        sourcePrototypeAssetId && sourcePrototypeSha256 && sourceAsset
          ? {
              mode: 'REFERENCE_CONDITIONED',
              characters: [
                {
                  characterId: targetEntityId,
                  referenceAssetId: sourcePrototypeAssetId,
                  referenceSha256: sourcePrototypeSha256,
                  referencePath: sourceAsset.path.replaceAll('\\', '/'),
                  profileRevision: conditioningProfileRevision ?? targetRevision,
                },
              ],
            }
          : { mode: 'TEXT_ONLY', characters: [] },
      generationInstructions: '',
      reviewFeedback: null,
    });
    const generation = this.generations.create({
      projectId,
      targetKind,
      targetEntityId,
      targetRevision,
      sourcePrototypeAssetId,
      sourcePrototypeSha256,
      prompt: compiled.prompt,
      workflowTemplate,
      provider: settings.provider,
      settings: { request },
      seed: request.seed,
      inputFingerprint: fingerprintValue({ compiled: compiled.inputFingerprint, request }),
    });
    const executionId = this.workflow.createExecution(projectId, 'VISUAL_REFERENCE_GENERATION');
    const stepId = this.workflow.createStep(
      executionId,
      `visual-reference:${generation.id}:${generation.inputFingerprint}`,
      'GENERATE_VISUAL_REFERENCE',
      generation.id,
      generation.inputFingerprint,
      3,
      { generationId: generation.id },
    );
    this.context.database.sqlite
      .prepare('UPDATE visual_reference_generations SET workflow_step_id=? WHERE id=?')
      .run(stepId, generation.id);
    return {
      generation,
      executionId,
      stepId,
      jobId: this.workflow.createJob('GENERATE_VISUAL_REFERENCE', generation.id, stepId),
    };
  }

  async executeStep(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    const generation = this.generations.get(step.entity_id);
    if (!generation) throw new AppError('NOT_FOUND', 'Visual reference generation not found', 404);
    if (generation.status === 'COMPLETED') return;
    if (generation.inputFingerprint !== step.input_fingerprint)
      throw new AppError('STALE_INPUT', 'Visual reference generation input changed', 409);
    const request = imageGenerationRequestSchema.parse(
      generation.settings.request,
    ) as ImageGenerationRequest;
    this.generations.markRunning(generation.id);
    let stagingPath: string | null = null;
    try {
      const output = await this.provider.generate(request, signal);
      if (output.images.length !== 1)
        throw new AppError(
          'OUTPUT_INVALID',
          'Reference generation returned an unexpected image count',
          422,
        );
      stagingPath = output.images[0]!.stagingPath;
      const validated = await validateImageFile(this.context.media, stagingPath);
      const destination = safeWorkspacePath(
        this.context.workspace.root,
        `projects/${generation.projectId}/images/references/${safeSegment(generation.targetKind)}/${safeSegment(generation.targetEntityId)}/${generation.id}.png`,
      );
      await prepareProjectDirectories(this.context.workspace, generation.projectId);
      await promoteFile(stagingPath, destination);
      stagingPath = null;
      const file = await sha256File(destination);
      const assetId = randomUUID();
      this.assets.register({
        id: assetId,
        projectId: generation.projectId,
        type:
          generation.targetKind === 'CHARACTER_PROTOTYPE'
            ? 'CHARACTER_PROTOTYPE_REFERENCE'
            : generation.targetKind === 'CHARACTER_STAGE'
              ? 'CHARACTER_STAGE_REFERENCE'
              : 'LOCATION_REFERENCE',
        role: `visual-reference:${generation.targetKind}:${generation.targetEntityId}:${generation.targetRevision}:${generation.id}`,
        path: relativeAssetPath(this.context.workspace.root, destination),
        mediaType: validated.mediaType,
        bytes: file.bytes,
        sha256: file.hash,
        sourceEntityId: generation.targetEntityId,
        sourceStepId: step.id,
        inputFingerprint: generation.inputFingerprint,
        metadata: {
          approval: 'CANDIDATE',
          targetKind: generation.targetKind,
          targetRevision: generation.targetRevision,
          sourcePrototypeAssetId: generation.sourcePrototypeAssetId,
          sourcePrototypeSha256: generation.sourcePrototypeSha256,
          provider: output.provider,
          providerJobId: output.providerJobId,
          seed: output.seed,
          durationMs: output.durationMs,
        },
      });
      this.generations.complete(generation.id, assetId, file.hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Visual reference generation failed';
      if (signal?.aborted) this.generations.fail(generation.id, 'CANCELLED', message);
      else if (
        error instanceof AppError &&
        error.retryable &&
        step.attemptNumber < step.max_attempts
      )
        this.generations.markRetryPending(generation.id, message);
      else this.generations.fail(generation.id, 'FAILED', message);
      throw error;
    } finally {
      if (stagingPath) await rm(stagingPath, { force: true });
    }
  }

  list(projectId: Id, kind: VisualReferenceTargetKind, entityId: string, limit = 50) {
    return this.generations.list(projectId, kind, entityId, limit);
  }

  review(
    projectId: Id,
    generationId: Id,
    approval: 'APPROVED' | 'REJECTED',
  ): VisualReferenceGeneration {
    const generation = this.generations.get(generationId);
    if (!generation || generation.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Visual reference generation not found', 404);
    return approval === 'APPROVED'
      ? this.generations.approve(generationId)
      : this.generations.reject(generationId);
  }
}
