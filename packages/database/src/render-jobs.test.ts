import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AssetRepository,
  RenderJobRepository,
  WorkflowRepository,
  createDatabase,
  migrateDatabase,
} from './index.js';
import type { DatabaseHandle } from './db.js';

function fixture(): { database: DatabaseHandle; projectId: string } {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const projectId = randomUUID();
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,description,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(projectId, 'Project', '', 'vi', '{}', '2026-01-01', '2026-01-01');
  return { database, projectId };
}

describe('render job repository', () => {
  it('persists scope metadata and prevents duplicate active scope jobs', () => {
    const { database, projectId } = fixture();
    const workflow = new WorkflowRepository(database);
    const executionId = workflow.createExecution(projectId, 'TIMELINE');
    const stepId = workflow.createStep(
      executionId,
      'scene-1',
      'RENDER_SCENE_CLIP',
      'scene-1',
      'fingerprint',
    );
    const repository = new RenderJobRepository(database);
    const created = repository.create({
      projectId,
      stepId,
      renderType: 'SCENE_CLIP',
      scopeId: 'scene-1:r1',
      expectedDurationMs: 1_000,
    });
    expect(created.renderType).toBe('SCENE_CLIP');
    expect(created.expectedDurationMs).toBe(1_000);
    expect(() =>
      repository.create({
        projectId,
        stepId,
        renderType: 'SCENE_CLIP',
        scopeId: 'scene-1:r1',
        expectedDurationMs: 1_000,
      }),
    ).toThrow('already active');
    repository.updateProgress(created.id, 500, 510, { stage: 'SCENE_CLIP' });
    const assets = new AssetRepository(database);
    assets.register({
      id: '11111111-1111-4111-8111-111111111111',
      projectId,
      type: 'TIMELINE_MANIFEST',
      role: 'scene:one:timeline',
      path: 'projects/p1/timeline.json',
      mediaType: 'application/json',
      bytes: 1,
      sha256: 'timeline-hash',
    });
    assets.register({
      id: '22222222-2222-4222-8222-222222222222',
      projectId,
      type: 'SCENE_VIDEO_CLIP',
      role: 'scene:one:video',
      path: 'projects/p1/scene.mp4',
      mediaType: 'video/mp4',
      bytes: 1,
      sha256: 'video-hash',
    });
    repository.linkAssets(
      created.id,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(repository.get(created.id)).toMatchObject({
      progressTimeMs: 500,
      actualDurationMs: 510,
    });
    database.sqlite.close();
  });
});
