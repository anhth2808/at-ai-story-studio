import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, WorkflowRepository } from '@studio/database';
import { FfmpegTools, ProcessRunner, initializeWorkspace } from '@studio/media';
import { chapterInputSchema } from '@studio/shared';
import {
  StudioService,
  WorkerExecutor,
  type StudioContext,
  type TtsProvider,
  type VisualConsistencyService,
} from './index.js';

async function setup(content = 'Một. Hai. Ba.') {
  const root = await mkdtemp(join(tmpdir(), 'studio-workflow-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  const workspace = await initializeWorkspace(root);
  const runner = new ProcessRunner();
  const media = {
    probe: async () => ({ format: { duration: '1' } }),
    measureAudioDuration: async () => ({ durationMs: 1_000, provenance: 'DECODED_FRAMES' }),
    detectAudioSilence: async () => ({ totalSilenceMs: 0, activityRatio: 1 }),
    run: async (args: string[]) => {
      await writeFile(args.at(-1)!, Buffer.from('merged-audio'));
      return { stdout: '', stderr: '', exitCode: 0, signal: null, durationMs: 1 };
    },
  } as unknown as FfmpegTools;
  const context: StudioContext = { database, workspace, runner, media };
  const service = new StudioService(context);
  const project = service.createProject({
    title: 'Test project',
    description: '',
    language: 'vi-VN',
    workflowType: 'AUDIO_STORY',
  });
  const chapter = service.createChapter(project.id, { title: 'Chapter 1', content });
  return { database, service, chapter, project, context };
}

class FixtureTtsProvider implements TtsProvider {
  readonly calls: string[] = [];
  private failed = false;
  constructor(private readonly failText?: string) {}
  async synthesize(text: string, _voice: string, outputFile: string): Promise<void> {
    this.calls.push(text);
    if (text === this.failText && !this.failed) {
      this.failed = true;
      throw new Error('fixture provider failure');
    }
    await writeFile(outputFile, Buffer.from(`audio:${text}`));
  }
}

async function close(database: ReturnType<typeof createDatabase>): Promise<void> {
  database.sqlite.close();
}

describe('V1 workflow hardening', () => {
  it('makes the first TTS segment claimable after synchronous cleaning', async () => {
    const fixture = await setup();
    const scheduled = fixture.service.scheduleChapterTts(fixture.chapter.id);
    const claim = new WorkflowRepository(fixture.database).claim('worker-a');
    expect(claim?.type).toBe('TTS_SEGMENT');
    expect(claim?.entity_id).toBe(fixture.chapter.id);
    expect(scheduled.jobIds).toHaveLength(4);
    await close(fixture.database);
  });

  it('invalidates audio, subtitles, and render when content changes to empty', async () => {
    const fixture = await setup('hello');
    expect(chapterInputSchema.parse({ title: 'Chapter 1', content: '' }).content).toBe('');
    const assets = fixture.service.assets;
    const assetsToRegister: Array<[string, string]> = [
      ['CHAPTER_AUDIO', `chapter:${fixture.chapter.id}:audio`],
      ['SUBTITLE', `chapter:${fixture.chapter.id}:subtitle`],
      ['RENDERED_VIDEO', 'project:render'],
    ];
    for (const [type, role] of assetsToRegister) {
      assets.register({
        id: randomUUID(),
        projectId: fixture.project.id,
        type,
        role,
        path: `${role.replaceAll(':', '-')}.asset`,
        mediaType: 'application/octet-stream',
        bytes: 1,
        sha256: 'hash',
      });
    }
    const workflow = new WorkflowRepository(fixture.database);
    const execution = workflow.createExecution(fixture.project.id, 'TEST');
    const step = workflow.createStep(execution, 'render', 'RENDER', fixture.project.id, 'render');
    fixture.database.sqlite
      .prepare("UPDATE workflow_steps SET status='COMPLETED' WHERE id=?")
      .run(step);
    fixture.service.updateChapter(fixture.chapter.id, { title: 'Chapter 1', content: '' });
    expect(assets.current(fixture.project.id, `chapter:${fixture.chapter.id}:audio`)).toBeFalsy();
    expect(
      assets.current(fixture.project.id, `chapter:${fixture.chapter.id}:subtitle`),
    ).toBeFalsy();
    expect(assets.current(fixture.project.id, 'project:render')).toBeFalsy();
    expect(workflow.getStep(step)?.status).toBe('INVALIDATED');
    await close(fixture.database);
  });

  it('does not invalidate narration for a title-only edit', async () => {
    const fixture = await setup('hello');
    fixture.service.assets.register({
      id: randomUUID(),
      projectId: fixture.project.id,
      type: 'CHAPTER_AUDIO',
      role: `chapter:${fixture.chapter.id}:audio`,
      path: 'audio.mp3',
      mediaType: 'audio/mpeg',
      bytes: 1,
      sha256: 'hash',
    });
    fixture.service.updateChapter(fixture.chapter.id, { title: 'Renamed', content: 'hello' });
    expect(
      fixture.service.assets.current(fixture.project.id, `chapter:${fixture.chapter.id}:audio`),
    ).not.toBeNull();
    await close(fixture.database);
  });

  it('retries only the failed TTS segment and merges all valid segments', async () => {
    const fixture = await setup();
    const provider = new FixtureTtsProvider('Ba.');
    const executor = new WorkerExecutor(fixture.context, 'worker-a', provider);
    const workflow = new WorkflowRepository(fixture.database);
    fixture.service.scheduleChapterTts(fixture.chapter.id);

    const first = workflow.claim('worker-a')!;
    await executor.execute(first);
    workflow.complete(first);
    const second = workflow.claim('worker-a')!;
    await executor.execute(second);
    workflow.complete(second);
    const third = workflow.claim('worker-a')!;
    await expect(executor.execute(third)).rejects.toThrow();
    workflow.fail(third, 'fixture failure', false);
    expect(provider.calls).toHaveLength(3);

    fixture.service.scheduleChapterTts(fixture.chapter.id);
    let claim: ReturnType<WorkflowRepository['claim']>;
    while ((claim = workflow.claim('worker-a'))) {
      await executor.execute(claim);
      workflow.complete(claim);
    }
    expect(provider.calls).toHaveLength(4);
    expect(provider.calls.slice(3)).toEqual(['Ba.']);
    expect(
      fixture.service.assets.current(fixture.project.id, `chapter:${fixture.chapter.id}:audio`),
    ).not.toBeNull();
    await close(fixture.database);
  });

  it('persists project identity in visual profile workflow payloads', async () => {
    const fixture = await setup();
    const scheduled = fixture.service.scheduleVisualProfileGeneration(
      fixture.project.id,
      'OBJECT',
      'old wooden door',
    );
    const step = new WorkflowRepository(fixture.database).getStep(scheduled.stepId);
    expect(JSON.parse(step!.payload)).toMatchObject({
      projectId: fixture.project.id,
      kind: 'OBJECT',
      subjectId: 'old wooden door',
    });
    await close(fixture.database);
  });
  it('dispatches visual profile jobs with project-scoped payloads', async () => {
    const fixture = await setup();
    const calls: unknown[] = [];
    const visualService = {
      generateObjectProfile: async (input: unknown) => {
        calls.push(input);
        return null;
      },
    } as unknown as VisualConsistencyService;
    const scheduled = fixture.service.scheduleVisualProfileGeneration(
      fixture.project.id,
      'OBJECT',
      'old wooden door',
      { instructions: 'Keep the silhouette simple.' },
    );
    const workflow = new WorkflowRepository(fixture.database);
    const claim = workflow.claim('visual-worker');
    await new WorkerExecutor(
      fixture.context,
      'visual-worker',
      undefined,
      undefined,
      undefined,
      visualService,
    ).execute(claim!);
    expect(calls).toEqual([
      expect.objectContaining({
        projectId: fixture.project.id,
        objectKey: 'old wooden door',
        objectName: 'old wooden door',
        instructions: 'Keep the silhouette simple.',
      }),
    ]);
    expect(workflow.getStep(scheduled.stepId)?.progress).toBe(0);
    await close(fixture.database);
  });

  it('rejects an old TTS claim after chapter content changes', async () => {
    const fixture = await setup('Cũ.');
    const provider = new FixtureTtsProvider();
    const executor = new WorkerExecutor(fixture.context, 'worker-a', provider);
    const workflow = new WorkflowRepository(fixture.database);
    fixture.service.scheduleChapterTts(fixture.chapter.id);
    const claim = workflow.claim('worker-a')!;
    fixture.service.updateChapter(fixture.chapter.id, { title: 'Chapter 1', content: 'Mới.' });
    await expect(executor.execute(claim)).rejects.toThrow('stale');
    expect(provider.calls).toHaveLength(0);
    expect(
      fixture.service.assets.current(fixture.project.id, `chapter:${fixture.chapter.id}:audio`),
    ).toBeFalsy();
    await close(fixture.database);
  });
});
