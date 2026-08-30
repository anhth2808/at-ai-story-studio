import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import { ProcessRunner } from '@studio/media';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { StoryEngine, renderChapterGenerationPrompt } from './story-engine.js';
import { renderChapterPlansPrompt } from './story-prompts.js';
import { StudioService } from './index.js';

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
  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    let text: string;
    if (request.operation === 'BLUEPRINT') text = JSON.stringify(blueprint);
    else if (request.operation === 'CHAPTER_PLANS') text = JSON.stringify(plan);
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
    return {
      operation: request.operation,
      text,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
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
