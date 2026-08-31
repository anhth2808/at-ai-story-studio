import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import { chapterGenerationV2EnvelopeSchema, type AiUsage } from '@studio/shared';
import { ProcessRunner } from '@studio/media';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { StoryEngine, renderChapterGenerationPrompt } from './story-engine.js';
import { renderChapterPlansPrompt } from './story-prompts.js';
import { StudioService } from './index.js';
import { reduceStoryState } from './story-state.js';

const settings = {
  mode: 'IDEA_TO_STORY' as const,
  idea: 'A courier keeps a promise through a city that forgets.',
  language: 'vi-VN',
  genre: 'fantasy',
  tone: 'reflective',
  audience: 'general',
  targetChapterCount: 3,
  chapterLength: 800,
  pacing: 'MEDIUM' as const,
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {},
};

const blueprint = {
  premise: 'A courier keeps a promise.',
  themes: ['duty'],
  worldRules: ['Memories have a price.'],
  continuityConstraints: ['Mai never abandons a delivery.'],
  plotDirection: 'The promise changes the city.',
  characters: [
    {
      id: 'mai',
      name: 'Mai',
      role: 'courier',
      ageRange: 'adult',
      appearance: 'short dark hair',
      personality: 'steady',
      wants: 'finish the delivery',
      fears: 'forgetting her own name',
      traits: ['observant'],
      relationships: [],
      backstory: 'She inherited the route from her mother.',
      voice: 'plain and careful',
      arc: 'from duty to chosen responsibility',
    },
  ],
};

const planItem = {
  id: 'chapter-1',
  chapterNumber: 1,
  title: 'The Unopened Door',
  purpose: 'Introduce the promise.',
  summary: 'Mai receives a sealed letter.',
  setting: 'old city gate',
  characterIds: ['mai'],
  conflict: 'The recipient has vanished.',
  turningPoints: ['The seal bears Mai’s name.'],
  resolution: 'Mai accepts the route.',
  emotionalArc: 'doubt to resolve',
  estimatedWordCount: 800,
  threadIds: ['thread-main'],
};
const plan = {
  items: [
    planItem,
    { ...planItem, id: 'chapter-2', chapterNumber: 2, title: 'The Storm Archive' },
    { ...planItem, id: 'chapter-3', chapterNumber: 3, title: 'The Kept Promise' },
  ],
};

class FakeAgent implements AiAgent {
  calls: AiAgentRequest[] = [];
  includeUsage = true;
  invalidV2Output = false;
  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    let text: string;
    if (request.operation === 'BLUEPRINT') text = JSON.stringify(blueprint);
    else if (request.operation === 'CHAPTER_PLANS') text = JSON.stringify(plan);
    else if (request.operation === 'ARC_PLANNING')
      text = JSON.stringify({
        arcs: [
          {
            id: 'arc-1',
            ordinalIndex: 1,
            startChapter: 1,
            endChapter: 3,
            title: 'The Kept Promise',
            goal: 'Keep the delivery moving.',
            conflict: 'The city forgets the route.',
            importantCharacterIds: ['mai'],
            importantThreadIds: [],
            plannedOutcome: 'Mai chooses responsibility.',
            status: 'PLANNED',
            sourceBlueprintRevision: 1,
            inputFingerprint: null,
          },
        ],
      });
    else if (request.operation === 'CHAPTER_PLAN_WINDOW')
      text = JSON.stringify({
        window: {
          id: 'window-1',
          startChapter: 1,
          endChapter: 3,
          arcId: 'arc-1',
          sourceBlueprintRevision: 1,
          priorWindowSummary: null,
          inputFingerprint: null,
          status: 'CURRENT',
        },
        items: plan.items,
      });
    else if (request.operation === 'CHAPTER_GENERATION_V2')
      text = JSON.stringify({
        title: 'The Unopened Door',
        content: 'Mai takes the sealed letter and walks toward the gate.',
        summary: {
          recap: 'Mai accepts the sealed letter.',
          keyFacts: ['Mai has the letter.'],
          characterStateChanges: [{ characterId: 'mai', change: 'accepts the route' }],
          newInformation: ['The seal bears Mai’s name.'],
          openThreadIds: ['thread-main'],
          resolvedThreadIds: [],
        },
        stateDelta: {
          characterUpdates: [
            {
              characterId: 'mai',
              currentGoal: 'finish the route',
              knowledge: ['The seal bears Mai’s name.'],
            },
          ],
          threadUpdates: [],
          newThreads: [],
          facts: [],
          events: [],
          arcProgress: [],
          gapMarkers: [],
        },
        usedCharacterIds: ['mai'],
        introducedCharacterIds: [],
        unresolvedThreadIds: [],
        continuityWarnings: [],
      });
    else if (request.operation === 'STATE_ANALYSIS')
      text = JSON.stringify({
        summary: {
          recap: 'Mai accepts the sealed letter.',
          keyFacts: ['Mai has the letter.'],
          characterStateChanges: [{ characterId: 'mai', change: 'accepts the route' }],
          newInformation: ['The seal bears Mai’s name.'],
          openThreadIds: [],
          resolvedThreadIds: [],
        },
        stateDelta: {
          characterUpdates: [
            {
              characterId: 'mai',
              currentGoal: 'finish the route',
              knowledge: ['The seal bears Mai’s name.'],
            },
          ],
          threadUpdates: [],
          newThreads: [],
          facts: [],
          events: [],
          arcProgress: [],
          gapMarkers: [],
        },
        continuity: { status: 'PASS', issues: [] },
      });
    else if (request.operation === 'CHAPTER')
      text = JSON.stringify({
        title: 'The Unopened Door',
        content: 'Mai takes the sealed letter and walks toward the gate.',
        summary: {
          recap: 'Mai accepts the sealed letter.',
          keyFacts: ['Mai has the letter.'],
          characterStateChanges: [{ characterId: 'mai', change: 'accepts the route' }],
          newInformation: ['The seal bears Mai’s name.'],
          openThreadIds: ['thread-main'],
          resolvedThreadIds: [],
        },
        events: [
          { description: 'Mai accepts the letter.', importance: 'MEDIUM', characterIds: ['mai'] },
        ],
        characterStateChanges: [{ characterId: 'mai', change: 'accepts the route' }],
        threadTransitions: [
          { threadId: 'thread-main', status: 'OPEN', note: 'The route remains open.' },
        ],
        usedCharacterIds: ['mai'],
        introducedCharacterIds: [],
        unresolvedThreadIds: [],
        continuityWarnings: [],
      });
    else
      text = JSON.stringify({
        recap: 'Mai accepts the sealed letter.',
        keyFacts: [],
        characterStateChanges: [],
        newInformation: [],
        openThreadIds: [],
        resolvedThreadIds: [],
      });
    if (request.operation === 'CHAPTER_GENERATION_V2' && this.invalidV2Output)
      text = text.replaceAll('"characterId":"mai"', '"characterId":"unknown"');
    return {
      operation: request.operation,
      text,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: this.includeUsage ? 1 : null,
      outputTokens: this.includeUsage ? 1 : null,
      costUsd: this.includeUsage ? 0 : null,
      durationMs: 1,
    };
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-engine-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  const agent = new FakeAgent();
  const service = new StudioService({
    database,
    workspace: {} as never,
    media: {} as never,
    runner: new ProcessRunner(),
  });
  return { database, agent, engine: new StoryEngine({ database, agent }), service };
}

describe('Story Engine', () => {
  it('persists unavailable provider usage as null without blocking generation', async () => {
    const { database, agent, engine } = await setup();
    agent.includeUsage = false;
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    const usage = engine.story.getUsage('project', 20);
    expect(usage[0]).toMatchObject({
      operation: 'BLUEPRINT',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      status: 'SUCCEEDED',
    });
    expect(engine.story.getUsageSummary('project').unavailableCount).toBe(1);
    database.sqlite.close();
  });

  it('rejects a known over-budget operation before invoking the AI boundary', async () => {
    const { database, agent, engine } = await setup();
    engine.saveSettings('project', {
      ...settings,
      generation: { maxEstimatedTokensPerOperation: 1 },
    });
    await expect(engine.generateBlueprint('project')).rejects.toMatchObject({
      code: 'BUDGET_ERROR',
    });
    expect(agent.calls).toHaveLength(0);
    database.sqlite.close();
  });

  it('commits three validated chapters before an explicit TTS handoff', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const generated = [];
    for (const planItemId of ['chapter-1', 'chapter-2', 'chapter-3']) {
      generated.push(await engine.generateChapter('project', planItemId));
    }
    const chapters = generated.map((item) => engine.chapters.get(item.chapterId)!);
    expect(chapters).toHaveLength(3);
    expect(chapters.every((chapter) => chapter.origin === 'GENERATED')).toBe(true);
    expect(
      chapters.every(
        (chapter) => engine.story.getSummary(chapter.id)?.chapterRevision === chapter.revision,
      ),
    ).toBe(true);
    const firstSummary = engine.story.getSummary(chapters[0]!.id)!;
    expect(firstSummary.events[0]?.description).toBe('Mai accepts the letter.');
    expect(firstSummary.threadTransitions[0]?.threadId).toBe('thread-main');
    expect(firstSummary.threads.some((thread) => thread.id === 'thread-main')).toBe(true);
    expect(agent.calls.map((call) => call.operation)).toEqual([
      'BLUEPRINT',
      'CHAPTER_PLANS',
      'CHAPTER',
      'CHAPTER',
      'CHAPTER',
    ]);
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM jobs').get()).toMatchObject({
      count: 0,
    });
    const tts = service.scheduleChapterTts(chapters[0]!.id);
    expect(tts.jobIds.length).toBeGreaterThan(0);
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM jobs').get()).toMatchObject({
      count: tts.jobIds.length,
    });
    database.sqlite.close();
  });

  it('stores the exact bounded chapter prompt fingerprint for the worker guard', async () => {
    const { database, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryChapter('project', 'chapter-1');
    const row = database.sqlite
      .prepare(
        'SELECT input_fingerprint as inputFingerprint FROM workflow_steps WHERE execution_id=?',
      )
      .get(scheduled.executionId) as { inputFingerprint: string };
    expect(row.inputFingerprint).toBe(
      renderChapterGenerationPrompt(engine.story, engine.chapters, 'project', planItem)
        .inputFingerprint,
    );
    database.sqlite.close();
  });

  it('refreshes deferred plan fingerprints after staged blueprint execution', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    const scheduled = service.scheduleStoryStages('project');
    expect(scheduled.jobIds).toHaveLength(2);
    const blueprintStep = service.workflow.claim('worker')!;
    expect(blueprintStep.type).toBe('GENERATE_STORY_BLUEPRINT');
    await engine.executeStep(blueprintStep);
    service.workflow.complete(blueprintStep);
    const planStep = service.workflow.claim('worker')!;
    expect(planStep.type).toBe('GENERATE_CHAPTER_PLANS');
    await engine.executeStep(planStep);
    expect(planStep.input_fingerprint).not.toBe('');
    expect(
      database.sqlite
        .prepare('SELECT input_fingerprint as inputFingerprint FROM workflow_steps WHERE id=?')
        .get(planStep.id),
    ).toMatchObject({
      inputFingerprint: renderChapterPlansPrompt(
        engine.story.getSettings('project')!,
        engine.story.getBlueprint('project')!.blueprint,
      ).inputFingerprint,
    });
    service.workflow.complete(planStep);
    expect(engine.story.getPlan('project')?.revision).toBe(1);
    expect(agent.calls.map((call) => call.operation)).toEqual(['BLUEPRINT', 'CHAPTER_PLANS']);
    database.sqlite.close();
  });

  it('creates manual blueprint and plan revisions without mutating prior state', async () => {
    const { database, engine } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const editedPlan = engine.updatePlanItem('project', 'chapter-1', {
      ...planItem,
      title: 'Manually adjusted chapter',
    });
    expect(editedPlan.revision).toBe(2);
    expect(editedPlan.plan.items[0]?.title).toBe('Manually adjusted chapter');
    expect(engine.story.getPlan('project')?.metadata).toBeNull();
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) as count FROM story_plan_revisions WHERE revision=1')
        .get(),
    ).toMatchObject({ count: 1 });
    const editedBlueprint = engine.updateBlueprint('project', {
      ...blueprint,
      premise: 'A manually revised promise.',
    });
    expect(editedBlueprint.revision).toBe(2);
    expect(editedBlueprint.metadata).toBeNull();
    expect(engine.story.getBlueprintRevision('project', 1)).not.toBeNull();
    expect(engine.story.getPlan('project')).toBeNull();
    database.sqlite.close();
  });

  it('generates gap-free arcs and bounded independent plan windows', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    const arcs = await engine.generateArcs('project');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ startChapter: 1, endChapter: 3, ordinalIndex: 1 });
    const window = await engine.generatePlanWindow('project', 'arc-1', 1, 3);
    expect(window.window.arcId).toBe('arc-1');
    expect(window.items.map((item) => item.chapterNumber)).toEqual([1, 2, 3]);
    expect(agent.calls.map((call) => call.operation)).toEqual([
      'BLUEPRINT',
      'ARC_PLANNING',
      'CHAPTER_PLAN_WINDOW',
    ]);
    const editedArc = service.updateArc('project', 'arc-1', {
      ...arcs[0]!,
      title: 'The revised promise',
    });
    expect(editedArc.title).toBe('The revised promise');
    expect(engine.story.getPlanWindows('project')[0]?.window.status).toBe('STALE');
    const editedWindow = service.updatePlanWindow('project', 'window-1', {
      ...window,
      window: { ...window.window, status: 'STALE' },
    });
    expect(editedWindow.window.status).toBe('CURRENT');
    expect(engine.story.getPlanWindows('project')[0]?.window.status).toBe('CURRENT');
    database.sqlite.close();
  });

  it('pauses sequential batches on failure and resumes only after retry', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryBatch('project', { mode: 'NEXT', count: 3 });
    const workflow = service.workflow;
    const first = workflow.claim('batch-worker')!;
    expect(first.entity_id).toBe('chapter-1');
    workflow.fail(first, 'fixture failure', false);
    service.batches.reconcileWorkflowStep(first.id);
    expect(service.batches.get(scheduled.batch.id)?.status).toBe('PAUSED');
    expect(workflow.claim('batch-worker')).toBeNull();

    service.retryStoryBatchItem(scheduled.batch.id, 1);
    const retried = workflow.claim('batch-worker')!;
    await engine.executeStep(retried);
    workflow.complete(retried);
    service.batches.reconcileWorkflowStep(retried.id);
    const second = workflow.claim('batch-worker')!;
    expect(second.entity_id).toBe('chapter-2');
    expect(agent.calls.filter((call) => call.operation === 'CHAPTER_GENERATION_V2')).toHaveLength(
      1,
    );
    database.sqlite.close();
  });

  it('records a skipped chapter gap and releases only its immediate successor', async () => {
    const { database, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryBatch('project', { mode: 'NEXT', count: 3 });
    const first = service.workflow.claim('skip-worker')!;
    service.workflow.fail(first, 'chapter unavailable', false);
    service.batches.reconcileWorkflowStep(first.id);
    service.skipStoryBatchItem(scheduled.batch.id, 1, 'Source chapter unavailable');
    expect(service.batches.item(scheduled.batch.id, 1)).toMatchObject({
      outcome: 'SKIPPED',
      error: 'chapter unavailable',
      skipReason: 'Source chapter unavailable',
    });
    expect(service.story.getStoryState('project').gapMarkers).toEqual([
      { chapterNumber: 1, reason: 'Source chapter unavailable' },
    ]);
    expect(service.batches.get(scheduled.batch.id)?.status).toBe('RUNNING');
    const second = service.workflow.claim('skip-worker')!;
    expect(second.entity_id).toBe('chapter-2');
    service.batches.markRunning(second.id);
    await engine.executeStep(second);
    service.workflow.complete(second);
    service.batches.reconcileWorkflowStep(second.id);
    expect(service.batches.item(scheduled.batch.id, 2)?.outcome).toBe('COMPLETED');
    expect(service.story.getStoryState('project').currentChapter).toBe(2);
    database.sqlite.close();
  });

  it('cancels a partially completed batch without completing future chapters', async () => {
    const { database, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryBatch('project', { mode: 'NEXT', count: 3 });
    const first = service.workflow.claim('cancel-worker')!;
    service.batches.markRunning(first.id);
    await engine.executeStep(first);
    service.workflow.complete(first);
    service.batches.reconcileWorkflowStep(first.id);
    expect(service.batches.get(scheduled.batch.id)).toMatchObject({
      status: 'RUNNING',
      completed: 1,
    });
    const cancelled = service.cancelStoryBatch(scheduled.batch.id);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', completed: 1 });
    expect(service.batches.item(scheduled.batch.id, 1)).toMatchObject({ outcome: 'COMPLETED' });
    expect(service.batches.item(scheduled.batch.id, 2)).toMatchObject({ outcome: 'CANCELLED' });
    expect(service.batches.item(scheduled.batch.id, 3)).toMatchObject({ outcome: 'CANCELLED' });
    expect(engine.story.getStoryState('project').currentChapter).toBe(1);
    expect(service.workflow.claim('cancel-worker-2')).toBeNull();
    database.sqlite.close();
  });

  it('reuses a committed V2 chapter after lease recovery without another AI call', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryBatch('project', { mode: 'NEXT', count: 1 });
    const first = service.workflow.claim('recovery-worker')!;
    await engine.executeStep(first);
    expect(agent.calls.filter((call) => call.operation === 'CHAPTER_GENERATION_V2')).toHaveLength(
      1,
    );

    database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(0).toISOString(), first.id);
    expect(service.workflow.recoverExpired()).toBe(1);
    const recovered = service.workflow.claim('recovery-worker-2')!;
    await engine.executeStep(recovered);
    expect(agent.calls.filter((call) => call.operation === 'CHAPTER_GENERATION_V2')).toHaveLength(
      1,
    );
    service.workflow.complete(recovered);
    service.batches.reconcileWorkflowStep(recovered.id);
    expect(service.batches.get(scheduled.batch.id)?.status).toBe('COMPLETED');
    database.sqlite.close();
  });

  it('commits V2 chapter output, state delta, lineage, and usage atomically', async () => {
    const { database, agent, engine } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const result = await engine.generateChapterV2('project', 'chapter-1');
    const chapter = engine.chapters.get(result.chapterId)!;
    expect(chapter.origin).toBe('GENERATED');
    expect(chapter.continuityStatus).toBe('CURRENT');
    expect(result.stateRevisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(engine.story.getStoryState('project').currentChapter).toBe(1);
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) as count FROM story_state_deltas WHERE source_chapter_id=?')
        .get(result.chapterId),
    ).toMatchObject({ count: 1 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) as count FROM ai_usage WHERE operation=?')
        .get('CHAPTER_GENERATION_V2'),
    ).toMatchObject({ count: 1 });
    expect(agent.calls.at(-1)?.operation).toBe('CHAPTER_GENERATION_V2');
    database.sqlite.close();
  });
  it('rolls back V2 finalization when a late transactional insert fails', async () => {
    const { database, engine } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const initialState = engine.story.getStoryState('project');
    const envelope = chapterGenerationV2EnvelopeSchema.parse({
      title: 'The Unopened Door',
      content: 'Mai takes the sealed letter and walks toward the gate.',
      summary: {
        recap: 'Mai accepts the sealed letter.',
        keyFacts: ['Mai has the letter.'],
        characterStateChanges: [{ characterId: 'mai', change: 'accepts the route' }],
        newInformation: ['The seal bears Mai’s name.'],
        openThreadIds: [],
        resolvedThreadIds: [],
      },
      stateDelta: {
        characterUpdates: [{ characterId: 'mai', currentGoal: 'finish the route' }],
        threadUpdates: [],
        newThreads: [],
        facts: [],
        events: [],
        arcProgress: [],
        gapMarkers: [],
      },
      usedCharacterIds: ['mai'],
      introducedCharacterIds: [],
      unresolvedThreadIds: [],
      continuityWarnings: [],
    });
    const nextState = reduceStoryState(initialState, envelope.stateDelta, {
      projectId: 'project',
      chapterNumber: 1,
      blueprint: engine.story.getBlueprint('project')!.blueprint,
      arcs: [],
      chapterSummary: envelope.summary,
    }).state;
    const stamp = '2026-01-01T00:00:00.000Z';
    const generationId = engine.story.createGenerationRecord(
      'project',
      'CHAPTER_GENERATION_V2',
      'chapter-1',
      null,
      'a'.repeat(64),
      {},
      'RUNNING',
    );
    const metadata = {
      operation: 'CHAPTER_GENERATION_V2' as const,
      inputFingerprint: 'a'.repeat(64),
      provider: 'fixture',
      model: 'fixture',
      promptVersion: 'test',
      schemaVersion: 'test',
      startedAt: stamp,
      completedAt: stamp,
      durationMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      costCurrency: 'USD',
      finishReason: 'stop',
      attempt: 1,
      contextHash: null,
      omittedContext: [],
    };
    const usage: AiUsage = {
      id: randomUUID(),
      projectId: 'missing-project',
      operation: 'CHAPTER_GENERATION_V2',
      entityId: 'chapter-1',
      attempt: 1,
      provider: 'fixture',
      model: 'fixture',
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      costUsd: 0,
      currency: 'USD',
      status: 'SUCCEEDED',
      createdAt: stamp,
    };
    const usageBefore = (
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM ai_usage WHERE project_id='project'")
        .get() as { count: number }
    ).count;
    expect(() =>
      engine.story.commitGeneratedChapterV2({
        projectId: 'project',
        planItemId: 'chapter-1',
        generationId,
        envelope,
        state: nextState,
        metadata,
        usage,
        inputFingerprint: 'a'.repeat(64),
      }),
    ).toThrow();
    expect(engine.story.getStoryState('project')).toMatchObject({ revision: 1, currentChapter: 0 });
    expect(engine.chapters.listMetadata('project')).toHaveLength(0);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_state_deltas WHERE project_id='project'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_chapter_lineage WHERE project_id='project'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM ai_usage WHERE project_id='project'")
        .get(),
    ).toMatchObject({ count: usageBefore });
    expect(
      database.sqlite
        .prepare('SELECT status FROM story_generation_records WHERE id=?')
        .get(generationId),
    ).toMatchObject({ status: 'RUNNING' });
    database.sqlite.close();
  });
  it('leaves the prior checkpoint and workflow step incomplete on reducer failure', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', {
      ...settings,
      generation: { maxRetries: 0 },
    });
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    agent.invalidV2Output = true;
    service.scheduleStoryChapterV2('project', 'chapter-1');
    const step = service.workflow.claim('transaction-worker')!;
    await expect(engine.executeStep(step)).rejects.toMatchObject({
      code: 'STRUCTURED_OUTPUT_ERROR',
    });
    expect(service.workflow.getStep(step.id)?.status).toBe('RUNNING');
    expect(engine.story.getStoryState('project')).toMatchObject({ revision: 1, currentChapter: 0 });
    expect(engine.chapters.listMetadata('project')).toHaveLength(0);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_state_deltas WHERE project_id='project'")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.sqlite
        .prepare('SELECT status FROM story_generation_records WHERE workflow_step_id=?')
        .get(step.id),
    ).toMatchObject({ status: 'FAILED' });
    database.sqlite.close();
  });

  it('accepts reviewed manual analysis from a prior checkpoint', async () => {
    const { database, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    await engine.generateChapterV2('project', 'chapter-1');
    await engine.generateChapterV2('project', 'chapter-2');
    const first = engine.chapters.getByPlanItem('project', 'chapter-1')!;
    service.updateChapter(first.id, {
      title: first.title,
      content: 'Mai revises the delivery instructions.',
      expectedRevision: first.revision,
    });
    expect(
      database.sqlite
        .prepare(
          'SELECT story_generation_id as storyGenerationId,source_state_revision as sourceStateRevision FROM chapters WHERE id=?',
        )
        .get(first.id),
    ).toMatchObject({ storyGenerationId: null, sourceStateRevision: null });
    await engine.analyzeChapter(first.id);
    const check = engine.story
      .getContinuityChecks('project')
      .find((candidate) => candidate.chapterId === first.id)!;
    const accepted = engine.acceptManualAnalysis(first.id, check.id);
    expect(accepted.state.currentChapter).toBe(1);
    expect(engine.story.getStoryState('project').currentChapter).toBe(1);
    expect(engine.chapters.get(first.id)?.continuityStatus).toBe('CURRENT');
    expect(engine.chapters.getByPlanItem('project', 'chapter-2')?.continuityStatus).toBe(
      'CONTINUITY_STALE',
    );
    expect(engine.story.getContinuityCheck(check.id)?.acceptedAt).not.toBeNull();
    database.sqlite.close();
  });

  it('regenerates an earlier V2 chapter while preserving later content and media', async () => {
    const { database, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    await engine.generateChapterV2('project', 'chapter-1');
    await engine.generateChapterV2('project', 'chapter-2');
    await engine.generateChapterV2('project', 'chapter-3');
    const second = engine.chapters.getByPlanItem('project', 'chapter-2')!;
    database.sqlite
      .prepare(
        "INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,is_current,created_at,updated_at,source_entity_id) VALUES('later-audio','project','CHAPTER_AUDIO',?,'READY','later.mp3','audio/mpeg',1,'later',1,'2026-01-01','2026-01-01',?)",
      )
      .run(`chapter:${second.id}:audio`, second.id);
    const scheduled = service.scheduleStoryChapterV2('project', 'chapter-1');
    expect(scheduled.jobId).toBeTruthy();
    const historicalStep = service.workflow.claim('historical-worker');
    expect(historicalStep?.id).toBeTruthy();
    await engine.executeStep(historicalStep!);
    service.workflow.complete(historicalStep!);
    const regenerated = engine.chapters.getByPlanItem('project', 'chapter-1')!;
    expect(regenerated.revision).toBe(2);
    expect(engine.story.getStoryState('project')).toMatchObject({ currentChapter: 1 });
    expect(engine.chapters.get(second.id)?.continuityStatus).toBe('CONTINUITY_STALE');
    expect(
      database.sqlite
        .prepare("SELECT is_current as isCurrent FROM assets WHERE id='later-audio'")
        .get(),
    ).toMatchObject({ isCurrent: 1 });
    database.sqlite
      .prepare(
        'INSERT INTO story_important_facts(id,project_id,stable_id,text,importance,introduced_chapter,last_confirmed_chapter,status,source_state_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'stale-fact-row',
        'project',
        'stale-fact',
        'A fact from a discarded branch.',
        'HIGH',
        1,
        1,
        'ACTIVE',
        null,
        '2026-01-01',
        '2026-01-01',
      );
    const rebuilt = engine.rebuildContinuity('project', 2);
    expect(rebuilt.appliedChapterNumbers).toEqual([2, 3]);
    expect(rebuilt.state.currentChapter).toBe(3);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_important_facts WHERE stable_id='stale-fact'")
        .get(),
    ).toMatchObject({ count: 0 });
    database.sqlite.close();
  });

  it('marks later generated chapters stale after regenerating an earlier chapter', async () => {
    const { database, engine } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    await engine.generateChapter('project', 'chapter-1');
    const second = await engine.generateChapter('project', 'chapter-2');
    expect(engine.chapters.get(second.chapterId)?.continuityStatus).toBe('CURRENT');
    const regenerated = await engine.generateChapter('project', 'chapter-1');
    expect(regenerated.chapterRevision).toBe(2);
    expect(engine.chapters.get(second.chapterId)?.continuityStatus).toBe('CONTINUITY_STALE');
    database.sqlite.close();
  });

  it('does not overwrite a later manual chapter edit', async () => {
    const { database, engine } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const generated = await engine.generateChapter('project', 'chapter-1');
    const chapter = engine.chapters.get(generated.chapterId)!;
    engine.chapters.update(chapter.id, {
      title: chapter.title,
      content: 'Manual replacement',
      expectedRevision: chapter.revision,
    });
    await expect(engine.generateChapter('project', 'chapter-1')).rejects.toMatchObject({
      code: 'MANUAL_EDIT_CONFLICT',
    });
    expect(engine.chapters.get(chapter.id)?.content).toBe('Manual replacement');
    database.sqlite.close();
  });
});
