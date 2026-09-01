import { copyFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  WorkflowRepository,
  type DatabaseHandle,
} from '@studio/database';
import { FfmpegTools, initializeWorkspace, ProcessRunner } from '@studio/media';
import {
  imageProviderResultSchema,
  imageReadinessSchema,
  type ImageGenerationRequest,
  type ImageProviderResult,
  type ImageProviderSettings,
} from '@studio/shared';
import { StudioService, type StudioContext } from './index.js';
import { createImageGenerationService } from './image-service.js';
import type { ImageProvider } from './comfyui.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const sceneStableId = 'scene-stable-1';

async function setup(): Promise<{ context: StudioContext; database: DatabaseHandle; fixture: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studio-image-workflow-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare('INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(projectId, 'Image workflow', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(chapterId, projectId, 1, 'Chapter', 'A quiet river.', 'ACTIVE', 1, 1, '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      `INSERT INTO scene_plan_revisions(id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(planId, projectId, chapterId, 1, 1, 'MEDIUM', 'plan-fingerprint', 'CURRENT', 1, '2026-01-01', '2026-01-01');
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
  const fixture = join(workspace.staging, 'fixture.png');
  await media.run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=16x16',
    '-frames:v',
    '1',
    '-update',
    '1',
    fixture,
  ]);
  return { context: { database, workspace, runner, media }, database, fixture };
}

class FixtureProvider implements ImageProvider {
  constructor(private readonly fixture: string, private readonly outputRoot: string) {}

  async readiness(settings: ImageProviderSettings) {
    return imageReadinessSchema.parse({
      provider: 'COMFYUI',
      status: settings.diffusionModel ? 'READY' : 'NOT_CONFIGURED',
      message: 'Fixture provider ready',
      checkedAt: new Date().toISOString(),
      supportsCancellation: true,
    });
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const output = join(this.outputRoot, `${request.providerJobId}.png`);
    await copyFile(this.fixture, output);
    return imageProviderResultSchema.parse({
      provider: 'COMFYUI',
      providerJobId: request.providerJobId,
      seed: request.seed,
      width: 16,
      height: 16,
      durationMs: 10,
      images: [{ mediaType: 'image/png', stagingPath: output, width: 16, height: 16 }],
      warnings: [],
      metadata: {},
    });
  }

  async cancel(): Promise<void> {}
}

function configure(service: ReturnType<typeof createImageGenerationService>): void {
  const current = service.getSettings(projectId);
  service.updateSettings(projectId, {
    provider: current.provider,
    baseUrl: current.baseUrl,
    workflowTemplate: current.workflowTemplate,
    diffusionModel: 'flux.safetensors',
    textEncoder: 'qwen.safetensors',
    vaeName: 'vae.safetensors',
    sampler: current.sampler,
    connectionTimeoutMs: current.connectionTimeoutMs,
    generationTimeoutMs: current.generationTimeoutMs,
    width: 1024,
    height: 576,
    steps: current.steps,
    guidance: current.guidance,
    seedMode: 'FIXED',
    fixedSeed: 42,
    expectedRowVersion: current.rowVersion,
  });
}

describe('ImageGenerationService', () => {
  it('schedules, validates, publishes, persists, and regenerates with the same seed', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const scheduled = images.schedule(projectId, sceneId, {});
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('image-worker')!;
    expect(step.id).toBe(scheduled.stepId);
    await images.executeStep(step, 'image-worker');
    workflow.complete(step);
    const completed = images.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      freshness: 'CURRENT',
      isCurrent: true,
      requestedSeed: 42,
      actualSeed: 42,
      actualWidth: 16,
      actualHeight: 16,
    });
    expect(completed.assetUrl).toMatch(/^\/api\/assets\//u);
    const restarted = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    expect(restarted.listGenerations(projectId, sceneId)).toHaveLength(1);
    const regeneration = restarted.regenerate(
      projectId,
      sceneId,
      completed.id,
      { mode: 'SAME_SEED', instructions: 'Keep the composition' },
    );
    expect(regeneration.generation.requestedSeed).toBe(42);
    expect(regeneration.generation.revision).toBe(2);
    database.sqlite.close();
  });

  it('rejects stale Visual Prompt Packages before provider execution', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const scheduled = images.schedule(projectId, sceneId, {});
    database.sqlite
      .prepare("UPDATE visual_prompt_packages SET status='STALE',is_current=0 WHERE project_id=?")
      .run(projectId);
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('image-worker')!;
    await expect(images.executeStep(step, 'image-worker')).rejects.toMatchObject({ code: 'STALE_INPUT' });
    expect(images.getGeneration(projectId, sceneId, scheduled.generation.id).status).toBe('FAILED');
    database.sqlite.close();
  });
});
