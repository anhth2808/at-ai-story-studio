import { mkdtemp } from 'node:fs/promises';
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
});
