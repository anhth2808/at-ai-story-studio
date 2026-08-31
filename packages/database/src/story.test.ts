import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  ChapterRepository,
  StoryRepository,
  WorkflowRepository,
  createDatabase,
  migrateDatabase,
} from './index.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-story-db-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}
async function setupLegacyDatabase() {
  const root = await mkdtemp(join(tmpdir(), 'studio-story-legacy-'));
  const database = createDatabase(join(root, 'studio.db'));
  const priorMigrations = [
    '0000_initial',
    '0001_status_constraints',
    '0002_story_engine',
    '0003_story_continuity_outputs',
  ];
  for (const migration of priorMigrations) {
    database.sqlite.exec(
      readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'),
    );
    if (migration === '0000_initial')
      database.sqlite.exec(
        'CREATE TABLE IF NOT EXISTS _studio_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
      );
    database.sqlite
      .prepare('INSERT INTO _studio_migrations(id,applied_at) VALUES(?,?)')
      .run(migration, '2026-01-01T00:00:00.000Z');
  }
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Legacy','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,story_origin,story_plan_item_id,story_generation_id,created_at,updated_at) VALUES('manual','project',1,'Manual','Manual text','ACTIVE',1,1,'MANUAL',NULL,NULL,'2026-01-01','2026-01-01'),('generated','project',2,'Generated','Generated text','ACTIVE',1,1,'GENERATED','chapter-2',NULL,'2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,warnings,metadata,input_fingerprint,status,is_current,created_at,events,thread_transitions) VALUES('summary','generated',1,1,'{\"recap\":\"Legacy recap\",\"keyFacts\":[],\"characterStateChanges\":[],\"newInformation\":[],\"openThreadIds\":[],\"resolvedThreadIds\":[]}','[]',NULL,'legacy','CURRENT',1,'2026-01-01','[]','[]')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,is_current,created_at,updated_at) VALUES('legacy-audio','project','CHAPTER_AUDIO','chapter:generated:audio','READY','legacy/audio.mp3','audio/mpeg',12,'legacy',1,'2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}

const settings = {
  mode: 'IDEA_TO_STORY' as const,
  idea: 'A quiet courier discovers a hidden promise in an old city.',
  language: 'vi-VN',
  genre: 'fantasy',
  tone: 'reflective',
  audience: 'general',
  chapterLength: 800,
  targetChapterCount: 1,
  pacing: 'MEDIUM' as const,
  contentBoundaries: [],
  characterNotes: '',
  worldNotes: '',
  plotRequirements: '',
  generation: {},
};

const blueprint = {
  premise: 'A courier must keep a promise while a city forgets its own history.',
  themes: ['promise'],
  worldRules: ['Memories can be traded for a price.'],
  continuityConstraints: ['The courier never abandons a delivery.'],
  plotDirection: 'The delivery reveals who erased the city archive.',
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

const plan = {
  items: [
    {
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
      threadIds: ['missing-recipient'],
    },
  ],
};

describe('story repository', () => {
  it('persists current revision chains and chapter lineage', async () => {
    const database = await setup();
    const chapters = new ChapterRepository(database);
    const story = new StoryRepository(database);
    const chapter = chapters.create('project', { title: 'Manual', content: 'Text' });
    expect(chapter.origin).toBe('MANUAL');

    const savedSettings = story.saveSettings('project', settings);
    expect(savedSettings.revision).toBe(1);
    const savedSettingsAgain = story.saveSettings('project', { ...settings, tone: 'warm' });
    expect(savedSettingsAgain.revision).toBe(2);
    expect(story.getSettings('project')?.tone).toBe('warm');

    const savedBlueprint = story.saveBlueprint(
      'project',
      story.getSettingsRevision('project', 2)!.id,
      blueprint,
      null,
      story.fingerprint(blueprint),
    );
    const savedPlan = story.savePlan(
      'project',
      story.getBlueprintRevision('project', savedBlueprint.revision)!.id,
      plan,
      null,
      story.fingerprint(plan),
    );
    expect(savedPlan.plan.items[0]?.id).toBe('chapter-1');
    expect(story.getPlanItem('project', 'chapter-1')?.item.title).toBe('The Unopened Door');
    const savedArcs = story.saveArcs(
      'project',
      savedBlueprint.revision,
      {
        arcs: [
          {
            id: 'arc-1',
            ordinalIndex: 1,
            startChapter: 1,
            endChapter: 1,
            title: 'The first promise',
            goal: 'Keep the delivery moving.',
            conflict: 'The recipient has vanished.',
            importantCharacterIds: ['mai'],
            importantThreadIds: [],
            plannedOutcome: 'Mai chooses responsibility.',
            status: 'PLANNED',
            sourceBlueprintRevision: savedBlueprint.revision,
            inputFingerprint: null,
          },
        ],
      },
      null,
      story.fingerprint('arc'),
    );
    expect(savedArcs[0]).toMatchObject({ id: 'arc-1', ordinalIndex: 1 });
    const savedWindow = story.savePlanWindow('project', {
      window: {
        id: 'window-1',
        startChapter: 1,
        endChapter: 1,
        arcId: 'arc-1',
        sourceBlueprintRevision: savedBlueprint.revision,
        priorWindowSummary: null,
        inputFingerprint: null,
        status: 'CURRENT',
      },
      items: [plan.items[0]!],
    });
    expect(savedWindow.window.status).toBe('CURRENT');
    const savedArc = savedArcs[0]!;
    const editedArc = story.saveArc(
      'project',
      { ...savedArc, title: 'The revised promise' },
      null,
      story.fingerprint('manual-arc'),
    );
    expect(editedArc.title).toBe('The revised promise');
    expect(story.getPlanWindowSummaries('project')).toMatchObject([
      { window: { id: 'window-1' }, itemCount: 1 },
    ]);
    expect(story.getPlanWindows('project')[0]?.window.status).toBe('CURRENT');
    expect(story.markArcDependentsStale('project', 'arc-1')).toEqual(['chapter-1']);
    expect(story.getPlanWindows('project')[0]?.window.status).toBe('STALE');
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) as count FROM story_arc_revisions WHERE project_id=? AND stable_id=?',
        )
        .get('project', 'arc-1'),
    ).toMatchObject({ count: 2 });

    const generationId = story.createGenerationRecord(
      'project',
      'CHAPTER',
      'chapter-1',
      null,
      'fingerprint',
      {},
      'COMPLETED',
    );
    const generated = chapters.createGenerated(
      'project',
      { title: 'The Unopened Door', content: 'Generated text' },
      'chapter-1',
      generationId,
    );
    expect(generated.origin).toBe('GENERATED');
    expect(generated.storyPlanItemId).toBe('chapter-1');
    expect(generated.storyGenerationId).toBe(generationId);

    database.sqlite.close();
  });

  it('invalidates only the selected plan item and its media descendants', async () => {
    const database = await setup();
    const chapters = new ChapterRepository(database);
    const story = new StoryRepository(database);
    const workflow = new WorkflowRepository(database);
    const chapterOne = chapters.create('project', { title: 'One', content: 'One' });
    const chapterTwo = chapters.create('project', { title: 'Two', content: 'Two' });
    database.sqlite
      .prepare('UPDATE chapters SET story_plan_item_id=? WHERE id=?')
      .run('chapter-1', chapterOne.id);
    database.sqlite
      .prepare('UPDATE chapters SET story_plan_item_id=? WHERE id=?')
      .run('chapter-2', chapterTwo.id);
    story.saveSummary(
      chapterOne.id,
      chapterOne.revision,
      {
        recap: 'One recap',
        keyFacts: [],
        characterStateChanges: [],
        newInformation: [],
        openThreadIds: [],
        resolvedThreadIds: [],
      },
      [],
      null,
      'summary-fingerprint',
    );

    const executionId = workflow.createExecution('project', 'STORY');
    const chapterOneStep = workflow.createStep(
      executionId,
      'chapter-one',
      'GENERATE_CHAPTER',
      chapterOne.id,
      'one',
    );
    const chapterTwoStep = workflow.createStep(
      executionId,
      'chapter-two',
      'GENERATE_CHAPTER',
      chapterTwo.id,
      'two',
    );
    const renderStep = workflow.createStep(executionId, 'render', 'RENDER', 'project', 'render');
    workflow.markCompleted(chapterOneStep);
    workflow.markCompleted(chapterTwoStep);
    workflow.markCompleted(renderStep);
    database.sqlite
      .prepare(
        "INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,is_current,created_at,updated_at) VALUES('audio-one','project','CHAPTER_AUDIO',?,?, 'audio.mp3','audio/mpeg',1,'one',1,'2026-01-01','2026-01-01'),('render','project','RENDERED_VIDEO','project:render','READY','render.mp4','video/mp4',1,'render',1,'2026-01-01','2026-01-01')",
      )
      .run(`chapter:${chapterOne.id}:audio`, 'READY');

    expect(
      story.invalidateScope({ projectId: 'project', kind: 'PLAN_ITEM', stableId: 'chapter-1' }),
    ).toBeGreaterThan(0);
    expect(workflow.getStep(chapterOneStep)?.status).toBe('INVALIDATED');
    expect(workflow.getStep(chapterTwoStep)?.status).toBe('COMPLETED');
    expect(workflow.getStep(renderStep)?.status).toBe('INVALIDATED');
    expect(story.getSummary(chapterOne.id)).toBeNull();
    expect(
      database.sqlite
        .prepare("SELECT is_current as isCurrent FROM assets WHERE role='project:render'")
        .get(),
    ).toMatchObject({ isCurrent: 0 });
    database.sqlite.close();
  });

  it.each(['SETTINGS', 'BLUEPRINT', 'PLAN'] as const)(
    'invalidates generated descendants for a %s change without touching manual chapters',
    async (kind) => {
      const database = await setup();
      const chapters = new ChapterRepository(database);
      const story = new StoryRepository(database);
      const workflow = new WorkflowRepository(database);
      const savedSettings = story.saveSettings('project', settings);
      const savedBlueprint = story.saveBlueprint(
        'project',
        story.getSettingsRevision('project', savedSettings.revision)!.id,
        blueprint,
        null,
        story.fingerprint(blueprint),
      );
      story.savePlan(
        'project',
        story.getBlueprintRevision('project', savedBlueprint.revision)!.id,
        plan,
        null,
        story.fingerprint(plan),
      );
      const generationId = story.createGenerationRecord(
        'project',
        'CHAPTER',
        'chapter-1',
        null,
        'fingerprint',
        {},
        'COMPLETED',
      );
      const generated = chapters.createGenerated(
        'project',
        { title: 'Generated', content: 'Generated content' },
        'chapter-1',
        generationId,
      );
      const manual = chapters.create('project', { title: 'Manual', content: 'Manual content' });
      story.saveSummary(
        generated.id,
        generated.revision,
        {
          recap: 'Generated recap',
          keyFacts: [],
          characterStateChanges: [],
          newInformation: [],
          openThreadIds: [],
          resolvedThreadIds: [],
        },
        [],
        null,
        'summary-fingerprint',
      );
      const executionId = workflow.createExecution('project', 'STORY');
      const blueprintStep = workflow.createStep(
        executionId,
        'blueprint',
        'GENERATE_STORY_BLUEPRINT',
        'project',
        'blueprint',
      );
      const planStep = workflow.createStep(
        executionId,
        'plan',
        'GENERATE_CHAPTER_PLANS',
        'project',
        'plan',
      );
      const generatedChapterStep = workflow.createStep(
        executionId,
        'generated-chapter',
        'GENERATE_CHAPTER',
        generated.id,
        'chapter',
      );
      const manualChapterStep = workflow.createStep(
        executionId,
        'manual-chapter',
        'GENERATE_CHAPTER',
        manual.id,
        'manual',
      );
      const summaryStep = workflow.createStep(
        executionId,
        'summary',
        'GENERATE_CHAPTER_SUMMARY',
        generated.id,
        'summary',
      );
      const renderStep = workflow.createStep(executionId, 'render', 'RENDER', 'project', 'render');
      for (const stepId of [
        blueprintStep,
        planStep,
        generatedChapterStep,
        manualChapterStep,
        summaryStep,
        renderStep,
      ])
        workflow.markCompleted(stepId);

      story.invalidateScope({ projectId: 'project', kind });

      expect(workflow.getStep(generatedChapterStep)?.status).toBe('INVALIDATED');
      expect(workflow.getStep(summaryStep)?.status).toBe('INVALIDATED');
      expect(workflow.getStep(renderStep)?.status).toBe('INVALIDATED');
      expect(workflow.getStep(manualChapterStep)?.status).toBe('COMPLETED');
      expect(story.getSummary(generated.id)).toBeNull();
      expect(
        database.sqlite
          .prepare(
            'SELECT is_current as isCurrent FROM story_blueprint_revisions WHERE project_id=?',
          )
          .get('project'),
      ).toMatchObject({ isCurrent: kind === 'SETTINGS' ? 0 : 1 });
      expect(
        database.sqlite
          .prepare('SELECT is_current as isCurrent FROM story_plan_revisions WHERE project_id=?')
          .get('project'),
      ).toMatchObject({ isCurrent: kind === 'SETTINGS' || kind === 'BLUEPRINT' ? 0 : 1 });
      database.sqlite.close();
    },
  );
  it('preserves legacy chapters, summaries, and media while bootstrapping safe state', async () => {
    const database = await setupLegacyDatabase();
    migrateDatabase(database);
    const chapters = database.sqlite
      .prepare(
        'SELECT id,content,story_origin as origin,continuity_status as continuityStatus FROM chapters WHERE project_id=? ORDER BY number',
      )
      .all('project') as Array<{
      id: string;
      content: string;
      origin: string;
      continuityStatus: string;
    }>;
    expect(chapters).toEqual([
      { id: 'manual', content: 'Manual text', origin: 'MANUAL', continuityStatus: 'CURRENT' },
      {
        id: 'generated',
        content: 'Generated text',
        origin: 'GENERATED',
        continuityStatus: 'NOT_ANALYZED',
      },
    ]);
    expect(
      database.sqlite.prepare('SELECT COUNT(*) as count FROM story_summary_revisions').get(),
    ).toMatchObject({
      count: 1,
    });
    expect(
      database.sqlite.prepare('SELECT path FROM assets WHERE id=?').get('legacy-audio'),
    ).toMatchObject({
      path: 'legacy/audio.mp3',
    });
    const story = new StoryRepository(database);
    expect(story.getStoryState('project')).toMatchObject({ currentChapter: 0, revision: 1 });
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM story_state_revisions WHERE project_id='project'")
        .get(),
    ).toMatchObject({ count: 1 });
    database.sqlite.close();
  });
  it('validates ordered gap-free arc coverage for a 100-chapter story', async () => {
    const database = await setup();
    const story = new StoryRepository(database);
    const savedSettings = story.saveSettings('project', { ...settings, targetChapterCount: 100 });
    const savedBlueprint = story.saveBlueprint(
      'project',
      story.getSettingsRevision('project', savedSettings.revision)!.id,
      blueprint,
      null,
      story.fingerprint('long-blueprint'),
    );
    const arcs = Array.from({ length: 4 }, (_, index) => {
      const startChapter = index * 25 + 1;
      return {
        id: `arc-${index + 1}`,
        ordinalIndex: index + 1,
        startChapter,
        endChapter: startChapter + 24,
        title: `Arc ${index + 1}`,
        goal: `Goal ${index + 1}`,
        conflict: `Conflict ${index + 1}`,
        importantCharacterIds: ['mai'],
        importantThreadIds: [],
        plannedOutcome: `Outcome ${index + 1}`,
        status: 'PLANNED' as const,
        sourceBlueprintRevision: savedBlueprint.revision,
        inputFingerprint: null,
      };
    });
    const saved = story.saveArcs(
      'project',
      savedBlueprint.revision,
      { arcs },
      null,
      story.fingerprint('long-arcs'),
    );
    expect(saved.map((arc) => [arc.ordinalIndex, arc.startChapter, arc.endChapter])).toEqual([
      [1, 1, 25],
      [2, 26, 50],
      [3, 51, 75],
      [4, 76, 100],
    ]);
    expect(() =>
      story.saveArcs('project', savedBlueprint.revision, {
        arcs: arcs.map((arc, index) => (index === 1 ? { ...arc, startChapter: 24 } : arc)),
      }),
    ).toThrow();
    expect(() =>
      story.saveArcs('project', savedBlueprint.revision, {
        arcs: arcs.map((arc, index) => (index === 1 ? { ...arc, startChapter: 27 } : arc)),
      }),
    ).toThrow();
    expect(story.getArcs('project')).toHaveLength(4);
    database.sqlite.close();
  });
});
