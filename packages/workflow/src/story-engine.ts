import { randomUUID } from 'node:crypto';
import {
  StoryBatchRepository,
  StoryRepository,
  SceneRepository,
  ChapterRepository,
  WorkflowRepository,
  type ClaimedStep,
  type DatabaseHandle,
} from '@studio/database';
import {
  AppError,
  aiUsageSchema,
  chapterGenerationEnvelopeSchema,
  chapterGenerationV2EnvelopeSchema,
  chapterPlanItemSchema,
  continuityCheckResultSchema,
  generationMetadataSchema,
  manualChapterAnalysisSchema,
  parseStoryOperationOutput,
  storyArcPlanSchema,
  storyBlueprintSchema,
  storyPlanWindowResultSchema,
  storySettingsSchema,
  type ChapterGenerationEnvelope,
  type ChapterGenerationV2Envelope,
  type ChapterPlanItem,
  type ChapterDto,
  type ChapterSummary,
  type ContinuityCheckResult,
  type GenerationMetadata,
  type GenerationOperation,
  type Id,
  type ManualChapterAnalysis,
  type StoryArc,
  type StoryBlueprint,
  type StoryBlueprintDto,
  type StoryPlanDto,
  type StoryPlanWindowResult,
  type StorySettingsDto,
  type StoryState,
  type StoryStateDelta,
} from '@studio/shared';
import type { AiAgent, AiAgentProgress, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import {
  compileGenerationContext,
  compileGenerationContextV2,
  type BoundedGenerationContext,
} from './story-context.js';
import {
  renderArcPlanningPrompt,
  renderBlueprintPrompt,
  renderChapterGenerationV2Prompt,
  renderChapterPlanWindowPrompt,
  renderChapterPlansPrompt,
  renderChapterPrompt,
  renderContinuityCheckPrompt,
  renderStateAnalysisPrompt,
  renderSummaryCompactionPrompt,
  renderSummaryPrompt,
  type StoryPrompt,
} from './story-prompts.js';
import { reduceStoryState } from './story-state.js';

export type StoryEngineProgress = AiAgentProgress;

export type StoryEngineContext = {
  database: DatabaseHandle;
  agent: AiAgent;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Story generation failed';
}
export function planWindowBoundary(window: StoryPlanWindowResult | null): string | null {
  if (!window) return null;
  return window.items
    .slice(-3)
    .map((item) => `Chapter ${item.chapterNumber}: ${item.summary}`)
    .join('\n')
    .slice(0, 4_000);
}

export function buildChapterGenerationContext(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  projectId: Id,
  planItem: ChapterPlanItem,
  instructions: string[] = [],
): BoundedGenerationContext {
  const blueprint = story.getBlueprint(projectId)?.blueprint ?? null;
  const chapters = chaptersRepository.listMetadata(projectId);
  const summaries = story.getSummaries(projectId).flatMap((summary) => {
    const chapter = chapters.find((item) => item.id === summary.chapterId);
    return chapter && chapter.number < planItem.chapterNumber
      ? [{ chapterNumber: chapter.number, revision: summary.revision, summary: summary.summary }]
      : [];
  });
  const summarizedChapterNumbers = new Set(summaries.map((summary) => summary.chapterNumber));
  const missingContext = chapters
    .filter(
      (chapter) =>
        chapter.number < planItem.chapterNumber && !summarizedChapterNumbers.has(chapter.number),
    )
    .map((chapter) => `summary:chapter-${chapter.number}`);
  const openThreads = story.getThreads(projectId).filter((thread) => thread.status === 'OPEN');
  return compileGenerationContext({
    blueprint,
    selectedCharacterIds: planItem.characterIds,
    planItem,
    priorSummaries: summaries,
    missingContext,
    openThreads,
    relevantFacts: blueprint?.continuityConstraints ?? [],
    instructions,
    budget: story.getSettings(projectId)?.generation.contextBudget ?? 5_000,
  });
}

export function buildChapterGenerationContextV2(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  projectId: Id,
  planItem: ChapterPlanItem,
  instructions: string[] = [],
  stateOverride?: StoryState,
): BoundedGenerationContext {
  const settings = story.getSettings(projectId);
  const blueprintRecord = story.getBlueprint(projectId);
  if (!settings || !blueprintRecord)
    throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
  const blueprint = blueprintRecord.blueprint;
  const state = stateOverride ?? story.getStoryState(projectId);
  const arc =
    story
      .getArcs(projectId)
      .find(
        (candidate) =>
          candidate.startChapter <= planItem.chapterNumber &&
          candidate.endChapter >= planItem.chapterNumber,
      ) ?? null;
  const summaries = story.getSummaryContext(projectId, planItem.chapterNumber, 6);
  const sourceRevisions = [
    `settings:${settings.revision}`,
    `blueprint:${blueprintRecord.revision}`,
    `state:${state.revision}`,
    `plan-item:${planItem.id}`,
    ...(arc ? [`arc:${arc.id}`] : []),
  ];
  return compileGenerationContextV2({
    blueprint,
    state,
    planItem,
    arc,
    priorSummaries: summaries,
    characterStates: state.characterStates,
    threads: state.threads,
    facts: state.importantFacts,
    events: state.recentEvents,
    instructions,
    budget: settings.generation.contextBudget,
    sourceRevisions,
  });
}

export function renderChapterGenerationPrompt(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  projectId: Id,
  planItem: ChapterPlanItem,
): StoryPrompt {
  return renderChapterPrompt(
    buildChapterGenerationContext(story, chaptersRepository, projectId, planItem),
    planItem,
    story.getSettings(projectId)?.generation.model ?? null,
  );
}

export function buildSummaryGenerationInput(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  chapterId: Id,
): { chapter: ChapterDto; context: BoundedGenerationContext; model: string | null } {
  const chapter = chaptersRepository.get(chapterId);
  if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
  const blueprint = story.getBlueprint(chapter.projectId)?.blueprint ?? null;
  const planItem = chapter.storyPlanItemId
    ? (story.getPlanItem(chapter.projectId, chapter.storyPlanItemId)?.item ?? null)
    : null;
  const context = compileGenerationContext({
    blueprint,
    selectedCharacterIds: planItem?.characterIds ?? [],
    planItem,
    priorSummaries: [],
    openThreads: story.getThreads(chapter.projectId).filter((thread) => thread.status === 'OPEN'),
    relevantFacts: blueprint?.continuityConstraints ?? [],
    instructions: ['Summarize only the supplied chapter content.'],
    budget: story.getSettings(chapter.projectId)?.generation.contextBudget ?? 5_000,
  });
  return {
    chapter,
    context,
    model: story.getSettings(chapter.projectId)?.generation.model ?? null,
  };
}

export function renderSummaryGenerationPrompt(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  chapterId: Id,
): StoryPrompt {
  const { chapter, context, model } = buildSummaryGenerationInput(
    story,
    chaptersRepository,
    chapterId,
  );
  return renderSummaryPrompt(
    context,
    { title: chapter.title, content: chapter.content, revision: chapter.revision },
    model,
  );
}
export class StoryEngine {
  readonly story: StoryRepository;
  readonly chapters: ChapterRepository;
  readonly scenes: SceneRepository;
  readonly batches: StoryBatchRepository;
  readonly workflow: WorkflowRepository;
  constructor(private readonly context: StoryEngineContext) {
    this.story = new StoryRepository(context.database);
    this.scenes = new SceneRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.batches = new StoryBatchRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
  }
  private invalidateSceneWorkflow(projectId: Id, error: string): void {
    for (const chapter of this.chapters.listMetadata(projectId)) {
      this.workflow.invalidateSteps(chapter.id, ['GENERATE_SCENES'], error);
    }
    const sceneIds = this.scenes.listProjectCurrentSceneIds(projectId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT'],
      error,
    );
  }
  private invalidateSceneWorkflowForChapter(chapterId: Id): void {
    const error = 'Story chapter changed';
    this.workflow.invalidateSteps(chapterId, ['GENERATE_SCENES'], error);
    const sceneIds = this.scenes.listCurrentSceneIds(chapterId);
    this.workflow.invalidateEntities(
      sceneIds,
      ['REGENERATE_SCENE', 'GENERATE_SCENE_PROMPT'],
      error,
    );
  }

  saveSettings(projectId: Id, input: unknown): StorySettingsDto {
    const settings = storySettingsSchema.parse(input);
    const saved = this.story.saveSettings(projectId, settings);
    this.story.invalidateScope({ projectId, kind: 'SETTINGS' });
    this.scenes.markProjectStale(projectId);
    this.invalidateSceneWorkflow(projectId, 'Story settings changed');
    return saved;
  }

  getSettings(projectId: Id): StorySettingsDto | null {
    return this.story.getSettings(projectId);
  }

  getBlueprint(projectId: Id) {
    return this.story.getBlueprint(projectId);
  }

  getPlan(projectId: Id, limit = 200, offset = 0): StoryPlanDto | null {
    return this.story.getPlan(projectId, limit, offset);
  }

  updateBlueprint(projectId: Id, input: unknown): StoryBlueprintDto {
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const settingsRevision = this.story.getSettingsRevision(projectId, settings.revision);
    if (!settingsRevision)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings revision is missing', 409);
    const blueprint = storyBlueprintSchema.parse(input);
    const saved = this.story.saveBlueprint(
      projectId,
      settingsRevision.id,
      blueprint,
      null,
      this.story.fingerprint({
        operation: 'MANUAL_BLUEPRINT',
        settingsRevision: settings.revision,
        blueprint,
      }),
    );
    this.story.invalidateScope({ projectId, kind: 'BLUEPRINT' });
    this.scenes.markProjectStale(projectId);
    this.invalidateSceneWorkflow(projectId, 'Story blueprint changed');
    return saved;
  }

  updatePlanItem(projectId: Id, planItemId: string, input: unknown): StoryPlanDto {
    const current = this.story.getPlan(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    const item = chapterPlanItemSchema.parse(input);
    if (!current || !blueprint)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Current blueprint and chapter plan are required',
        409,
      );
    if (item.id !== planItemId)
      throw new AppError('INVALID_PLAN', 'Plan item identifier cannot change', 400);
    const blueprintRevision = this.story.getBlueprintRevision(projectId, blueprint.revision);
    if (!blueprintRevision)
      throw new AppError('PREREQUISITE_MISSING', 'Blueprint revision is missing', 409);
    const plan = {
      items: current.plan.items.map((candidate) =>
        candidate.id === planItemId ? item : candidate,
      ),
    };
    const saved = this.story.savePlan(
      projectId,
      blueprintRevision.id,
      plan,
      null,
      this.story.fingerprint({
        operation: 'MANUAL_PLAN_ITEM',
        planRevision: current.revision,
        planItemId,
        item,
      }),
    );
    this.story.invalidateScope({ projectId, kind: 'PLAN_ITEM', stableId: planItemId });
    const chapter = this.chapters.getByPlanItem(projectId, planItemId);
    if (chapter) {
      this.scenes.markChapterStale(chapter.id);
      this.invalidateSceneWorkflowForChapter(chapter.id);
    }
    return saved;
  }

  private initialMetadata(
    operation: GenerationOperation,
    prompt: StoryPrompt,
    startedAt: string,
    attempt: number,
    contextHash: string | null,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      operation,
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
      attempt,
      contextHash,
      omittedContext: [],
    });
  }

  private completedMetadata(
    operation: GenerationOperation,
    prompt: StoryPrompt,
    startedAt: string,
    result: AiAgentResult,
    attempt: number,
    contextHash: string | null,
    omittedContext: string[] = [],
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      operation,
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
      contextHash,
      omittedContext: omittedContext.slice(0, 100),
    });
  }

  private metadataWithContext(
    metadata: GenerationMetadata,
    context: BoundedGenerationContext,
  ): GenerationMetadata {
    return generationMetadataSchema.parse({
      ...metadata,
      omittedContext: context.omittedContext.slice(0, 100),
      contextDiagnostics: context.diagnostics,
      sourceRevisions: context.sourceRevisions,
    });
  }

  private usageFor(
    projectId: Id,
    operation: GenerationOperation,
    entityId: string,
    metadata: GenerationMetadata,
    result: AiAgentResult,
  ) {
    return aiUsageSchema.parse({
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
  }

  private assertGenerationGuardrails(projectId: Id, prompt: StoryPrompt): void {
    const settings = this.story.getSettings(projectId);
    const generation = settings?.generation;
    const estimatedTokens = Math.ceil((prompt.systemPrompt.length + prompt.userPrompt.length) / 4);
    const maxEstimatedTokens = generation?.maxEstimatedTokensPerOperation;
    if (
      maxEstimatedTokens !== undefined &&
      maxEstimatedTokens !== null &&
      estimatedTokens > maxEstimatedTokens
    )
      throw new AppError(
        'BUDGET_ERROR',
        `Estimated generation input exceeds the configured token limit (${maxEstimatedTokens})`,
        409,
      );
    const budgetUsd = generation?.budgetUsd;
    if (budgetUsd !== undefined && budgetUsd !== null) {
      const usage = this.story.getUsageSummary(projectId);
      if (usage.knownCostUsd >= budgetUsd)
        throw new AppError('BUDGET_ERROR', 'Configured project budget has been reached', 409);
    }
  }

  private classifyGenerationError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const message = errorMessage(error);
    if (
      error instanceof Error &&
      (error.name === 'ZodError' ||
        message.includes('Story model output must be JSON') ||
        message.includes('must be JSON'))
    )
      return new AppError('STRUCTURED_OUTPUT_ERROR', message, 422, true);
    return new AppError('INFRASTRUCTURE_ERROR', message, 502, true);
  }

  private shouldRetryGeneration(error: AppError, attempt: number, maxAttempts: number): boolean {
    if (!error.retryable || attempt >= maxAttempts) return false;
    if (
      error.code === 'CONTINUITY_ERROR' ||
      error.code === 'BUDGET_ERROR' ||
      error.code === 'CANCELLED'
    )
      return false;
    if (error.code === 'STRUCTURED_OUTPUT_ERROR') return attempt < Math.min(maxAttempts, 3);
    return (
      error.code === 'PROVIDER_ERROR' ||
      error.code === 'HOST_ERROR' ||
      error.code === 'INFRASTRUCTURE_ERROR' ||
      error.code === 'PROTOCOL_ERROR' ||
      error.code === 'TIMEOUT'
    );
  }

  private async run(
    projectId: Id,
    targetId: string,
    prompt: StoryPrompt,
    signal: AbortSignal | undefined,
    onProgress: StoryEngineProgress | undefined,
    contextHash: string | null,
    workflowStepId: Id | null,
    commit: (result: AiAgentResult, metadata: GenerationMetadata, generationId: Id) => unknown,
  ): Promise<unknown> {
    this.assertGenerationGuardrails(projectId, prompt);
    const settings = this.story.getSettings(projectId);
    const maxAttempts = (settings?.generation.maxRetries ?? 3) + 1;
    let lastError: AppError | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = new Date().toISOString();
      const initial = this.initialMetadata(
        prompt.operation,
        prompt,
        startedAt,
        attempt,
        contextHash,
      );
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
        deadlineMs: 120_000,
      };
      let result: AiAgentResult | undefined;
      try {
        result = await this.context.agent.generate(request, signal, onProgress);
        const metadata = this.completedMetadata(
          prompt.operation,
          prompt,
          startedAt,
          result,
          attempt,
          contextHash,
        );
        const committed = await commit(result, metadata, generationId);
        if (prompt.operation !== 'CHAPTER_GENERATION_V2')
          this.story.saveUsage({
            projectId,
            operation: prompt.operation,
            entityId: targetId,
            attempt,
            provider: result.provider,
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            currency: result.costCurrency ?? null,
            status: 'SUCCEEDED',
          });
        this.story.updateGenerationRecord(generationId, 'COMPLETED', metadata);
        return committed;
      } catch (error) {
        const classified =
          signal?.aborted && !(error instanceof AppError && error.code === 'CANCELLED')
            ? new AppError('CANCELLED', 'Story generation was cancelled', 409, false)
            : this.classifyGenerationError(error);
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
        if (!this.shouldRetryGeneration(classified, attempt, maxAttempts)) throw classified;
      }
    }
    throw lastError ?? new AppError('INFRASTRUCTURE_ERROR', 'Story generation failed', 502, true);
  }

  async generateBlueprint(
    projectId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<StoryBlueprint> {
    const settings = this.story.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    const prompt = renderBlueprintPrompt(settings);
    const result = (await this.run(
      projectId,
      projectId,
      prompt,
      signal,
      onProgress,
      null,
      workflowStepId,
      async (result, metadata) => {
        const blueprint = parseStoryOperationOutput('BLUEPRINT', result.text) as StoryBlueprint;
        if (workflowStepId)
          this.workflow.assertRunningStepFingerprint(workflowStepId, prompt.inputFingerprint);
        const currentSettings = this.story.getSettings(projectId);
        if (currentSettings?.revision !== settings.revision)
          throw new AppError(
            'STALE_INPUT',
            'Story settings changed during blueprint generation',
            409,
          );
        const settingsRevision = this.story.getSettingsRevision(projectId, settings.revision);
        if (!settingsRevision)
          throw new AppError('PREREQUISITE_MISSING', 'Story settings revision is missing', 409);
        this.story.saveBlueprint(
          projectId,
          settingsRevision.id,
          blueprint,
          metadata,
          prompt.inputFingerprint,
        );
        return blueprint;
      },
    )) as StoryBlueprint;
    this.story.invalidateScope({
      projectId,
      kind: 'BLUEPRINT',
      excludeStepId: workflowStepId ?? undefined,
      excludeStepIds: workflowStepId ? this.workflow.dependentStepIds(workflowStepId) : [],
    });
    return result;
  }

  async generatePlans(
    projectId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<StoryPlanDto> {
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    if (settings.targetChapterCount > 20)
      throw new AppError(
        'INVALID_PLAN',
        'Stories over 20 chapters require arcs and bounded planning windows',
        422,
      );
    const prompt = renderChapterPlansPrompt(settings, blueprint.blueprint);
    const result = (await this.run(
      projectId,
      projectId,
      prompt,
      signal,
      onProgress,
      null,
      workflowStepId,
      async (result, metadata) => {
        const plan = parseStoryOperationOutput('CHAPTER_PLANS', result.text) as {
          items: ChapterPlanItem[];
        };
        if (workflowStepId)
          this.workflow.assertRunningStepFingerprint(workflowStepId, prompt.inputFingerprint);
        if (this.story.getSettings(projectId)?.revision !== settings.revision)
          throw new AppError('STALE_INPUT', 'Story settings changed during plan generation', 409);
        if (this.story.getBlueprint(projectId)?.revision !== blueprint.revision)
          throw new AppError('STALE_INPUT', 'Story blueprint changed during plan generation', 409);
        const blueprintRevision = this.story.getBlueprintRevision(projectId, blueprint.revision);
        if (!blueprintRevision)
          throw new AppError('PREREQUISITE_MISSING', 'Blueprint revision is missing', 409);
        return this.story.savePlan(
          projectId,
          blueprintRevision.id,
          plan,
          metadata,
          prompt.inputFingerprint,
        );
      },
    )) as StoryPlanDto;
    this.story.invalidateScope({
      projectId,
      kind: 'PLAN',
      excludeStepId: workflowStepId ?? undefined,
    });
    return result;
  }

  async generateArcs(
    projectId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<StoryArc[]> {
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId);
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    const prompt = renderArcPlanningPrompt(settings, blueprint.blueprint);
    const result = (await this.run(
      projectId,
      projectId,
      prompt,
      signal,
      onProgress,
      null,
      workflowStepId,
      async (agentResult, metadata) => {
        const arcPlan = storyArcPlanSchema.parse(
          parseStoryOperationOutput('ARC_PLANNING', agentResult.text),
        );
        if (workflowStepId)
          this.workflow.assertRunningStepFingerprint(workflowStepId, prompt.inputFingerprint);
        if (this.story.getSettings(projectId)?.revision !== settings.revision)
          throw new AppError('STALE_INPUT', 'Story settings changed during arc planning', 409);
        if (this.story.getBlueprint(projectId)?.revision !== blueprint.revision)
          throw new AppError('STALE_INPUT', 'Story blueprint changed during arc planning', 409);
        return this.story.saveArcs(
          projectId,
          blueprint.revision,
          arcPlan,
          metadata,
          prompt.inputFingerprint,
        );
      },
    )) as StoryArc[];
    this.story.invalidateScope({
      projectId,
      kind: 'PLAN',
      excludeStepId: workflowStepId ?? undefined,
    });
    return result;
  }

  async generatePlanWindow(
    projectId: Id,
    arcId: string,
    startChapter: number,
    endChapter: number,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<StoryPlanWindowResult> {
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
    return (await this.run(
      projectId,
      `${arcId}:${startChapter}-${endChapter}`,
      prompt,
      signal,
      onProgress,
      null,
      workflowStepId,
      async (agentResult) => {
        const windowResult = storyPlanWindowResultSchema.parse(
          parseStoryOperationOutput('CHAPTER_PLAN_WINDOW', agentResult.text),
        );
        if (
          windowResult.window.arcId !== arcId ||
          windowResult.window.startChapter !== startChapter ||
          windowResult.window.endChapter !== endChapter ||
          windowResult.window.sourceBlueprintRevision !== blueprint.revision
        )
          throw new AppError(
            'INVALID_PLAN_WINDOW',
            'Generated plan window does not match the request',
            422,
          );
        if (this.story.getBlueprint(projectId)?.revision !== blueprint.revision)
          throw new AppError(
            'STALE_INPUT',
            'Story blueprint changed during plan-window generation',
            409,
          );
        const currentArc = this.story.getArc(projectId, arcId);
        if (!currentArc || currentArc.inputFingerprint !== arc.inputFingerprint)
          throw new AppError('STALE_INPUT', 'Story arc changed during plan-window generation', 409);
        return this.story.savePlanWindow(projectId, windowResult, prompt.inputFingerprint);
      },
    )) as StoryPlanWindowResult;
  }

  private validateChapterEnvelopeV2(
    projectId: Id,
    envelope: ChapterGenerationV2Envelope,
    blueprint: StoryBlueprint,
    planItem: ChapterPlanItem,
    state: StoryState,
  ): void {
    const characterIds = new Set(blueprint.characters.map((character) => character.id));
    const plannedCharacterIds = new Set(planItem.characterIds);
    if (
      envelope.usedCharacterIds.some(
        (id) => !characterIds.has(id) || !plannedCharacterIds.has(id),
      ) ||
      envelope.introducedCharacterIds.some((id) => !characterIds.has(id))
    )
      throw new AppError(
        'STRUCTURED_OUTPUT_ERROR',
        'Chapter output references an invalid character',
        422,
        true,
      );
    const knownThreadIds = new Set([
      ...state.threads.map((thread) => thread.id),
      ...envelope.stateDelta.newThreads.map((thread) => thread.id),
    ]);
    const knownArcIds = new Set(this.story.getArcs(projectId).map((arc) => arc.id));
    if (
      envelope.unresolvedThreadIds.some((id) => !knownThreadIds.has(id)) ||
      envelope.stateDelta.threadUpdates.some((update) => !knownThreadIds.has(update.threadId)) ||
      envelope.stateDelta.arcProgress.some((progress) => !knownArcIds.has(progress.arcId))
    )
      throw new AppError(
        'STRUCTURED_OUTPUT_ERROR',
        'Chapter output references an unknown story entity',
        422,
        true,
      );
  }

  private v2Context(
    projectId: Id,
    planItem: ChapterPlanItem,
    instructions: string[] = [],
    stateOverride?: StoryState,
  ): BoundedGenerationContext {
    return buildChapterGenerationContextV2(
      this.story,
      this.chapters,
      projectId,
      planItem,
      instructions,
      stateOverride,
    );
  }

  async generateChapterV2(
    projectId: Id,
    planItemId: string,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<{ chapterId: Id; chapterRevision: number; stateRevisionId: Id }> {
    const settings = this.story.getSettings(projectId);
    const blueprintRecord = this.story.getBlueprint(projectId);
    const planItem = this.story.getPlanItem(projectId, planItemId)?.item;
    if (!settings || !blueprintRecord || !planItem)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Long-story settings, blueprint, and plan item are required',
        409,
      );
    const existing = this.context.database.sqlite
      .prepare(
        'SELECT id,number,revision,story_origin as origin FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId, planItemId) as
      { id: Id; number: number; revision: number; origin: string } | undefined;
    if (existing?.origin === 'MANUAL')
      throw new AppError(
        'MANUAL_EDIT_CONFLICT',
        'A newer manual chapter revision must be reviewed before regeneration',
        409,
      );
    const currentState = this.story.getStoryState(projectId);
    const followsSkippedGap =
      planItem.chapterNumber === currentState.currentChapter + 2 &&
      currentState.gapMarkers.some(
        (marker) => marker.chapterNumber === currentState.currentChapter + 1,
      );
    if (planItem.chapterNumber > currentState.currentChapter + 1 && !followsSkippedGap)
      throw new AppError(
        'CONTINUITY_ERROR',
        `Chapter ${planItem.chapterNumber} must follow chapter ${currentState.currentChapter}`,
        409,
      );
    let state = currentState;
    if (existing?.origin === 'GENERATED' && planItem.chapterNumber <= currentState.currentChapter) {
      const baseState = this.story.getStoryStateAtChapter(projectId, planItem.chapterNumber - 1);
      if (!baseState || baseState.currentChapter !== planItem.chapterNumber - 1)
        throw new AppError(
          'CONTINUITY_ERROR',
          `A valid checkpoint before chapter ${planItem.chapterNumber} is required before regeneration`,
          409,
        );
      state = baseState;
    }
    const context = this.v2Context(projectId, planItem, [], state);
    const prompt = renderChapterGenerationV2Prompt(context, planItem, settings.generation.model);
    const recovered = workflowStepId
      ? this.story.getCompletedChapterV2Commit(
          projectId,
          planItemId,
          workflowStepId,
          prompt.inputFingerprint,
        )
      : null;
    if (recovered) return recovered;
    const result = (await this.run(
      projectId,
      planItemId,
      prompt,
      signal,
      onProgress,
      context.inputFingerprint,
      workflowStepId,
      async (agentResult, metadata, generationId) => {
        const envelope = chapterGenerationV2EnvelopeSchema.parse(
          parseStoryOperationOutput('CHAPTER_GENERATION_V2', agentResult.text),
        );
        this.validateChapterEnvelopeV2(
          projectId,
          envelope,
          blueprintRecord.blueprint,
          planItem,
          state,
        );
        const reduction = reduceStoryState(state, envelope.stateDelta, {
          projectId,
          chapterNumber: planItem.chapterNumber,
          sourceChapterRevision: null,
          blueprint: blueprintRecord.blueprint,
          arcs: this.story.getArcs(projectId),
          chapterSummary: envelope.summary,
        });
        const enrichedMetadata = this.metadataWithContext(metadata, context);
        Object.assign(metadata, enrichedMetadata);
        return this.story.commitGeneratedChapterV2({
          projectId,
          planItemId,
          generationId,
          workflowStepId,
          envelope,
          state: reduction.state,
          metadata: enrichedMetadata,
          usage: this.usageFor(
            projectId,
            'CHAPTER_GENERATION_V2',
            planItemId,
            enrichedMetadata,
            agentResult,
          ),
          inputFingerprint: prompt.inputFingerprint,
        });
      },
    )) as { chapterId: Id; chapterRevision: number; stateRevisionId: Id };
    this.story.invalidateScope({
      projectId,
      kind: 'CHAPTER',
      chapterId: result.chapterId,
      excludeStepId: workflowStepId ?? undefined,
      preserveCurrentSummary: true,
    });
    this.scenes.markChapterStale(result.chapterId);
    this.invalidateSceneWorkflowForChapter(result.chapterId);
    return result;
  }
  private analysisPlanItem(
    chapter: ChapterDto,
    blueprint: StoryBlueprint,
    state: StoryState,
  ): ChapterPlanItem {
    return chapterPlanItemSchema.parse({
      id: chapter.storyPlanItemId ?? `manual-chapter-${chapter.number}`,
      chapterNumber: chapter.number,
      title: chapter.title,
      purpose: 'Analyze the persisted chapter for continuity state.',
      summary: '',
      setting: 'Unknown',
      characterIds: blueprint.characters.map((character) => character.id).slice(0, 100),
      conflict: '',
      turningPoints: [],
      resolution: '',
      emotionalArc: '',
      estimatedWordCount: 100,
      threadIds: state.threads.map((thread) => thread.id).slice(0, 100),
    });
  }

  async analyzeChapter(
    chapterId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<ManualChapterAnalysis> {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const blueprint = this.story.getBlueprint(chapter.projectId)?.blueprint;
    if (!blueprint) throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const currentState = this.story.getStoryState(chapter.projectId);
    const checkpointBeforeChapter =
      chapter.number <= currentState.currentChapter
        ? this.story.getStoryStateAtChapter(chapter.projectId, chapter.number - 1)
        : currentState;
    if (!checkpointBeforeChapter)
      throw new AppError(
        'CONTINUITY_ERROR',
        `A valid checkpoint before chapter ${chapter.number} is required`,
        409,
      );
    const state = checkpointBeforeChapter;
    const sourceStateRevision = this.story.getStoryStateRevisionRef(
      chapter.projectId,
      state.revision,
    );
    const planItem =
      (chapter.storyPlanItemId
        ? this.story.getPlanItem(chapter.projectId, chapter.storyPlanItemId)?.item
        : null) ?? this.analysisPlanItem(chapter, blueprint, state);
    const context = this.v2Context(chapter.projectId, planItem, [
      'Analyze the supplied chapter without changing canonical state automatically.',
    ]);
    const prompt = renderStateAnalysisPrompt(
      context,
      { title: chapter.title, content: chapter.content, revision: chapter.revision },
      this.story.getSettings(chapter.projectId)?.generation.model ?? null,
    );
    return (await this.run(
      chapter.projectId,
      chapterId,
      prompt,
      signal,
      onProgress,
      context.inputFingerprint,
      workflowStepId,
      async (agentResult, metadata) => {
        const analysis = manualChapterAnalysisSchema.parse(
          parseStoryOperationOutput('STATE_ANALYSIS', agentResult.text),
        );
        if (this.chapters.get(chapterId)?.revision !== chapter.revision)
          throw new AppError('STALE_INPUT', 'Chapter changed during state analysis', 409);
        const sourceStateRevisionId = sourceStateRevision?.id ?? null;
        reduceStoryState(state, analysis.stateDelta, {
          projectId: chapter.projectId,
          chapterNumber: chapter.number,
          sourceChapterId: chapter.id,
          sourceChapterRevision: chapter.revision,
          blueprint,
          arcs: this.story.getArcs(chapter.projectId),
          chapterSummary: analysis.summary,
        });
        const enrichedMetadata = this.metadataWithContext(metadata, context);
        Object.assign(metadata, enrichedMetadata);
        this.story.saveContinuityCheck({
          projectId: chapter.projectId,
          chapterId,
          chapterRevision: chapter.revision,
          sourceStateRevisionId,
          result: analysis.continuity,
          stateDelta: analysis.stateDelta,
          summary: analysis.summary,
          metadata: enrichedMetadata,
        });
        return analysis;
      },
    )) as ManualChapterAnalysis;
  }

  acceptManualAnalysis(
    chapterId: Id,
    checkId: Id,
  ): { stateRevisionId: Id; deltaId: Id; summaryId: Id; state: StoryState } {
    const check = this.story.getContinuityCheck(checkId);
    const chapter = this.chapters.get(chapterId);
    if (!check || check.projectId !== chapter?.projectId || check.chapterId !== chapterId)
      throw new AppError('NOT_FOUND', 'Continuity analysis was not found', 404);
    if (!chapter || chapter.revision !== check.chapterRevision)
      throw new AppError('STALE_INPUT', 'Manual chapter changed before continuity acceptance', 409);
    const blueprint = this.story.getBlueprint(chapter.projectId)?.blueprint;
    if (!blueprint) throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const sourceState = check.sourceStateRevisionId
      ? this.story.getStoryStateRevisionById(chapter.projectId, check.sourceStateRevisionId)?.state
      : this.story.getStoryState(chapter.projectId);
    if (!sourceState || !check.stateDelta || !check.summary)
      throw new AppError(
        'INVALID_CONTINUITY',
        'Continuity analysis has no reviewable state delta',
        409,
      );
    const reduction = reduceStoryState(sourceState, check.stateDelta, {
      projectId: chapter.projectId,
      chapterNumber: chapter.number,
      sourceChapterId: chapter.id,
      sourceChapterRevision: chapter.revision,
      arcs: this.story.getArcs(chapter.projectId),
      blueprint,
      chapterSummary: check.summary,
    });
    return this.story.commitAcceptedManualAnalysis({
      projectId: chapter.projectId,
      checkId,
      chapterId,
      chapterRevision: chapter.revision,
      sourceStateRevisionId: check.sourceStateRevisionId,
      state: reduction.state,
      delta: check.stateDelta,
      metadata: null,
      inputFingerprint: this.story.fingerprint({
        operation: 'ACCEPT_MANUAL_ANALYSIS',
        checkId,
        chapterRevision: chapter.revision,
      }),
    });
  }

  rebuildContinuity(
    projectId: Id,
    fromChapter: number,
  ): {
    state: StoryState;
    appliedChapterNumbers: number[];
    blockedChapter: number | null;
    reason: string | null;
  } {
    const settings = this.story.getSettings(projectId);
    const blueprint = this.story.getBlueprint(projectId)?.blueprint;
    if (!settings || !blueprint)
      throw new AppError('PREREQUISITE_MISSING', 'Story settings and blueprint are required', 409);
    if (
      !Number.isInteger(fromChapter) ||
      fromChapter < 1 ||
      fromChapter > settings.targetChapterCount
    )
      throw new AppError(
        'CONTINUITY_ERROR',
        'Continuity rebuild chapter is outside the target',
        400,
      );
    const currentRef = this.story.getCurrentStoryStateRevisionRef(projectId);
    if (!currentRef)
      throw new AppError('CONTINUITY_ERROR', 'Current StoryState checkpoint is missing', 409);
    const records = this.story.listStoryStateRevisionRecords(projectId, 500);
    const base = records.filter((record) => record.state.currentChapter === fromChapter - 1).at(-1);
    if (!base)
      throw new AppError(
        'CONTINUITY_ERROR',
        `No valid StoryState checkpoint exists before chapter ${fromChapter}`,
        409,
      );
    const chapters = this.chapters
      .listMetadata(projectId)
      .filter((chapter) => chapter.number >= fromChapter)
      .sort((left, right) => left.number - right.number);
    let previous = base.state;
    const states: Array<{
      state: StoryState;
      chapterId: Id;
      chapterRevision: number;
      delta: StoryStateDelta;
      deltaId: Id | null;
    }> = [];
    let blockedChapter: number | null = null;
    let reason: string | null = null;
    let expectedChapter = fromChapter;
    for (const chapter of chapters) {
      if (chapter.number !== expectedChapter) {
        blockedChapter = expectedChapter;
        reason = 'A chapter is missing from the continuity sequence';
        break;
      }
      const deltaRecord = this.story.getStateDeltaForChapter(chapter.id, chapter.revision);
      if (!deltaRecord || deltaRecord.validationStatus !== 'VALID') {
        blockedChapter = chapter.number;
        reason =
          chapter.origin === 'MANUAL'
            ? 'Manual chapter requires explicit analysis before rebuild'
            : 'Chapter has no valid reusable StateDelta';
        break;
      }
      const summary = this.story.getSummary(chapter.id)?.summary;
      const reduction = reduceStoryState(previous, deltaRecord.delta, {
        projectId,
        chapterNumber: chapter.number,
        sourceChapterId: chapter.id,
        arcs: this.story.getArcs(projectId),
        sourceChapterRevision: chapter.revision,
        blueprint,
        chapterSummary: summary,
      });
      states.push({
        state: reduction.state,
        chapterId: chapter.id,
        chapterRevision: chapter.revision,
        delta: deltaRecord.delta,
        deltaId: deltaRecord.id,
      });
      previous = reduction.state;
      expectedChapter += 1;
    }
    if (blockedChapter !== null) {
      if (chapters.find((chapter) => chapter.number === blockedChapter)?.origin === 'MANUAL')
        this.story.markManualContinuityReview(projectId, blockedChapter);
      else this.story.markContinuityStale(projectId, blockedChapter - 1, reason ?? undefined);
    }
    const committed = this.story.commitRebuiltStoryState({
      projectId,
      baseStateRevisionId: base.id,
      baseStateRevision: base.revision,
      baseState: base.state,
      expectedCurrentStateRevisionId: currentRef.id,
      expectedCurrentStateRevision: currentRef.revision,
      states,
      inputFingerprint: this.story.fingerprint({
        operation: 'CONTINUITY_REBUILD',
        projectId,
        fromChapter,
        baseRevision: base.revision,
        chapters: states.map((item) => [item.chapterId, item.chapterRevision, item.deltaId]),
      }),
    });
    return {
      state: committed.state,
      appliedChapterNumbers: states.map((item) => item.state.currentChapter),
      blockedChapter,
      reason,
    };
  }

  async checkContinuity(
    chapterId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<ContinuityCheckResult> {
    const chapter = this.chapters.get(chapterId);
    if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
    const blueprint = this.story.getBlueprint(chapter.projectId)?.blueprint;
    if (!blueprint) throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
    const state = this.story.getStoryState(chapter.projectId);
    const planItem =
      (chapter.storyPlanItemId
        ? this.story.getPlanItem(chapter.projectId, chapter.storyPlanItemId)?.item
        : null) ?? this.analysisPlanItem(chapter, blueprint, state);
    const context = this.v2Context(chapter.projectId, planItem);
    const prompt = renderContinuityCheckPrompt(
      context,
      { title: chapter.title, content: chapter.content, revision: chapter.revision },
      this.story.getSettings(chapter.projectId)?.generation.model ?? null,
    );
    return (await this.run(
      chapter.projectId,
      chapterId,
      prompt,
      signal,
      onProgress,
      context.inputFingerprint,
      workflowStepId,
      async (agentResult, metadata) => {
        const result = continuityCheckResultSchema.parse(
          parseStoryOperationOutput('CONTINUITY_CHECK', agentResult.text),
        );
        if (this.chapters.get(chapterId)?.revision !== chapter.revision)
          throw new AppError('STALE_INPUT', 'Chapter changed during continuity check', 409);
        const enrichedMetadata = this.metadataWithContext(metadata, context);
        Object.assign(metadata, enrichedMetadata);
        this.story.saveContinuityCheck({
          projectId: chapter.projectId,
          chapterId,
          chapterRevision: chapter.revision,
          sourceStateRevisionId:
            this.story.getCurrentStoryStateRevisionRef(chapter.projectId)?.id ?? null,
          result,
          metadata: enrichedMetadata,
        });
        return result;
      },
    )) as ContinuityCheckResult;
  }

  async compactStorySummary(
    projectId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<StoryState> {
    const state = this.story.getStoryState(projectId);
    const prompt = renderSummaryCompactionPrompt(
      state,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    return (await this.run(
      projectId,
      projectId,
      prompt,
      signal,
      onProgress,
      null,
      workflowStepId,
      async (agentResult) => {
        const summary = String(parseStoryOperationOutput('SUMMARY_COMPACTION', agentResult.text));
        if (this.story.getStoryState(projectId).revision !== state.revision)
          throw new AppError('STALE_INPUT', 'StoryState changed during summary compaction', 409);
        this.story.compactStoryStateSummary(projectId, summary, prompt.inputFingerprint);
        return this.story.getStoryState(projectId);
      },
    )) as StoryState;
  }
  private chapterContext(
    projectId: Id,
    planItem: ChapterPlanItem,
    instructions: string[] = [],
  ): BoundedGenerationContext {
    return buildChapterGenerationContext(
      this.story,
      this.chapters,
      projectId,
      planItem,
      instructions,
    );
  }

  private validateChapterEnvelope(
    envelope: ChapterGenerationEnvelope,
    blueprint: StoryBlueprint,
    planItem: ChapterPlanItem,
  ): void {
    const characterIds = new Set(blueprint.characters.map((character) => character.id));
    const validCharacterIds = [
      ...envelope.usedCharacterIds,
      ...envelope.introducedCharacterIds,
      ...envelope.characterStateChanges.map((change) => change.characterId),
    ].every((id) => characterIds.has(id));
    if (!validCharacterIds)
      throw new AppError('VALIDATION_ERROR', 'Chapter output references an unknown character', 422);
    const planCharacterIds = new Set(planItem.characterIds);
    if (envelope.usedCharacterIds.some((id) => !characterIds.has(id) || !planCharacterIds.has(id)))
      throw new AppError(
        'VALIDATION_ERROR',
        'Chapter output escaped the planned character set',
        422,
      );
    if (
      envelope.threadTransitions.some(
        (transition) => !planItem.threadIds.includes(transition.threadId),
      )
    )
      throw new AppError('VALIDATION_ERROR', 'Chapter output references an unknown thread', 422);
  }

  async generateChapter(
    projectId: Id,
    planItemId: string,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<{ chapterId: Id; chapterRevision: number }> {
    const existing = this.context.database.sqlite
      .prepare(
        'SELECT id,story_origin as origin FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId, planItemId) as { id: Id; origin: string } | undefined;
    if (existing?.origin === 'MANUAL')
      throw new AppError(
        'MANUAL_EDIT_CONFLICT',
        'A newer manual chapter revision must be reviewed before regeneration',
        409,
      );
    const blueprint = this.story.getBlueprint(projectId)?.blueprint;
    const planItem = this.story.getPlanItem(projectId, planItemId)?.item;
    if (!blueprint || !planItem)
      throw new AppError(
        'PREREQUISITE_MISSING',
        'Current blueprint and chapter plan item are required',
        409,
      );
    const context = this.chapterContext(projectId, planItem);
    const prompt = renderChapterPrompt(
      context,
      planItem,
      this.story.getSettings(projectId)?.generation.model ?? null,
    );
    const result = (await this.run(
      projectId,
      planItemId,
      prompt,
      signal,
      onProgress,
      context.inputFingerprint,
      workflowStepId,
      async (result, metadata, generationId) => {
        const envelope = chapterGenerationEnvelopeSchema.parse(
          parseStoryOperationOutput('CHAPTER', result.text),
        );
        return this.story.commitGeneratedChapter({
          projectId,
          planItemId,
          generationId,
          workflowStepId,
          envelope,
          metadata,
          inputFingerprint: prompt.inputFingerprint,
        });
      },
    )) as { chapterId: Id; chapterRevision: number };
    this.story.invalidateScope({
      projectId,
      kind: 'CHAPTER',
      chapterId: result.chapterId,
      excludeStepId: workflowStepId ?? undefined,
      preserveCurrentSummary: true,
    });
    this.scenes.markChapterStale(result.chapterId);
    this.invalidateSceneWorkflowForChapter(result.chapterId);
    return result;
  }

  async generateSummary(
    chapterId: Id,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
    workflowStepId: Id | null = null,
  ): Promise<ChapterSummary> {
    const { chapter, context, model } = buildSummaryGenerationInput(
      this.story,
      this.chapters,
      chapterId,
    );
    const prompt = renderSummaryPrompt(
      context,
      {
        title: chapter.title,
        content: chapter.content,
        revision: chapter.revision,
      },
      model,
    );
    return (await this.run(
      chapter.projectId,
      chapterId,
      prompt,
      signal,
      onProgress,
      context.inputFingerprint,
      workflowStepId,
      async (result, metadata) => {
        const summary = parseStoryOperationOutput('CHAPTER_SUMMARY', result.text) as ChapterSummary;
        if (workflowStepId)
          this.workflow.assertRunningStepFingerprint(workflowStepId, prompt.inputFingerprint);
        if (this.chapters.get(chapterId)?.revision !== chapter.revision)
          throw new AppError('STALE_INPUT', 'Chapter changed during summary generation', 409);
        this.story.saveSummary(
          chapterId,
          chapter.revision,
          summary,
          [],
          metadata,
          prompt.inputFingerprint,
        );
        return summary;
      },
    )) as ChapterSummary;
  }

  private enqueueContinuityCheck(
    executionId: Id,
    dependsOnStepId: Id,
    chapterId: Id,
    chapterRevision: number,
    maxRetries: number,
  ): void {
    const stepKey = `continuity:${chapterId}:${chapterRevision}`;
    const existing = this.context.database.sqlite
      .prepare('SELECT id FROM workflow_steps WHERE execution_id=? AND step_key=?')
      .get(executionId, stepKey) as { id: Id } | undefined;
    if (existing) return;
    const stepId = this.workflow.createStep(
      executionId,
      stepKey,
      'CHECK_CONTINUITY',
      chapterId,
      this.story.fingerprint({
        operation: 'CONTINUITY_CHECK_DEFERRED',
        chapterId,
        chapterRevision,
      }),
      maxRetries + 1,
    );
    this.workflow.dependency(stepId, dependsOnStepId);
    this.workflow.createJob('CHECK_CONTINUITY', chapterId, stepId);
  }

  async executeStep(
    step: ClaimedStep,
    signal?: AbortSignal,
    onProgress?: StoryEngineProgress,
  ): Promise<void> {
    if (step.type === 'GENERATE_STORY_BLUEPRINT') {
      await this.generateBlueprint(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'GENERATE_CHAPTER_PLANS') {
      const settings = this.story.getSettings(step.entity_id);
      const blueprint = this.story.getBlueprint(step.entity_id);
      if (!settings || !blueprint)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Story settings and blueprint are required',
          409,
        );
      this.workflow.updateRunningStepFingerprint(
        step,
        renderChapterPlansPrompt(settings, blueprint.blueprint).inputFingerprint,
      );
      await this.generatePlans(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'GENERATE_STORY_ARCS') {
      await this.generateArcs(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'GENERATE_CHAPTER_PLAN_WINDOW') {
      const parts = step.step_key.split(':');
      const startChapter = Number(parts[2]);
      const endChapter = Number(parts[3]);
      if (parts.length !== 4 || !Number.isInteger(startChapter) || !Number.isInteger(endChapter))
        throw new AppError('INVALID_WORKFLOW_STEP', 'Plan-window step key is invalid', 400);
      const settings = this.story.getSettings(step.entity_id);
      const blueprint = this.story.getBlueprint(step.entity_id);
      const arc = this.story.getArc(step.entity_id, parts[1] ?? '');
      if (!settings || !blueprint || !arc)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Story settings, blueprint, and arc are required',
          409,
        );
      const previousWindow =
        this.story
          .getPlanWindows(step.entity_id)
          .filter((window) => window.window.endChapter < startChapter)
          .sort((left, right) => right.window.endChapter - left.window.endChapter)[0] ?? null;
      this.workflow.updateRunningStepFingerprint(
        step,
        renderChapterPlanWindowPrompt(
          settings,
          blueprint.blueprint,
          arc,
          planWindowBoundary(previousWindow),
          startChapter,
          endChapter,
        ).inputFingerprint,
      );
      await this.generatePlanWindow(
        step.entity_id,
        parts[1] ?? '',
        startChapter,
        endChapter,
        signal,
        onProgress,
        step.id,
      );
      return;
    }
    if (step.type === 'GENERATE_CHAPTER_V2') {
      const project = this.context.database.sqlite
        .prepare(
          `SELECT projectId FROM (
             SELECT p.project_id as projectId FROM story_plan_revisions p
             JOIN story_plan_items i ON i.plan_revision_id=p.id
             WHERE p.is_current=1 AND i.stable_id=?
             UNION ALL
             SELECT w.project_id as projectId FROM story_plan_window_revisions w
             JOIN story_plan_window_items i ON i.window_revision_id=w.id
             WHERE w.is_current=1 AND i.stable_id=?
           ) LIMIT 1`,
        )
        .get(step.entity_id, step.entity_id) as { projectId: Id } | undefined;
      if (!project)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Chapter plan item is not linked to a project',
          409,
        );
      const planItem = this.story.getPlanItem(project.projectId, step.entity_id)?.item;
      if (!planItem)
        throw new AppError('PREREQUISITE_MISSING', 'Chapter plan item is not available', 409);
      const recovered = this.story.getCompletedChapterV2Commit(
        project.projectId,
        step.entity_id,
        step.id,
      );
      if (recovered) {
        const settings = this.story.getSettings(project.projectId);
        if (settings?.generation.continuityChecksEnabled)
          this.enqueueContinuityCheck(
            step.execution_id,
            step.id,
            recovered.chapterId,
            recovered.chapterRevision,
            settings.generation.maxRetries ?? 3,
          );
        return;
      }
      const currentState = this.story.getStoryState(project.projectId);
      const existingChapter = this.chapters.getByPlanItem(project.projectId, step.entity_id);
      const contextState =
        existingChapter?.origin === 'GENERATED' &&
        planItem.chapterNumber <= currentState.currentChapter
          ? this.story.getStoryStateAtChapter(project.projectId, planItem.chapterNumber - 1)
          : currentState;
      if (!contextState)
        throw new AppError(
          'CONTINUITY_ERROR',
          `A valid checkpoint before chapter ${planItem.chapterNumber} is required`,
          409,
        );
      const context = this.v2Context(project.projectId, planItem, [], contextState);
      const inputFingerprint = renderChapterGenerationV2Prompt(
        context,
        planItem,
        this.story.getSettings(project.projectId)?.generation.model ?? null,
      ).inputFingerprint;
      this.workflow.updateRunningStepFingerprint(step, inputFingerprint);
      this.batches.setInputFingerprint(step.id, inputFingerprint);
      const result = await this.generateChapterV2(
        project.projectId,
        step.entity_id,
        signal,
        onProgress,
        step.id,
      );
      const settings = this.story.getSettings(project.projectId);
      if (settings?.generation.continuityChecksEnabled)
        this.enqueueContinuityCheck(
          step.execution_id,
          step.id,
          result.chapterId,
          result.chapterRevision,
          settings.generation.maxRetries ?? 3,
        );
      return;
    }
    if (step.type === 'ANALYZE_STORY_STATE') {
      const chapter = this.chapters.get(step.entity_id);
      if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
      const blueprint = this.story.getBlueprint(chapter.projectId)?.blueprint;
      if (!blueprint)
        throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
      const currentState = this.story.getStoryState(chapter.projectId);
      const state =
        chapter.number <= currentState.currentChapter
          ? (this.story.getStoryStateAtChapter(chapter.projectId, chapter.number - 1) ??
            currentState)
          : currentState;
      const planItem =
        (chapter.storyPlanItemId
          ? this.story.getPlanItem(chapter.projectId, chapter.storyPlanItemId)?.item
          : null) ?? this.analysisPlanItem(chapter, blueprint, state);
      const context = this.v2Context(chapter.projectId, planItem, [
        'Analyze the supplied chapter without changing canonical state automatically.',
      ]);
      this.workflow.updateRunningStepFingerprint(
        step,
        renderStateAnalysisPrompt(
          context,
          { title: chapter.title, content: chapter.content, revision: chapter.revision },
          this.story.getSettings(chapter.projectId)?.generation.model ?? null,
        ).inputFingerprint,
      );
      await this.analyzeChapter(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'CHECK_CONTINUITY') {
      const chapter = this.chapters.get(step.entity_id);
      if (!chapter) throw new AppError('NOT_FOUND', 'Chapter not found', 404);
      const blueprint = this.story.getBlueprint(chapter.projectId)?.blueprint;
      if (!blueprint)
        throw new AppError('PREREQUISITE_MISSING', 'Story blueprint is required', 409);
      const state = this.story.getStoryState(chapter.projectId);
      const planItem =
        (chapter.storyPlanItemId
          ? this.story.getPlanItem(chapter.projectId, chapter.storyPlanItemId)?.item
          : null) ?? this.analysisPlanItem(chapter, blueprint, state);
      const context = this.v2Context(chapter.projectId, planItem);
      this.workflow.updateRunningStepFingerprint(
        step,
        renderContinuityCheckPrompt(
          context,
          { title: chapter.title, content: chapter.content, revision: chapter.revision },
          this.story.getSettings(chapter.projectId)?.generation.model ?? null,
        ).inputFingerprint,
      );
      await this.checkContinuity(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'SUMMARY_COMPACTION') {
      await this.compactStorySummary(step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'GENERATE_CHAPTER') {
      const project = this.context.database.sqlite
        .prepare(
          `SELECT projectId FROM (
             SELECT p.project_id as projectId FROM story_plan_revisions p
             JOIN story_plan_items i ON i.plan_revision_id=p.id
             WHERE p.is_current=1 AND i.stable_id=?
             UNION ALL
             SELECT w.project_id as projectId FROM story_plan_window_revisions w
             JOIN story_plan_window_items i ON i.window_revision_id=w.id
             WHERE w.is_current=1 AND i.stable_id=?
           ) LIMIT 1`,
        )
        .get(step.entity_id, step.entity_id) as { projectId: Id } | undefined;
      const projectId = project?.projectId;
      if (!projectId)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Chapter plan item is not linked to a project',
          409,
        );
      await this.generateChapter(projectId, step.entity_id, signal, onProgress, step.id);
      return;
    }
    if (step.type === 'GENERATE_CHAPTER_SUMMARY') {
      await this.generateSummary(step.entity_id, signal, onProgress, step.id);
      return;
    }
    throw new AppError('INVALID_WORKFLOW_STEP', `Unsupported Story Engine step ${step.type}`, 400);
  }
}

export function createStoryEngine(context: StoryEngineContext): StoryEngine {
  return new StoryEngine(context);
}
