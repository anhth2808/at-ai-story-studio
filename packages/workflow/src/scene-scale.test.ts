import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, WorkflowRepository } from '@studio/database';
import { FfmpegTools, ProcessRunner, initializeWorkspace } from '@studio/media';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioService, type StudioContext } from './index.js';

describe('Scene Engine scale boundaries', () => {
  it('keeps 20- and 100-chapter batches paginated and selected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scene-scale-'));
    const database = createDatabase(join(root, 'studio.db'));
    migrateDatabase(database);
    const workspace = await initializeWorkspace(root);
    const context: StudioContext = {
      database,
      workspace,
      runner: new ProcessRunner(),
      media: {} as FfmpegTools,
    };
    const service = new StudioService(context);
    const project = service.createProject({
      title: 'Scene scale project',
      description: '',
      language: 'vi-VN',
      workflowType: 'AUDIO_STORY',
    });
    const chapterIds = Array.from(
      { length: 100 },
      (_, index) =>
        service.createChapter(project.id, {
          title: `Chapter ${index + 1}`,
          content: `Chapter ${index + 1} text.`,
        }).id,
    );

    expect(service.listSceneChapters(project.id, 20, 0)).toHaveLength(20);
    expect(service.listSceneChapters(project.id, 20, 80)[0]?.chapterNumber).toBe(81);

    const twenty = service.scheduleSceneBatch(project.id, {
      chapterIds: chapterIds.slice(0, 20),
      density: 'LOW',
      targetRange: { min: 1, max: 3 },
      onlyMissing: false,
    });
    const hundred = service.scheduleSceneBatch(project.id, {
      chapterIds,
      density: 'LOW',
      targetRange: { min: 1, max: 3 },
      onlyMissing: false,
    });
    expect(twenty.jobIds).toHaveLength(20);
    expect(hundred.jobIds).toHaveLength(100);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM workflow_steps WHERE type='GENERATE_SCENES'")
        .get(),
    ).toEqual({ count: 120 });
    const claimed = new WorkflowRepository(database).claim('scale-worker');
    expect(chapterIds).toContain(claimed?.entity_id);
    database.sqlite.close();
  });
});
