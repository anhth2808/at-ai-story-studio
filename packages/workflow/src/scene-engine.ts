import { createHash, randomUUID } from 'node:crypto';
import {
  SceneRepository,
  StoryRepository,
  ChapterRepository,
  WorkflowRepository,
  VisualProfileRepository,
  type ClaimedStep,
  type DatabaseHandle,
  type ScenePersistenceInput,
} from '@studio/database';
import {
  AppError,
  aiUsageSchema,
  generationMetadataSchema,
  sceneGenerationRequestSchema,
  scenePromptRequestSchema,
  sceneRegenerationRequestSchema,
  type AiUsage,
  type GenerationMetadata,
  type Id,
  type SceneDto,
  type ScenePlanDto,
  type ScenePlanItem,
  type StoryBlueprint,
  type VisualStyleSettingsDto,
} from '@studio/shared';
import type { AiAgent, AiAgentProgress, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import {
  buildSceneGenerationContext,
  buildSceneRegenerationContext,
  type SceneGenerationContext,
} from './scene-context.js';
import {
  renderScenePlanningPrompt,
  renderScenePromptRefreshPrompt,
  renderSceneRegenerationPrompt,
  type StoryPrompt,
} from './story-prompts.js';
import {
  resolveSceneCharacters,
  sceneContinuityWarnings,
  validateScenePlanningOutput,
  validateScenePromptOutput,
  validateSceneRegenerationOutput,
} from './scene-validation.js';
import {
  resolveFutureCharacterIdentity,
  type FutureIdentityContextItem,
  type FutureIdentityReference,
} from './future-character-resolution.js';

export type SceneEngineProgress = AiAgentProgress;
const SCENE_GENERATION_DEADLINE_MS = 300_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Scene generation failed';
}

export type SceneEngineContext = {
  database: DatabaseHandle;
  agent: AiAgent;
};
export class SceneEngine {
  readonly story: StoryRepository;
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly workflow: WorkflowRepository;
  readonly visualProfiles: VisualProfileRepository;

  constructor(private readonly context: SceneEngineContext) {
    this.story = new StoryRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
    this.visualProfiles = new VisualProfileRepository(context.database);
  }

  async generateScenes(
    projectId: Id,
    chapterId: Id,
    requestInput: unknown = {},
    signal?: AbortSignal,
    onProgress?: SceneEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<ScenePlanDto> {
    const request = sceneGenerationRequestSchema.parse(requestInput);
    const chapter = this.chapters.get(chapterId);
    if (!chapter || chapter.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    if (
      request.expectedChapterRevision !== undefined &&
      request.expectedChapterRevision !== chapter.revision
    )
      throw new AppError('REVISION_CONFLICT', 'Chapter revision is stale', 409);
    const style = this.scenes.getVisualStyle(projectId);
    const context = buildSceneGenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      chapterId,
      density: request.density,
      targetRange: request.targetRange,
      style,
    });
    const prompt = renderScenePlanningPrompt(
      context,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    if (workflowStepId)
      this.workflow.updateRunningStepFingerprint(
        this.workflowStep(workflowStepId),
        prompt.inputFingerprint,
      );
    const recovered = workflowStepId
      ? this.scenes.getCompletedPlanForWorkflow(
          projectId,
          chapterId,
          workflowStepId,
          prompt.inputFingerprint,
        )
      : null;
    if (recovered) return recovered;
    return (await this.run(
      projectId,
      chapterId,
      prompt,
      context,
      signal,
      onProgress,
      workflowStepId,
      async (result, metadata, generationId) => {
        const current = this.chapters.get(chapterId);
        if (!current || current.revision !== chapter.revision)
          throw new AppError('STALE_INPUT', 'Chapter changed during scene planning', 409);
        const items = validateScenePlanningOutput(result.text, current.content.length);
        const blueprint = this.story.getBlueprint(projectId)?.blueprint ?? null;
        const identityContext = this.futureIdentityContext(projectId, current.number);
        const scenes = items.map((item) =>
          this.toPersistenceInput(
            item,
            projectId,
            prompt,
            blueprint,
            style,
            undefined,
            identityContext,
          ),
        );
        const committedMetadata = this.metadataWithContext(metadata, context);
        return this.scenes.saveGeneratedPlan({
          projectId,
          chapterId,
          chapterRevision: chapter.revision,
          density: request.density,
          targetRange: request.targetRange,
          styleRevisionId: style?.id ?? null,
          generationId,
          inputFingerprint: prompt.inputFingerprint,
          metadata: committedMetadata,
          scenes,
          usage: this.usageFor(projectId, prompt.operation, chapterId, committedMetadata, result),
        });
      },
    )) as ScenePlanDto;
  }

  async regenerateScene(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
    signal?: AbortSignal,
    onProgress?: SceneEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<SceneDto> {
    const request = sceneRegenerationRequestSchema.parse(requestInput);
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    this.assertSceneCurrent(scene);
    const style = this.scenes.getVisualStyle(projectId);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style,
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderSceneRegenerationPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    if (workflowStepId)
      this.workflow.updateRunningStepFingerprint(
        this.workflowStep(workflowStepId),
        prompt.inputFingerprint,
      );
    const recovered = workflowStepId
      ? this.scenes.getCompletedSceneForWorkflow(
          projectId,
          sceneId,
          workflowStepId,
          prompt.inputFingerprint,
        )
      : null;
    if (recovered) return recovered;
    return (await this.run(
      projectId,
      sceneId,
      prompt,
      context,
      signal,
      onProgress,
      workflowStepId,
      async (result, metadata, generationId) => {
        const current = this.scenes.getScene(sceneId, true);
        if (!current || current.revision !== scene.revision)
          throw new AppError('STALE_INPUT', 'Scene changed during regeneration', 409);
        const item = validateSceneRegenerationOutput(
          result.text,
          context.chapter.text.length,
          scene,
        );
        const blueprint = this.story.getBlueprint(projectId)?.blueprint ?? null;
        const identityContext = this.futureIdentityContext(projectId, context.chapter.number);
        const persistence = this.toPersistenceInput(
          item,
          projectId,
          prompt,
          blueprint,
          style,
          scene,
          identityContext,
        );
        persistence.continuityNotes = [
          item.continuityNotes,
          ...sceneContinuityWarnings(item, scene),
        ]
          .filter(Boolean)
          .join('\n');
        const committedMetadata = this.metadataWithContext(metadata, context);
        return this.scenes.saveRegeneratedScene({
          ...persistence,
          sceneId,
          projectId,
          chapterId: scene.chapterId,
          chapterRevision: scene.chapterRevision,
          scenePlanRevisionId: scene.scenePlanRevisionId,
          generationId,
          metadata: committedMetadata,
          usage: this.usageFor(projectId, prompt.operation, sceneId, committedMetadata, result),
        });
      },
    )) as SceneDto;
  }

  async refreshScenePrompt(
    projectId: Id,
    sceneId: Id,
    requestInput: unknown = {},
    signal?: AbortSignal,
    onProgress?: SceneEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<SceneDto> {
    const request = scenePromptRequestSchema.parse(requestInput);
    const scene = this.scenes.getScene(sceneId, true);
    if (!scene || scene.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Scene not found', 404);
    if (request.expectedRevision !== undefined && request.expectedRevision !== scene.revision)
      throw new AppError('REVISION_CONFLICT', 'Scene revision is stale', 409);
    this.assertSceneCurrent(scene);
    const style = this.scenes.getVisualStyle(projectId);
    const context = buildSceneRegenerationContext({
      story: this.story,
      chapters: this.chapters,
      scenes: this.scenes,
      projectId,
      sceneId,
      style,
      instructions: request.instructions ? [request.instructions] : [],
    });
    const prompt = renderScenePromptRefreshPrompt(
      context,
      scene,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    if (workflowStepId)
      this.workflow.updateRunningStepFingerprint(
        this.workflowStep(workflowStepId),
        prompt.inputFingerprint,
      );
    const recovered = workflowStepId
      ? this.scenes.getCompletedPromptForWorkflow(
          projectId,
          sceneId,
          workflowStepId,
          prompt.inputFingerprint,
        )
      : null;
    if (recovered) return recovered;
    return (await this.run(
      projectId,
      sceneId,
      prompt,
      context,
      signal,
      onProgress,
      workflowStepId,
      async (result, metadata, generationId) => {
        const current = this.scenes.getScene(sceneId, true);
        if (!current || current.revision !== scene.revision)
          throw new AppError('STALE_INPUT', 'Scene changed during prompt refresh', 409);
        const output = validateScenePromptOutput(result.text);
        const committedMetadata = this.metadataWithContext(metadata, context);
        return this.scenes.savePromptRefresh({
          sceneId,
          imagePrompt: output.imagePrompt,
          negativePrompt: output.negativePrompt,
          styleRevisionId: style?.id ?? null,
          inputFingerprint: prompt.inputFingerprint,
          promptVersion: prompt.promptVersion,
          schemaVersion: prompt.schemaVersion,
          generationId,
          metadata: committedMetadata,
          usage: this.usageFor(projectId, prompt.operation, sceneId, committedMetadata, result),
        });
      },
    )) as SceneDto;
  }

  async executeStep(
    step: ClaimedStep,
    signal?: AbortSignal,
    onProgress?: SceneEngineProgress,
  ): Promise<void> {
    if (step.type === 'GENERATE_SCENES') {
      const chapter = this.chapters.get(step.entity_id);
      if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
      await this.generateScenes(
        chapter.projectId,
        chapter.id,
        this.parseStepPayload(step, sceneGenerationRequestSchema),
        signal,
        onProgress,
        step.id,
      );
      return;
    }
    if (step.type === 'REGENERATE_SCENE' || step.type === 'GENERATE_SCENE_PROMPT') {
      const scene = this.scenes.getScene(step.entity_id, true);
      if (!scene) throw new AppError('NOT_FOUND', 'Scene not found', 404);
      if (step.type === 'REGENERATE_SCENE') {
        await this.regenerateScene(
          scene.projectId,
          scene.id,
          this.parseStepPayload(step, sceneRegenerationRequestSchema),
          signal,
          onProgress,
          step.id,
        );
      } else {
        await this.refreshScenePrompt(
          scene.projectId,
          scene.id,
          this.parseStepPayload(step, scenePromptRequestSchema),
          signal,
          onProgress,
          step.id,
        );
      }
      return;
    }
    throw new AppError(
      'UNSUPPORTED_WORKFLOW_STEP',
      `Unsupported Scene Engine step: ${step.type}`,
      400,
    );
  }

  private async run(
    projectId: Id,
    targetId: string,
    prompt: StoryPrompt,
    context: SceneGenerationContext,
    signal: AbortSignal | undefined,
    onProgress: SceneEngineProgress | undefined,
    workflowStepId: Id | null,
    commit: (
      result: AiAgentResult,
      metadata: GenerationMetadata,
      generationId: Id,
    ) => Promise<unknown>,
  ): Promise<unknown> {
    this.assertGenerationGuardrails(projectId, prompt);
    const settings = this.story.getSettings(projectId);
    const maxAttempts = (settings?.generation.maxRetries ?? 3) + 1;
    let lastError: AppError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      const initial = this.initialMetadata(prompt, startedAt, attempt, context);
      const generationId = this.story.createGenerationRecord(
        projectId,
        prompt.operation,
        targetId,
        workflowStepId,
        prompt.inputFingerprint,
        initial,
        'RUNNING',
      );
      const request: AiAgentRequest = {
        operation: prompt.operation,
        model: settings?.generation.model ?? null,
        promptVersion: prompt.promptVersion,
        schemaVersion: prompt.schemaVersion,
        inputFingerprint: prompt.inputFingerprint,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        deadlineMs: SCENE_GENERATION_DEADLINE_MS,
      };
      let result: AiAgentResult | undefined;
      try {
        result = await this.context.agent.generate(request, signal, onProgress);
        const metadata = this.completedMetadata(prompt, startedAt, result, attempt, context);
        return await commit(result, metadata, generationId);
      } catch (error) {
        const classified = this.classifyGenerationError(error, signal);
        lastError = classified;
        const failedMetadata = generationMetadataSchema.parse({
          ...initial,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - Date.parse(startedAt),
        });
        this.story.updateGenerationRecord(
          generationId,
          classified.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          failedMetadata,
          classified.message,
        );
        this.story.saveUsage({
          projectId,
          operation: prompt.operation,
          entityId: targetId,
          attempt,
          provider: result?.provider ?? null,
          model: result?.model ?? null,
          inputTokens: result?.inputTokens ?? null,
          outputTokens: result?.outputTokens ?? null,
          durationMs: result?.durationMs ?? failedMetadata.durationMs,
          costUsd: result?.costUsd ?? null,
          currency: result?.costCurrency ?? null,
          status: classified.code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        });
        if (!this.shouldRetry(classified, attempt, maxAttempts)) throw classified;
      }
    }
    throw lastError ?? new AppError('INFRASTRUCTURE_ERROR', 'Scene generation failed', 502, true);
  }

  private initialMetadata(
    prompt: StoryPrompt,
    startedAt: string,
    attempt: number,
    context: SceneGenerationContext,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
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
      attempt,
      contextHash: prompt.inputFingerprint,
      omittedContext: context.omittedContext.map((item) => item.id),
    });
  }

  private completedMetadata(
    prompt: StoryPrompt,
    startedAt: string,
    result: AiAgentResult,
    attempt: number,
    context: SceneGenerationContext,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      operation: prompt.operation,
      inputFingerprint: prompt.inputFingerprint,
      provider: result.provider,
      model: result.model,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      costCurrency: result.costCurrency ?? null,
      finishReason: result.finishReason ?? null,
      attempt,
      contextHash: prompt.inputFingerprint,
      omittedContext: context.omittedContext.map((item) => item.id),
    });
  }

  private metadataWithContext(
    metadata: GenerationMetadata,
    context: SceneGenerationContext,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      ...metadata,
      omittedContext: context.omittedContext.map((item) => item.id).slice(0, 100),
      contextDiagnostics: {
        selectedContext: context.selectedContext,
        omittedContext: context.omittedContext,
        estimatedTokens: context.estimatedTokens,
      },
      sourceRevisions: [`chapter:${context.chapter.id}:${context.chapter.revision}`],
    });
  }

  private usageFor(
    projectId: Id,
    operation: GenerationMetadata['operation'],
    entityId: string,
    metadata: GenerationMetadata,
    result: AiAgentResult,
  ): Omit<AiUsage, 'id' | 'createdAt'> {
    const value = aiUsageSchema.parse({
      id: randomUUID(),
      projectId,
      operation,
      entityId,
      attempt: metadata.attempt,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      currency: result.costCurrency ?? null,
      status: 'SUCCEEDED',
      createdAt: metadata.completedAt ?? new Date().toISOString(),
    });
    const { id, createdAt, ...usage } = value;
    void id;
    void createdAt;
    return usage;
  }

  private assertGenerationGuardrails(projectId: Id, prompt: StoryPrompt): void {
    const generation = this.story.getSettings(projectId)?.generation;
    const estimatedTokens = Math.ceil((prompt.systemPrompt.length + prompt.userPrompt.length) / 4);
    if (
      generation?.maxEstimatedTokensPerOperation !== undefined &&
      generation.maxEstimatedTokensPerOperation !== null &&
      estimatedTokens > generation.maxEstimatedTokensPerOperation
    )
      throw new AppError(
        'BUDGET_ERROR',
        `Estimated generation input exceeds the configured token limit (${generation.maxEstimatedTokensPerOperation})`,
        409,
      );
    if (generation?.budgetUsd !== undefined && generation.budgetUsd !== null) {
      if (this.story.getUsageSummary(projectId).knownCostUsd >= generation.budgetUsd)
        throw new AppError('BUDGET_ERROR', 'Configured project budget has been reached', 409);
    }
  }

  private classifyGenerationError(error: unknown, signal?: AbortSignal): AppError {
    if (signal?.aborted)
      return new AppError('CANCELLED', 'Scene generation was cancelled', 409, false);
    if (error instanceof AppError) {
      if (error.code === 'SCENE_OUTPUT_INVALID')
        return new AppError('STRUCTURED_OUTPUT_ERROR', error.message, 422, true);
      return error;
    }
    const message = errorMessage(error);
    if (error instanceof Error && (error.name === 'ZodError' || message.includes('must be JSON')))
      return new AppError('STRUCTURED_OUTPUT_ERROR', message, 422, true);
    return new AppError('INFRASTRUCTURE_ERROR', message, 502, true);
  }

  private shouldRetry(error: AppError, attempt: number, maxAttempts: number): boolean {
    if (!error.retryable || attempt >= maxAttempts) return false;
    if (error.code === 'BUDGET_ERROR' || error.code === 'CANCELLED' || error.code === 'STALE_INPUT')
      return false;
    if (error.code === 'STRUCTURED_OUTPUT_ERROR') return attempt < Math.min(maxAttempts, 3);
    return [
      'PROVIDER_ERROR',
      'HOST_ERROR',
      'INFRASTRUCTURE_ERROR',
      'PROTOCOL_ERROR',
      'TIMEOUT',
    ].includes(error.code);
  }

  private assertSceneCurrent(scene: SceneDto): void {
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
        'Scene plan is stale; regenerate the chapter scene plan before this operation',
        409,
      );
  }
  private futureIdentityContext(
    projectId: Id,
    currentChapterNumber: number,
  ): FutureIdentityContextItem[] {
    const bounded = (value: string): string => value.trim().slice(0, 4_000);
    const planWindows = this.story.getPlanWindows(projectId).flatMap((window) =>
      window.items
        .filter((item) => item.chapterNumber > currentChapterNumber)
        .map((item) => ({
          source: 'PLAN_WINDOW' as const,
          reference: `plan-window:${window.window.id}:${item.chapterNumber}`,
          text: bounded(
            `${item.title}. ${item.summary}. ${item.purpose}. ${item.turningPoints.join('. ')}`,
          ),
          characterIds: item.characterIds,
        })),
    );
    const futureChapters = this.context.database.sqlite
      .prepare(
        `SELECT id,number,title,revision,substr(content,1,4000) as content
         FROM chapters WHERE project_id=? AND number>? ORDER BY number LIMIT 12`,
      )
      .all(projectId, currentChapterNumber) as Array<{
      id: Id;
      number: number;
      title: string;
      revision: number;
      content: string;
    }>;
    const futureChapterIds = new Set(futureChapters.map((chapter) => chapter.id));
    const summaries = this.story
      .getSummaries(projectId, 200, 0)
      .filter((summary) => futureChapterIds.has(summary.chapterId))
      .map((summary) => ({
        source: 'CHAPTER_SUMMARY' as const,
        reference: `chapter-summary:${summary.chapterId}:${summary.revision}`,
        text: bounded(
          [
            summary.summary.recap,
            ...summary.summary.keyFacts,
            ...summary.summary.newInformation,
            ...summary.summary.characterStateChanges.map((change) => change.change),
          ].join('. '),
        ),
        characterIds: summary.summary.characterStateChanges.map((change) => change.characterId),
      }));
    return [
      ...planWindows.slice(0, 12),
      ...summaries.slice(0, 12),
      ...futureChapters.map((chapter) => ({
        source: 'FUTURE_CHAPTER' as const,
        reference: `chapter:${chapter.id}:${chapter.revision}`,
        text: bounded(`${chapter.title}. ${chapter.content}`),
      })),
    ];
  }

  private futureIdentityReferences(
    projectId: Id,
    blueprint: StoryBlueprint | null,
  ): Record<string, FutureIdentityReference> {
    if (!blueprint) return {};
    return Object.fromEntries(
      blueprint.characters.map((character) => {
        const profile = this.visualProfiles.getCharacter(projectId, character.id);
        return [
          character.id,
          {
            voiceId: character.voiceId,
            referenceAssetIds:
              profile?.status === 'APPROVED' ? profile.payload.referenceAssetIds : [],
          },
        ];
      }),
    );
  }

  private toPersistenceInput(
    item: ScenePlanItem,
    projectId: Id,
    prompt: StoryPrompt,
    blueprint: StoryBlueprint | null,
    style: VisualStyleSettingsDto | null,
    currentScene?: SceneDto,
    identityContext: FutureIdentityContextItem[] = [],
  ): ScenePersistenceInput {
    const resolved = resolveSceneCharacters(item, blueprint);
    const location = this.scenes.resolveLocation(projectId, item.location);
    const references = this.futureIdentityReferences(projectId, blueprint);
    const characters = resolved.characters.map((character) => {
      if (character.characterId !== null) return { ...character, identityResolution: null };
      const identityResolution = resolveFutureCharacterIdentity({
        alias: character.displayName,
        blueprint,
        context: identityContext,
        references,
      });
      if (identityResolution.status === 'RESOLVED' && identityResolution.characterId) {
        const canonical = blueprint?.characters.find(
          (candidate) => candidate.id === identityResolution.characterId,
        );
        return {
          ...character,
          characterId: identityResolution.characterId,
          resolutionStatus: 'RESOLVED' as const,
          dependencyFingerprint: canonical
            ? createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
            : null,
          identityResolution,
        };
      }
      return { ...character, identityResolution };
    });
    const resolvedAliases = new Set(
      characters.flatMap((character) =>
        character.identityResolution?.status === 'RESOLVED'
          ? [character.identityResolution.alias]
          : [],
      ),
    );
    const unresolvedReferences = [...resolved.unresolvedReferences];
    if (
      location.ambiguousIds.length ||
      location.createdDraft ||
      (item.location && !location.locationId)
    )
      unresolvedReferences.push(`location:${item.location ?? ''}`);
    const uniqueReferences = [
      ...new Set(
        unresolvedReferences.filter(
          (reference) => !resolvedAliases.has(reference) && !resolvedAliases.has(reference.trim()),
        ),
      ),
    ];
    const identityByAlias = new Map(
      characters.flatMap((character) =>
        character.identityResolution?.status === 'RESOLVED' && character.characterId
          ? [
              [
                character.displayName.normalize('NFKC').toLocaleLowerCase('en-US'),
                character.characterId,
              ] as const,
            ]
          : [],
      ),
    );
    const composition = {
      ...item.composition,
      characterPositions: item.composition.characterPositions.map((position) => ({
        ...position,
        characterId:
          position.characterId ??
          identityByAlias.get(position.displayName.normalize('NFKC').toLocaleLowerCase('en-US')) ??
          null,
      })),
    };
    return {
      ...item,
      composition,
      characters,
      locationId: location.locationId,
      unresolvedReferences: uniqueReferences,
      styleRevisionId: style?.id ?? null,
      inputFingerprint: prompt.inputFingerprint,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
      status: 'CURRENT',
      promptStatus: item.imagePrompt.trim() ? 'CURRENT' : 'MISSING',
      ...(currentScene ? { stableId: currentScene.stableId } : {}),
    };
  }

  private workflowStep(stepId: Id): ClaimedStep {
    const step = this.workflow.getStep(stepId);
    if (!step) throw new AppError('NOT_FOUND', 'Workflow step not found', 404);
    return {
      ...step,
      attemptId: step.current_attempt_id ?? '',
      attemptNumber: step.attempts,
    };
  }

  private parseStepPayload<T>(step: ClaimedStep, schema: { parse(value: unknown): T }): T {
    try {
      return schema.parse(JSON.parse(step.payload || '{}'));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_WORKFLOW_STEP', 'Scene workflow payload is invalid', 400);
    }
  }
}
