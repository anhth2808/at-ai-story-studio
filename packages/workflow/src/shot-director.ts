import {
  ChapterRepository,
  SceneRepository,
  ShotPlanRepository,
  StoryRepository,
  type ClaimedStep,
  type DatabaseHandle,
} from '@studio/database';
import {
  AppError,
  generationMetadataSchema,
  shotPlanCandidateSchema,
  shotPlanningRequestSchema,
  type Id,
  type ShotPlanDto,
} from '@studio/shared';
import type { AiAgent, AiAgentProgress } from './omp-agent.js';
import { canonicalizeShotPlan, renderShotPlanningPrompt } from './shot-prompts.js';
import { validateShotPlan } from './shot-validation.js';

const DEADLINE_MS = 300_000;

export type ShotDirectorContext = { database: DatabaseHandle; agent: AiAgent };

export class ShotDirector {
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly plans: ShotPlanRepository;
  readonly story: StoryRepository;

  constructor(private readonly context: ShotDirectorContext) {
    this.chapters = new ChapterRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.plans = new ShotPlanRepository(context.database);
    this.story = new StoryRepository(context.database);
  }

  async planScene(
    projectId: Id,
    sceneRevisionId: Id,
    requestInput: unknown = {},
    signal?: AbortSignal,
    onProgress?: AiAgentProgress,
    workflowStepId: Id | null = null,
  ): Promise<ShotPlanDto> {
    const request = shotPlanningRequestSchema.parse(requestInput);
    const scene = this.scenes.getScene(sceneRevisionId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    this.assertCurrent(scene.id, scene.chapterId, scene.chapterRevision);
    if (
      request.expectedSceneRevision !== undefined &&
      request.expectedSceneRevision !== scene.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    const chapterScenes = this.scenes.listScenes(scene.chapterId, 200, 0, false);
    const sceneIndex = chapterScenes.findIndex((entry) => entry.id === scene.id);
    const previous = sceneIndex > 0 ? chapterScenes[sceneIndex - 1] : undefined;
    const next = sceneIndex >= 0 ? chapterScenes[sceneIndex + 1] : undefined;
    const previousPlan = previous ? this.plans.getCurrent(projectId, previous.id) : null;
    const context = {
      scene,
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
    };
    const prompt = renderShotPlanningPrompt(context);
    const startedAt = new Date().toISOString();
    const initialMetadata = generationMetadataSchema.parse({
      operation: prompt.operation,
      inputFingerprint: prompt.inputFingerprint,
      provider: null,
      model: null,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
      startedAt,
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costCurrency: null,
      finishReason: null,
      attempt: 1,
      contextHash: prompt.inputFingerprint,
      omittedContext: ['full-novel', 'unrelated-scenes', 'pixel-generation'],
      sourceRevisions: [`scene:${scene.stableId}:${scene.revision}`],
    });
    const generationId = this.story.createGenerationRecord(
      projectId,
      prompt.operation,
      scene.stableId,
      workflowStepId,
      prompt.inputFingerprint,
      initialMetadata,
      'RUNNING',
    );
    try {
      const result = await this.context.agent.generate(
        {
          operation: prompt.operation,
          model: this.story.getSettings(projectId)?.generation.model ?? null,
          promptVersion: prompt.promptVersion,
          schemaVersion: prompt.schemaVersion,
          inputFingerprint: prompt.inputFingerprint,
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          deadlineMs: DEADLINE_MS,
        },
        signal,
        onProgress,
      );
      this.assertCurrent(scene.id, scene.chapterId, scene.chapterRevision);
      const parsed = shotPlanCandidateSchema.parse(JSON.parse(result.text));
      const canonical = canonicalizeShotPlan(parsed, prompt.inputFingerprint);
      const validated = validateShotPlan(canonical, scene);
      const completedAt = new Date().toISOString();
      const metadata = generationMetadataSchema.parse({
        ...initialMetadata,
        provider: result.provider,
        model: result.model,
        completedAt,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        costCurrency: result.costCurrency ?? null,
        finishReason: result.finishReason ?? null,
      });
      const saved = this.plans.saveCurrent({
        stableId: `shot-plan-${scene.stableId}`,
        projectId,
        chapterId: scene.chapterId,
        sceneId: scene.stableId,
        sceneRevisionId: scene.id,
        templateVersion: prompt.promptVersion,
        schemaVersion: prompt.schemaVersion,
        inputFingerprint: prompt.inputFingerprint,
        generationId,
        candidate: validated.candidate,
        issues: validated.issues,
      });
      this.story.updateGenerationRecord(generationId, 'COMPLETED', metadata);
      this.story.saveUsage({
        projectId,
        operation: prompt.operation,
        entityId: scene.stableId,
        attempt: 1,
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        currency: result.costCurrency ?? null,
        status: 'SUCCEEDED',
      });
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shot planning failed';
      this.story.updateGenerationRecord(
        generationId,
        signal?.aborted ? 'CANCELLED' : 'FAILED',
        initialMetadata,
        message,
      );
      throw error instanceof AppError
        ? error
        : new AppError('STRUCTURED_OUTPUT_ERROR', message, 422, true);
    }
  }

  async executeStep(
    step: ClaimedStep,
    signal?: AbortSignal,
    onProgress?: AiAgentProgress,
  ): Promise<void> {
    if (step.type !== 'PLAN_SHOTS')
      throw new AppError(
        'UNSUPPORTED_WORKFLOW_STEP',
        `Unsupported Shot Director step: ${step.type}`,
        400,
      );
    const scene = this.scenes.getScene(step.entity_id);
    if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
    let payload: unknown;
    try {
      payload = JSON.parse(step.payload || '{}');
    } catch {
      throw new AppError('INVALID_WORKFLOW_STEP', 'Shot planning payload is invalid', 400);
    }
    await this.planScene(scene.projectId, scene.id, payload, signal, onProgress, step.id);
  }

  private assertCurrent(sceneRevisionId: Id, chapterId: Id, chapterRevision: number): void {
    const scene = this.scenes.getScene(sceneRevisionId);
    const chapter = this.chapters.get(chapterId);
    const plan = this.scenes.getScenePlan(chapterId);
    if (
      !scene ||
      !chapter ||
      scene.status !== 'CURRENT' ||
      !plan ||
      plan.status !== 'CURRENT' ||
      chapter.revision !== chapterRevision
    )
      throw new AppError('STALE_INPUT', 'Scene changed during Shot planning', 409);
  }
}

export function createShotDirector(context: ShotDirectorContext): ShotDirector {
  return new ShotDirector(context);
}
