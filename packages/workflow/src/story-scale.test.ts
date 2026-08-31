import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import { ProcessRunner } from '@studio/media';
import type { AiAgent, AiAgentRequest, AiAgentResult } from './omp-agent.js';
import { StoryEngine } from './story-engine.js';
import { StudioService } from './index.js';

const settings = {
  mode: 'IDEA_TO_STORY' as const,
  idea: 'A courier keeps a promise through a city that forgets.',
  language: 'vi-VN',
  genre: 'fantasy',
  tone: 'reflective',
  audience: 'general',
  targetChapterCount: 200,
  chapterLength: 200,
  pacing: 'MEDIUM' as const,
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {
    contextBudget: 700,
    maxOutputTokens: 256,
    maxChaptersPerBatch: 25,
    maxRetries: 1,
    continuityChecksEnabled: false,
  },
};

const blueprint = {
  premise: 'A courier keeps a promise.',
  themes: ['duty'],
  worldRules: ['Memories have a price.'],
  continuityConstraints: ['The courier never abandons a delivery.'],
  plotDirection: 'The promise changes the city.',
  characters: [
    {
      id: 'hero',
      name: 'Hero',
      role: 'courier',
      ageRange: 'adult',
      appearance: 'dark coat',
      personality: 'careful',
      wants: 'keep the promise',
      fears: 'being forgotten',
      traits: ['observant'],
      relationships: [],
      backstory: 'Inherited a dangerous route.',
      voice: 'quiet',
      arc: 'from duty to choice',
    },
  ],
};

function planItem(chapterNumber: number) {
  return {
    id: `chapter-${chapterNumber}`,
    chapterNumber,
    title: `Chapter ${chapterNumber}`,
    purpose: 'Advance the promise.',
    summary: `The courier faces obstacle ${chapterNumber}.`,
    setting: 'old city',
    characterIds: ['hero'],
    conflict: 'The route is dangerous.',
    turningPoints: ['The courier chooses to continue.'],
    resolution: 'The promise remains active.',
    emotionalArc: 'doubt to resolve',
    estimatedWordCount: 200,
    threadIds: ['thread-main'],
  };
}

class ScaleAgent implements AiAgent {
  readonly calls: AiAgentRequest[] = [];

  constructor(private readonly planCount: number) {}

  async generate(request: AiAgentRequest): Promise<AiAgentResult> {
    this.calls.push(request);
    let text: string;
    if (request.operation === 'BLUEPRINT') text = JSON.stringify(blueprint);
    else if (request.operation === 'CHAPTER_PLANS')
      text = JSON.stringify({
        items: Array.from({ length: this.planCount }, (_, index) => planItem(index + 1)),
      });
    else if (request.operation === 'ARC_PLANNING')
      text = JSON.stringify({
        arcs: [
          {
            id: 'arc-1',
            ordinalIndex: 1,
            startChapter: 1,
            endChapter: this.planCount,
            title: 'The promise',
            goal: 'Carry the promise across the city.',
            conflict: 'The city forgets every delivery.',
            importantCharacterIds: ['hero'],
            importantThreadIds: [],
            plannedOutcome: 'The promise changes the city.',
            status: 'PLANNED',
            sourceBlueprintRevision: 1,
            inputFingerprint: null,
          },
        ],
      });
    else if (request.operation === 'CHAPTER_PLAN_WINDOW') {
      const match = /<window>\n\{"endChapter":(\d+),"startChapter":(\d+)\}/.exec(
        request.userPrompt,
      );
      const startChapter = Number(match?.[2] ?? 1);
      const endChapter = Number(match?.[1] ?? startChapter);
      text = JSON.stringify({
        window: {
          id: `window-${startChapter}`,
          startChapter,
          endChapter,
          arcId: 'arc-1',
          sourceBlueprintRevision: 1,
          priorWindowSummary: null,
          inputFingerprint: null,
          status: 'CURRENT',
        },
        items: Array.from({ length: endChapter - startChapter + 1 }, (_, index) =>
          planItem(startChapter + index),
        ),
      });
    } else if (request.operation === 'CHAPTER_GENERATION_V2') {
      const chapterNumber = Number(/"chapterNumber"\s*:\s*(\d+)/.exec(request.userPrompt)?.[1]);
      const first = chapterNumber === 1;
      text = JSON.stringify({
        title: `Chapter ${chapterNumber}`,
        content: `The courier advances through checkpoint ${chapterNumber}.`,
        summary: {
          recap: `The courier reaches checkpoint ${chapterNumber}.`,
          keyFacts: [`Checkpoint ${chapterNumber} is known.`],
          characterStateChanges: [{ characterId: 'hero', change: `advances at ${chapterNumber}` }],
          newInformation: [`The route includes checkpoint ${chapterNumber}.`],
          openThreadIds: ['thread-main'],
          resolvedThreadIds: [],
        },
        stateDelta: {
          characterUpdates: [
            {
              characterId: 'hero',
              currentGoal: 'keep the promise',
              knowledge: [`checkpoint-${chapterNumber}`],
            },
          ],
          threadUpdates: first
            ? []
            : [{ threadId: 'thread-main', note: `touched at ${chapterNumber}` }],
          newThreads: first
            ? [
                {
                  id: 'thread-main',
                  title: 'The promise',
                  description: 'A promise must be kept.',
                  type: 'PROMISE',
                  expectedResolutionEnd: this.planCount,
                  importance: 'HIGH',
                  characterIds: ['hero'],
                  expectedResolutionStart: null,
                },
              ]
            : [],
          facts: [
            {
              id: 'fact-route',
              text: `Checkpoint ${chapterNumber} is part of the route.`,
              importance: 'MEDIUM',
              introducedChapter: 1,
              lastConfirmedChapter: chapterNumber,
              status: 'ACTIVE',
            },
          ],
          events: [
            {
              id: `event-${chapterNumber}`,
              chapterNumber,
              type: 'PROGRESS',
              description: `The courier reaches checkpoint ${chapterNumber}.`,
              importance: 'MEDIUM',
              characterIds: ['hero'],
              threadIds: ['thread-main'],
            },
          ],
          arcProgress: [],
          gapMarkers: [],
        },
        usedCharacterIds: ['hero'],
        introducedCharacterIds: [],
        unresolvedThreadIds: ['thread-main'],
        continuityWarnings: [],
      });
    } else text = JSON.stringify({ status: 'PASS', issues: [] });
    return {
      operation: request.operation,
      text,
      provider: 'scale-fake',
      model: 'scale-fake-model',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      durationMs: 1,
    };
  }
}

async function setup(planCount = 200) {
  const root = await mkdtemp(join(tmpdir(), 'studio-story-scale-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Scale','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  const agent = new ScaleAgent(planCount);
  const engine = new StoryEngine({ database, agent });
  const service = new StudioService({
    database,
    workspace: {} as never,
    media: {} as never,
    runner: new ProcessRunner(),
  });
  return { database, agent, engine, service };
}

function expectErrorCode(action: () => unknown, code: string): void {
  let error: unknown;
  try {
    action();
  } catch (cause) {
    error = cause;
  }
  expect(error).toMatchObject({ code });
}

async function finishBatch(
  service: StudioService,
  engine: StoryEngine,
  worker: string,
  batchId: string,
): Promise<number> {
  let completed = 0;
  while (service.batches.get(batchId)?.status !== 'COMPLETED') {
    const step = service.workflow.claim(worker);
    if (!step) throw new Error(`Batch ${batchId} lost a runnable step`);
    service.batches.markRunning(step.id);
    await engine.executeStep(step);
    service.workflow.complete(step);
    service.batches.reconcileWorkflowStep(step.id);
    completed += 1;
  }
  return completed;
}

describe('long-story scale mechanics', () => {
  it('runs a 20-chapter sequential integration with state and media handoff boundaries', async () => {
    const { database, agent, engine, service } = await setup(20);
    engine.saveSettings('project', {
      ...settings,
      targetChapterCount: 20,
      generation: { ...settings.generation, maxChaptersPerBatch: 20 },
    });
    await engine.generateBlueprint('project');
    await engine.generatePlans('project');
    const scheduled = service.scheduleStoryBatch('project', { mode: 'NEXT', count: 20 });
    let completed = 0;
    while (service.batches.get(scheduled.batch.id)?.status !== 'COMPLETED') {
      const step = service.workflow.claim('twenty-worker');
      if (!step) throw new Error('Twenty-chapter fixture lost a runnable step');
      service.batches.markRunning(step.id);
      await engine.executeStep(step);
      service.workflow.complete(step);
      service.batches.reconcileWorkflowStep(step.id);
      completed += 1;
    }
    const state = engine.story.getStoryState('project');
    expect(completed).toBe(20);
    expect(state.currentChapter).toBe(20);
    expect(
      state.characterStates.find((character) => character.characterId === 'hero')?.knowledge,
    ).toContain('checkpoint-20');
    expect(state.threads).toHaveLength(1);
    expect(state.importantFacts).toHaveLength(1);
    expect(state.recentEvents).toHaveLength(20);
    expect(engine.chapters.listMetadata('project')).toHaveLength(20);
    expect(agent.calls.filter((call) => call.operation === 'CHAPTER_GENERATION_V2')).toHaveLength(
      20,
    );
    expect(engine.story.getUsageSummary('project')).toMatchObject({
      operations: 22,
      unavailableCount: 0,
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) as count FROM jobs WHERE type IN ('TTS_SEGMENT','SUBTITLE','RENDER')",
        )
        .get(),
    ).toMatchObject({ count: 0 });
    database.sqlite.close();
  }, 120_000);

  it('simulates 200 sequential chapters with restart, failure, retry, and duplicate protection', async () => {
    const { database, agent, engine, service } = await setup();
    engine.saveSettings('project', settings);
    await engine.generateBlueprint('project');
    await engine.generateArcs('project');
    for (let startChapter = 1; startChapter <= 200; startChapter += 20)
      await engine.generatePlanWindow('project', 'arc-1', startChapter, startChapter + 19);
    const ranges = [
      [1, 25],
      [26, 50],
      [51, 75],
      [76, 100],
      [101, 125],
      [126, 150],
      [151, 175],
      [176, 200],
    ] as const;
    const batches = [] as Array<{ batch: { id: string }; executionId: string; jobIds: string[] }>;
    for (const [startChapter, endChapter] of ranges) {
      const scheduled = service.scheduleStoryBatch('project', {
        mode: 'RANGE',
        startChapter,
        endChapter,
      });
      batches.push(scheduled);
      if (startChapter === 51) {
        while (true) {
          const step = service.workflow.claim('scale-worker');
          if (!step) throw new Error('Restart fixture lost chapter 73');
          service.batches.markRunning(step.id);
          if (step.entity_id !== 'chapter-73') {
            await engine.executeStep(step);
            service.workflow.complete(step);
            service.batches.reconcileWorkflowStep(step.id);
            continue;
          }
          await engine.executeStep(step);
          database.sqlite
            .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
            .run(new Date(0).toISOString(), step.id);
          expect(service.workflow.recoverExpired()).toBe(1);
          expect(service.batches.reconcileRecoveredSteps()).toBe(1);
          const recovered = service.workflow.claim('scale-worker-restart');
          expect(recovered?.entity_id).toBe('chapter-73');
          service.batches.markRunning(recovered!.id);
          await engine.executeStep(recovered!);
          service.workflow.complete(recovered!);
          service.batches.reconcileWorkflowStep(recovered!.id);
          break;
        }
        await finishBatch(service, engine, 'scale-worker', scheduled.batch.id);
      } else if (startChapter === 101) {
        while (true) {
          const step = service.workflow.claim('scale-worker');
          if (!step) throw new Error('Failure fixture lost chapter 121');
          service.batches.markRunning(step.id);
          if (step.entity_id !== 'chapter-121') {
            await engine.executeStep(step);
            service.workflow.complete(step);
            service.batches.reconcileWorkflowStep(step.id);
            continue;
          }
          service.workflow.fail(step, 'fixture failure at chapter 121', false);
          service.batches.reconcileWorkflowStep(step.id);
          break;
        }
        expect(service.batches.get(scheduled.batch.id)?.status).toBe('PAUSED');
        service.retryStoryBatchItem(scheduled.batch.id, 121);
        await finishBatch(service, engine, 'scale-worker-retry', scheduled.batch.id);
      } else if (startChapter === 126) {
        const workflowCount = database.sqlite
          .prepare('SELECT COUNT(*) as count FROM workflow_executions WHERE project_id=?')
          .get('project') as { count: number };
        expectErrorCode(
          () => service.scheduleStoryBatch('project', { mode: 'RANGE', startChapter, endChapter }),
          'BATCH_CONFLICT',
        );
        expect(
          database.sqlite
            .prepare('SELECT COUNT(*) as count FROM workflow_executions WHERE project_id=?')
            .get('project'),
        ).toMatchObject(workflowCount);
        expectErrorCode(
          () => service.scheduleStoryChapterV2('project', 'chapter-126'),
          'WORKFLOW_CONFLICT',
        );
        await finishBatch(service, engine, 'scale-worker', scheduled.batch.id);
      } else {
        await finishBatch(service, engine, 'scale-worker', scheduled.batch.id);
      }
    }

    expect(engine.story.getStoryState('project').currentChapter).toBe(200);
    expect(engine.chapters.listMetadata('project')).toHaveLength(200);
    expect(engine.story.getSummaries('project', 200, 0)).toHaveLength(200);
    expect(agent.calls.filter((call) => call.operation === 'CHAPTER_GENERATION_V2')).toHaveLength(
      200,
    );
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) as count FROM story_state_revisions WHERE project_id=?')
        .get('project'),
    ).toMatchObject({ count: 201 });
    expect(
      database.sqlite
        .prepare('SELECT COUNT(*) as count FROM story_generation_batches WHERE project_id=?')
        .get('project'),
    ).toMatchObject({ count: 8 });
    expect(service.batches.list('project').every((batch) => batch.status === 'COMPLETED')).toBe(
      true,
    );
    expect(
      service.batches.list('project').reduce((total, batch) => total + batch.completed, 0),
    ).toBe(200);
    const prompts = agent.calls
      .filter((call) => call.operation === 'CHAPTER_GENERATION_V2')
      .map((call) => call.userPrompt.length);
    expect(Math.max(...prompts)).toBeLessThan(30_000);
    expect(prompts.at(-1)).toBeLessThan(prompts[0]! * 4);
    const usageSummary = engine.story.getUsageSummary('project');
    expect(usageSummary).toMatchObject({
      operations: 212,
      knownInputTokens: 212,
      knownOutputTokens: 212,
      unavailableCount: 0,
    });
    const diagnostics = [
      ...engine.story.getContextDiagnostics('project', 100, 0),
      ...engine.story.getContextDiagnostics('project', 100, 100),
    ]
      .map((item) => item.contextDiagnostics)
      .filter((item): item is NonNullable<typeof item> => item !== null);
    expect(diagnostics).toHaveLength(200);
    expect(Math.max(...diagnostics.map((item) => item.estimatedTokens))).toBeLessThanOrEqual(700);
    expect(diagnostics.every((item) => item.selectedSections.includes('plan-item'))).toBe(true);
    database.sqlite.close();
  }, 120_000);
});
