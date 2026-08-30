import {
  StoryRepository,
  ChapterRepository,
  WorkflowRepository,
  type ClaimedStep,
  type DatabaseHandle,
} from '@studio/database';
import {
  AppError,
  chapterGenerationEnvelopeSchema,
  type ChapterGenerationEnvelope,
  chapterPlanItemSchema,
  generationMetadataSchema,
  parseStoryOperationOutput,
  storySettingsSchema,
  storyBlueprintSchema,
  type ChapterPlanItem,
  type ChapterDto,
  type StoryBlueprintDto,
  type ChapterSummary,
  type GenerationMetadata,
  type GenerationOperation,
  type Id,
  type StoryBlueprint,
  type StoryPlanDto,
  type StorySettingsDto,
} from '@studio/shared';
import type { AiAgent, AiAgentProgress, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { compileGenerationContext, type BoundedGenerationContext } from './story-context.js';
import {
  renderBlueprintPrompt,
  renderChapterPlansPrompt,
  renderChapterPrompt,
  renderSummaryPrompt,
  type StoryPrompt,
} from './story-prompts.js';

export type StoryEngineProgress = AiAgentProgress;

export type StoryEngineContext = {
  database: DatabaseHandle;
  agent: AiAgent;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Story generation failed';
}

export function buildChapterGenerationContext(
  story: StoryRepository,
  chaptersRepository: ChapterRepository,
  projectId: Id,
  planItem: ChapterPlanItem,
  instructions: string[] = [],
): BoundedGenerationContext {
  const blueprint = story.getBlueprint(projectId)?.blueprint ?? null;
  const chapters = chaptersRepository.list(projectId);
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
  readonly workflow: WorkflowRepository;

  constructor(private readonly context: StoryEngineContext) {
    this.story = new StoryRepository(context.database);
    this.chapters = new ChapterRepository(context.database);
    this.workflow = new WorkflowRepository(context.database);
  }

  saveSettings(projectId: Id, input: unknown): StorySettingsDto {
    const settings = storySettingsSchema.parse(input);
    const saved = this.story.saveSettings(projectId, settings);
    this.story.invalidateScope({ projectId, kind: 'SETTINGS' });
    return saved;
  }

  getSettings(projectId: Id): StorySettingsDto | null {
    return this.story.getSettings(projectId);
  }

  getBlueprint(projectId: Id) {
    return this.story.getBlueprint(projectId);
  }

  getPlan(projectId: Id): StoryPlanDto | null {
    return this.story.getPlan(projectId);
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
      attempt,
      contextHash,
      omittedContext: omittedContext.slice(0, 100),
    });
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
    const startedAt = new Date().toISOString();
    const initial = this.initialMetadata(prompt.operation, prompt, startedAt, 1, contextHash);
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
      model: this.story.getSettings(projectId)?.generation.model ?? null,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
      inputFingerprint: prompt.inputFingerprint,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    };
    try {
      const result = await this.context.agent.generate(request, signal, onProgress);
      const metadata = this.completedMetadata(
        prompt.operation,
        prompt,
        startedAt,
        result,
        1,
        contextHash,
      );
      const committed = await commit(result, metadata, generationId);
      this.story.updateGenerationRecord(generationId, 'COMPLETED', metadata);
      return committed;
    } catch (error) {
      this.story.updateGenerationRecord(generationId, 'FAILED', initial, errorMessage(error));
      if (error instanceof AppError) throw error;
      throw new AppError('VALIDATION_ERROR', errorMessage(error), 422, false);
    }
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
    if (step.type === 'GENERATE_CHAPTER') {
      const project = this.context.database.sqlite
        .prepare(
          'SELECT p.project_id as projectId FROM story_plan_revisions p JOIN story_plan_items i ON i.plan_revision_id=p.id WHERE p.is_current=1 AND i.stable_id=? LIMIT 1',
        )
        .get(step.entity_id) as { projectId: Id } | undefined;
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
