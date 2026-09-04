import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  ProductionInterventionRepository,
  ProductionProfileRepository,
  ProductionRunRepository,
  ProductionStageRepository,
  PublicationPackageRepository,
  WorkflowRepository,
} from './index.js';
import type { DatabaseHandle } from './db.js';

const projectId = '11111111-1111-4111-8111-111111111111';

function setup(chapterCount = 4): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const stamp = '2026-01-01T00:00:00.000Z';
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Production test', 'vi-VN', '{}', stamp, stamp);
  for (let number = 1; number <= chapterCount; number += 1) {
    database.sqlite
      .prepare(
        'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        projectId,
        number,
        `Chapter ${number}`,
        `Text ${number}`,
        'ACTIVE',
        1,
        1,
        stamp,
        stamp,
      );
  }
  return database;
}

function close(database: DatabaseHandle): void {
  database.sqlite.close();
}

describe('production repositories', () => {
  it('creates one current profile revision and guards updates', () => {
    const database = setup();
    const profiles = new ProductionProfileRepository(database);
    const first = profiles.getOrCreate(projectId, 'BALANCED');
    const second = profiles.getOrCreate(projectId, 'BALANCED');
    expect(second.id).toBe(first.id);
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) as count FROM production_profiles WHERE project_id=? AND profile_key='BALANCED'",
        )
        .get(projectId),
    ).toEqual({ count: 1 });
    const updated = profiles.update(projectId, 'BALANCED', {
      expectedRowVersion: first.rowVersion,
      settings: { chapterBatchSize: 3 },
    });
    expect(updated.revision).toBe(first.revision + 1);
    expect(updated.settings.chapterBatchSize).toBe(3);
    expect(() =>
      profiles.update(projectId, 'BALANCED', {
        expectedRowVersion: first.rowVersion,
        settings: { chapterBatchSize: 4 },
      }),
    ).toThrow(/changed/);
    expect(profiles.getOrCreate(projectId, 'MANUAL_REVIEW').settings.requireStoryApproval).toBe(
      true,
    );
    close(database);
  });

  it('rejects invalid scopes before creating workflow or run rows', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    expect(() =>
      runs.create(projectId, undefined, { type: 'CHAPTER_RANGE', startChapter: 4, endChapter: 2 }),
    ).toThrow();
    expect(() =>
      runs.create(projectId, undefined, { type: 'CHAPTER_RANGE', startChapter: 1, endChapter: 8 }),
    ).toThrow();
    database.sqlite.prepare("UPDATE projects SET status='ARCHIVED' WHERE id=?").run(projectId);
    expect(() => runs.create(projectId, undefined, { type: 'FULL_PROJECT' })).toThrow(/Archived/);
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM production_runs').get()).toEqual({
      count: 0,
    });
    expect(
      database.sqlite.prepare('SELECT COUNT(*) as count FROM workflow_executions').get(),
    ).toEqual({ count: 0 });
    close(database);
  });

  it('prevents overlapping active scopes while allowing disjoint ranges', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    const overlapping = runs.create(projectId, undefined, {
      type: 'CHAPTER_RANGE',
      startChapter: 2,
      endChapter: 3,
    });
    const disjoint = runs.create(projectId, overlapping.profileId, {
      type: 'CHAPTER_RANGE',
      startChapter: 4,
      endChapter: 4,
    });
    runs.setReady(overlapping.id);
    runs.setReady(disjoint.id);
    runs.start(overlapping.id);
    expect(() => runs.start(disjoint.id)).not.toThrow();
    const secondOverlapping = runs.create(projectId, overlapping.profileId, {
      type: 'CHAPTER_RANGE',
      startChapter: 3,
      endChapter: 3,
    });
    runs.setReady(secondOverlapping.id);
    expect(() => runs.start(secondOverlapping.id)).toThrow(/overlapping/);
    close(database);
  });

  it('initializes ordered stages idempotently and bounds work aggregation', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    const run = runs.create(projectId, undefined, { type: 'FULL_PROJECT' });
    const stages = new ProductionStageRepository(database);
    expect(stages.initialize(run.id, run.fingerprint)).toHaveLength(11);
    expect(stages.initialize(run.id, run.fingerprint)).toHaveLength(11);
    const audio = stages.getByRunAndKey(run.id, 'AUDIO')!;
    const workflow = new WorkflowRepository(database);
    const execution = workflow.createExecution(projectId, 'PRODUCTION_TEST');
    for (let index = 0; index < 100; index += 1) {
      const step = workflow.createStep(
        execution,
        `audio-${index}`,
        'TTS_SEGMENT',
        projectId,
        `input-${index}`,
      );
      stages.linkWork({
        stageId: audio.id,
        workflowStepId: step,
        unitKey: `chapter:${index}`,
        classification: 'BUILD',
        inputFingerprint: `input-${index}`,
      });
    }
    const aggregate = stages.aggregateWork(audio.id);
    expect(aggregate.total).toBe(100);
    expect(aggregate.samples).toHaveLength(20);
    expect(aggregate.byClassification.BUILD).toBe(100);
    close(database);
  });

  it('deduplicates interventions and protects blocking gates', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    const run = runs.create(projectId, undefined, { type: 'FULL_PROJECT' });
    const interventions = new ProductionInterventionRepository(database);
    const first = interventions.upsertOpen({
      runId: run.id,
      type: 'IMAGE_REVIEW_REQUIRED',
      severity: 'BLOCKING',
      message: 'Review the image',
      dedupeKey: 'image:one',
      actions: ['Review'],
    });
    const second = interventions.upsertOpen({
      runId: run.id,
      type: 'IMAGE_REVIEW_REQUIRED',
      severity: 'BLOCKING',
      message: 'Changed message',
      dedupeKey: 'image:one',
    });
    expect(second.id).toBe(first.id);
    expect(() => interventions.dismiss(first.id, { resolution: { action: 'skip' } })).toThrow(
      /resolved/,
    );
    expect(interventions.resolve(first.id, { resolution: { action: 'accept' } }).status).toBe(
      'RESOLVED',
    );
    close(database);
  });

  it('keeps immutable package revisions and rejects stale writes', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    const run = runs.create(projectId, undefined, { type: 'FULL_PROJECT' });
    const packages = new PublicationPackageRepository(database);
    const first = packages.createRevision({
      projectId,
      runId: run.id,
      status: 'INCOMPLETE',
      fingerprint: 'package-one',
      videoAssetId: null,
      thumbnailAssetId: null,
      subtitleAssetIds: [],
      metadata: null,
      chapterMarkers: [],
      validation: [],
      manifest: null,
    });
    const packageRow = database.sqlite
      .prepare('SELECT row_version as rowVersion FROM publication_packages WHERE id=?')
      .get(first.id) as { rowVersion: number };
    const second = packages.createRevision({
      projectId,
      runId: run.id,
      status: 'READY',
      fingerprint: 'package-two',
      videoAssetId: null,
      thumbnailAssetId: null,
      subtitleAssetIds: [],
      metadata: null,
      chapterMarkers: [],
      validation: [],
      manifest: null,
      expectedRowVersion: packageRow.rowVersion,
    });
    expect(second.revision).toBe(2);
    expect(packages.listRevisions(first.id)).toHaveLength(2);
    expect(
      database.sqlite
        .prepare(
          'SELECT COUNT(*) as count FROM publication_package_revisions WHERE package_id=? AND is_current=1',
        )
        .get(first.id),
    ).toEqual({ count: 1 });
    expect(() =>
      packages.createRevision({
        projectId,
        runId: run.id,
        status: 'READY',
        fingerprint: 'package-three',
        videoAssetId: null,
        thumbnailAssetId: null,
        subtitleAssetIds: [],
        metadata: null,
        chapterMarkers: [],
        validation: [],
        manifest: null,
        expectedRowVersion: 1,
      }),
    ).toThrow(/changed/);
    close(database);
  });
  it('rejects illegal run and stage transitions', () => {
    const database = setup();
    const runs = new ProductionRunRepository(database);
    const run = runs.create(projectId, undefined, { type: 'FULL_PROJECT' });
    const stages = new ProductionStageRepository(database);
    const story = stages.initialize(run.id, run.fingerprint)[0]!;

    expect(() => runs.transition(run.id, 'RUNNING')).toThrow(/cannot transition/);
    const ready = runs.setReady(run.id);
    const running = runs.start(run.id, ready.rowVersion);
    expect(() => runs.transition(running.id, 'DRAFT')).toThrow(/cannot transition/);
    stages.update(story.id, { status: 'COMPLETED' });
    expect(() => stages.update(story.id, { status: 'PENDING' })).toThrow(/cannot transition/);
    close(database);
  });
});
