import { copyFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  WorkflowRepository,
  type DatabaseHandle,
} from '@studio/database';
import { FfmpegTools, initializeWorkspace, ProcessRunner } from '@studio/media';
import {
  videoGenerationResultSchema,
  videoReadinessSchema,
  type VideoGenerationRequest,
  type VideoGenerationResult,
  type VideoProviderSettings,
  type VideoReadiness,
} from '@studio/shared';
import type { StudioContext } from './index.js';
import { SceneVideoService } from './video-service.js';
import type { VideoGenerationProvider } from './comfyui-video.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const sceneStableId = 'scene-stable-1';
const imageSha = 'a'.repeat(64);

async function setup(): Promise<{ context: StudioContext; database: DatabaseHandle; clipFixture: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studio-video-workflow-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Video workflow', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      chapterId,
      projectId,
      1,
      'Chapter',
      'A quiet river.',
      'ACTIVE',
      1,
      1,
      '2026-01-01',
      '2026-01-01',
    );
  database.sqlite
    .prepare(
      `INSERT INTO scene_plan_revisions(id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      planId,
      projectId,
      chapterId,
      1,
      1,
      'MEDIUM',
      'plan-fingerprint',
      'CURRENT',
      1,
      '2026-01-01',
      '2026-01-01',
    );
  database.sqlite
    .prepare(
      `INSERT INTO scene_revisions(
        id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,scene_number,revision,title,summary,
        purpose,source_start_offset,source_end_offset,source_content,visual_description,camera,composition,image_prompt,
        negative_prompt,input_fingerprint,prompt_version,schema_version,status,prompt_status,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      sceneId,
      sceneStableId,
      planId,
      projectId,
      chapterId,
      1,
      1,
      1,
      'River at dawn',
      'A river catches the first light.',
      'INTRODUCTION',
      0,
      14,
      'A quiet river.',
      'A quiet river at dawn.',
      JSON.stringify({ framing: 'MEDIUM', angle: 'Eye level', movementIntent: null }),
      JSON.stringify({
        subjectFocus: 'River',
        foreground: [],
        midground: ['River'],
        background: ['Dawn sky'],
        characterPositions: [],
      }),
      'cinematic river at dawn',
      'text, watermark',
      'scene-fingerprint',
      'scene-v1',
      'scene-v1',
      'CURRENT',
      'CURRENT',
      1,
      '2026-01-01',
      '2026-01-01',
    );
  const workspace = await initializeWorkspace(root);
  const runner = new ProcessRunner();
  const media = new FfmpegTools(runner);
  // Real tiny H.264 clip: the fixture must survive raw-video ffprobe validation.
  const clipFixture = join(workspace.staging, 'fixture-clip.mp4');
  await media.run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=rate=24:duration=0.5:size=64x64',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    clipFixture,
  ]);
  // A current accepted scene image asset.
  database.sqlite
    .prepare(
      `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,
        input_fingerprint,metadata,is_current,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      randomUUID(),
      projectId,
      'SCENE_IMAGE',
      `scene:${sceneStableId}:image`,
      'READY',
      `projects/${projectId}/images/scenes/${sceneStableId}/current.png`,
      'image/png',
      100,
      imageSha,
      sceneId,
      'image-fingerprint',
      JSON.stringify({ width: 1024, height: 576 }),
      1,
      '2026-01-01',
      '2026-01-01',
    );
  return { context: { database, workspace, runner, media }, database, clipFixture };
}

class FakeVideoProvider implements VideoGenerationProvider {
  constructor(
    private readonly fixture: string,
    private readonly outputRoot: string,
  ) {}

  async readiness(settings: VideoProviderSettings): Promise<VideoReadiness> {
    return videoReadinessSchema.parse({
      provider: 'COMFYUI',
      status: settings.diffusionModel ? 'READY' : 'NOT_CONFIGURED',
      message: 'Fixture video provider ready',
      checkedAt: new Date().toISOString(),
      supportsCancellation: true,
    });
  }

  async generate(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const output = join(this.outputRoot, `${request.providerJobId}.mp4`);
    await copyFile(this.fixture, output);
    return videoGenerationResultSchema.parse({
      provider: 'COMFYUI',
      providerJobId: request.providerJobId,
      seed: request.seed,
      width: request.width,
      height: request.height,
      fps: request.fps,
      frameCount: request.frameCount,
      durationMs: 10,
      clipDurationMs: 500,
      videos: [{ mediaType: 'video/mp4', stagingPath: output }],
      warnings: [],
      metadata: {},
    });
  }

  async cancel(): Promise<void> {}
}

async function configuredService(database: DatabaseHandle, context: StudioContext, clipFixture: string) {
  const service = new SceneVideoService(context, new FakeVideoProvider(clipFixture, context.workspace.staging));
  service.setMotionSource(projectId, sceneId, 'AI_VIDEO');
  const settings = service.getSettings(projectId);
  const base = { ...settings };
  delete (base as Record<string, unknown>).id;
  delete (base as Record<string, unknown>).projectId;
  delete (base as Record<string, unknown>).rowVersion;
  delete (base as Record<string, unknown>).inputFingerprint;
  delete (base as Record<string, unknown>).createdAt;
  delete (base as Record<string, unknown>).updatedAt;
  service.updateSettings(projectId, {
    ...base,
    seedMode: 'FIXED',
    fixedSeed: 42,
    expectedRowVersion: settings.rowVersion,
  });
  return service;
}

describe('SceneVideoService', () => {
  it('refuses to schedule a Ken Burns scene', async () => {
    const { context, database, clipFixture } = await setup();
    const service = new SceneVideoService(context, new FakeVideoProvider(clipFixture, context.workspace.staging));
    expect(() => service.schedule(projectId, sceneId, {})).toThrowError(
      'Scene motion source is KEN_BURNS; set it to AI_VIDEO or HYBRID first',
    );
    database.sqlite.close();
  });

  it('schedules, executes, commits, and reuses identical requests', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    const scheduled = service.schedule(projectId, sceneId, {});
    expect(scheduled.reused).toBe(false);
    expect(scheduled.generation.status).toBe('PENDING');
    expect(scheduled.generation.inputFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('video-worker')!;
    await service.executeStep(step, 'video-worker');
    workflow.complete(step);
    const completed = service.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      freshness: 'CURRENT',
      requestedSeed: 42,
      actualSeed: 42,
    });
    expect(completed.assetUrl).toMatch(/^\/api\/assets\//u);
    // Identical deterministic inputs reuse the raw clip without a new job.
    const again = service.schedule(projectId, sceneId, {});
    expect(again.reused).toBe(true);
    expect(again.generation.id).toBe(completed.id);
    database.sqlite.close();
  });

  it('keeps the raw asset non-current when review approval is required', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    const scheduled = service.schedule(projectId, sceneId, {});
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('video-worker')!;
    await service.executeStep(step, 'video-worker');
    workflow.complete(step);
    const completed = service.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(completed.isCurrent).toBe(false);
    // Regenerate with a new seed creates the next revision; same seed keeps it.
    // RANDOM seed mode: regenerate must produce a new concrete seed.
    const settingsNow = service.getSettings(projectId);
    const baseSettings = { ...settingsNow };
    for (const key of ['id', 'projectId', 'rowVersion', 'inputFingerprint', 'createdAt', 'updatedAt'])
      delete (baseSettings as Record<string, unknown>)[key];
    service.updateSettings(projectId, {
      ...baseSettings,
      seedMode: 'RANDOM',
      expectedRowVersion: settingsNow.rowVersion,
    });
    const regenerated = service.regenerate(projectId, sceneId, completed.id, { mode: 'NEW_SEED' });
    expect(regenerated.generation.revision).toBe(2);
    expect(regenerated.generation.requestedSeed).not.toBeNull();
    const sameSeed = service.regenerate(projectId, sceneId, completed.id, { mode: 'SAME_SEED' });
    expect(sameSeed.generation.requestedSeed).toBe(42);
    database.sqlite.close();
  });

  it('fails stale completions instead of publishing them', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    const scheduled = service.schedule(projectId, sceneId, {});
    // The accepted image changes while the provider is generating.
    database.sqlite
      .prepare('UPDATE assets SET sha256=? WHERE project_id=? AND role=?')
      .run('b'.repeat(64), projectId, `scene:${sceneStableId}:image`);
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('video-worker')!;
    await expect(service.executeStep(step, 'video-worker')).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    const failed = service.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.assetId).toBeNull();
    database.sqlite.close();
  });

  it('does not resubmit OOM failures with identical settings', async () => {
    const { context, database, clipFixture } = await setup();
    class OomProvider extends FakeVideoProvider {
      async generate(): Promise<VideoGenerationResult> {
        throw Object.assign(new Error('CUDA out of memory'), { name: 'VideoProviderError' });
      }
    }
    const service = new SceneVideoService(context, new OomProvider(clipFixture, context.workspace.staging));
    service.setMotionSource(projectId, sceneId, 'AI_VIDEO');
    const scheduled = service.schedule(projectId, sceneId, {});
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('video-worker')!;
    await expect(service.executeStep(step, 'video-worker')).rejects.toBeTruthy();
    const failed = service.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(failed.status).toBe('FAILED');
    database.sqlite.close();
  });
});
