import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@studio/database';
import { ProcessRunner } from '@studio/media';
import { StudioService } from './index.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'studio-workflow-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  const service = new StudioService({
    database,
    workspace: {} as never,
    media: {} as never,
    runner: new ProcessRunner(),
  });
  service.story.saveSettings('project', {
    idea: 'A courier keeps a promise.',
    genre: 'fantasy',
    tone: 'reflective',
    audience: 'general',
    targetChapterCount: 1,
    chapterLength: 800,
    pacing: 'MEDIUM',
  });
  return { database, service };
}

describe('Story workflow scheduling', () => {
  it('persists blueprint-to-plan dependencies before work starts', async () => {
    const { database, service } = await setup();
    const scheduled = service.scheduleStoryStages('project');
    expect(scheduled.jobIds).toHaveLength(2);
    expect(
      database.sqlite.prepare('SELECT COUNT(*) as count FROM workflow_step_dependencies').get(),
    ).toMatchObject({ count: 1 });
    const workflow = service.workflow;
    const first = workflow.claim('worker')!;
    expect(first.type).toBe('GENERATE_STORY_BLUEPRINT');
    workflow.complete(first);
    const second = workflow.claim('worker')!;
    expect(second.type).toBe('GENERATE_CHAPTER_PLANS');
    database.sqlite.close();
  });

  it('reuses durable cancellation, lease recovery, and independent summary retry', async () => {
    const { database, service } = await setup();
    const workflow = service.workflow;
    service.scheduleStoryBlueprint('project');
    const claimedBlueprint = workflow.claim('worker');
    expect(claimedBlueprint?.type).toBe('GENERATE_STORY_BLUEPRINT');
    workflow.requestCancel(claimedBlueprint!.id);
    expect(workflow.isCancellationRequested(claimedBlueprint!.id)).toBe(true);
    expect(workflow.cancel(claimedBlueprint!)).toBe(true);
    expect(workflow.getStep(claimedBlueprint!.id)?.status).toBe('CANCELLED');

    const chapter = service.createChapter('project', { title: 'Chapter 1', content: 'Text' });
    service.scheduleStorySummary(chapter.id);
    const claimedSummary = workflow.claim('worker');
    expect(claimedSummary?.type).toBe('GENERATE_CHAPTER_SUMMARY');
    expect(claimedSummary?.entity_id).toBe(chapter.id);
    database.sqlite
      .prepare('UPDATE workflow_steps SET lease_expires_at=? WHERE id=?')
      .run(new Date(Date.now() - 1_000).toISOString(), claimedSummary!.id);
    expect(workflow.recoverExpired()).toBe(1);
    expect(workflow.getStep(claimedSummary!.id)?.status).toBe('PENDING');
    const recovered = workflow.claim('worker');
    expect(recovered?.id).toBe(claimedSummary!.id);
    workflow.fail(recovered!, 'summary provider failure', false);
    workflow.retryStep(recovered!.id);
    expect(workflow.claim('worker')?.id).toBe(recovered!.id);
    database.sqlite.close();
  });
});
