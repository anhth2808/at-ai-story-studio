import { copyFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  ImageGenerationSettingsRepository,
  SceneImageGenerationRepository,
  ShotPlanRepository,
  TimelineRepository,
  WorkflowRepository,
  type DatabaseHandle,
} from '@studio/database';
import { FfmpegTools, initializeWorkspace, ProcessRunner } from '@studio/media';
import {
  AppError,
  videoGenerationResultSchema,
  videoReadinessSchema,
  type ShotPlanCandidate,
  type VideoGenerationRequest,
  type VideoGenerationResult,
  type VideoProviderSettings,
  type VideoReadiness,
} from '@studio/shared';
import type { AiAgent, AiAgentResult } from './omp-agent.js';
import type { StudioContext } from './index.js';
import { SceneVideoService } from './video-service.js';
import type { VideoGenerationProvider } from './comfyui-video.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const sceneStableId = 'scene-stable-1';
const imageSha = 'a'.repeat(64);
const state = {
  characters: [],
  objects: [],
  cameraAxis: '',
  locationId: null,
  sourceShotId: null,
  fingerprint: 'd'.repeat(64),
};

async function setup(): Promise<{
  context: StudioContext;
  database: DatabaseHandle;
  clipFixture: string;
}> {
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
  // A current accepted scene image asset and its manual generation lineage.
  const imageAssetId = randomUUID();
  database.sqlite
    .prepare(
      `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,
        input_fingerprint,metadata,is_current,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      imageAssetId,
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
  database.sqlite
    .prepare(
      `INSERT INTO scene_image_generations(
        id,project_id,scene_stable_id,scene_revision_id,revision,source,status,review_status,
        is_current,input_fingerprint,asset_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      randomUUID(),
      projectId,
      sceneStableId,
      sceneId,
      1,
      'MANUAL',
      'COMPLETED',
      'ACCEPTED',
      1,
      'image-generation-fingerprint',
      imageAssetId,
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

class TemporalCriticAgent implements AiAgent {
  calls = 0;

  async generate(request: Parameters<AiAgent['generate']>[0]): Promise<AiAgentResult> {
    this.calls += 1;
    return {
      operation: request.operation,
      text: JSON.stringify({
        status: 'REJECTED',
        issues: ['IDENTITY_DRIFT', 'FLICKER'],
        confidence: 0.9,
        explanation: 'The subject drifts between sampled frames.',
        guidance: 'Keep the camera move restrained.',
      }),
      provider: 'fixture',
      model: 'fixture-critic',
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: 1,
    };
  }
}
class UnavailableTemporalCritic implements AiAgent {
  async generate(): Promise<AiAgentResult> {
    throw new Error('critic offline');
  }
}

async function configuredService(
  database: DatabaseHandle,
  context: StudioContext,
  clipFixture: string,
  criticAgent?: AiAgent,
) {
  const service = new SceneVideoService(
    context,
    new FakeVideoProvider(clipFixture, context.workspace.staging),
    criticAgent,
  );
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

function bindImageGeneration(
  database: DatabaseHandle,
  reviewStatus: 'UNREVIEWED' | 'ACCEPTED' | 'REJECTED',
): void {
  database.sqlite
    .prepare(
      `UPDATE scene_image_generations
       SET review_status=?,is_current=1,status='COMPLETED',updated_at=?
       WHERE project_id=? AND scene_stable_id=? AND shot_stable_id IS NULL`,
    )
    .run(reviewStatus, '2026-01-01', projectId, sceneStableId);
}

function requireImageApproval(database: DatabaseHandle, required: boolean): void {
  database.sqlite
    .prepare(
      `INSERT INTO image_generation_settings(id,project_id,require_image_approval,input_fingerprint,created_at,updated_at)
       VALUES(?,?,?,?,?,?)`,
    )
    .run(randomUUID(), projectId, required ? 1 : 0, 'img-fingerprint', '2026-01-01', '2026-01-01');
}

function continuationShot(
  id: string,
  beatId: string,
  ordinal: number,
  cameraMotion: 'STATIC' | 'PUSH_IN',
  continuation: ShotPlanCandidate['shots'][number]['continuation'],
): ShotPlanCandidate['shots'][number] {
  return {
    id,
    beatId,
    ordinal,
    sourceRange: { startOffset: (ordinal - 1) * 7, endOffset: ordinal * 7 },
    primaryBeat: 'ACTION',
    eventKinds: ['ACTION'],
    eventCount: 1,
    importance: 'MEDIUM',
    hero: false,
    identitySensitive: false,
    dialogueMode: 'NONE',
    dialogueText: '',
    speakerCharacterId: null,
    visualCarrier: '',
    offscreenRationale: '',
    visibleCharacterIds: [],
    offscreenCharacterIds: [],
    staticIntent: {
      subject: 'A river',
      action: 'flows',
      pose: '',
      expression: '',
      relationship: '',
      importantObjectIds: [],
      framing: 'MEDIUM',
      angle: 'Eye level',
      composition: 'Centered',
      lighting: 'Dawn',
      colorMood: 'Blue',
      atmosphere: 'Quiet',
    },
    dynamicIntent: {
      subjectMotion: 'the river flows',
      cameraMotion,
      cameraSpeed: cameraMotion === 'STATIC' ? 'NONE' : 'SLOW',
      environmentMotion: 'water moves',
      emotionalTiming: '',
      speakingMotion: '',
      stabilityConstraints: ['Keep the frame stable'],
    },
    initialState: state,
    finalState: state,
    continuation,
    plannedDurationMs: 2_000,
    variationIntent: 'NORMAL',
  };
}

const continuationCandidate: ShotPlanCandidate = {
  beats: [
    {
      id: 'beat-1',
      ordinal: 1,
      sourceRange: { startOffset: 0, endOffset: 7 },
      kind: 'ACTION',
      meaning: 'The river flows',
      importance: 'MEDIUM',
      turningPoint: false,
      timingGroupKey: 'river',
    },
    {
      id: 'beat-2',
      ordinal: 2,
      sourceRange: { startOffset: 7, endOffset: 14 },
      kind: 'ACTION',
      meaning: 'The river continues',
      importance: 'MEDIUM',
      turningPoint: false,
      timingGroupKey: 'river',
    },
  ],
  shots: [
    continuationShot('shot-1', 'beat-1', 1, 'STATIC', {
      mode: 'NEW_KEYFRAME',
      eligible: false,
      reason: 'First Shot',
      version: 'continuation-v1',
    }),
    continuationShot('shot-2', 'beat-2', 2, 'PUSH_IN', {
      mode: 'CONTINUE_PREVIOUS',
      eligible: true,
      reason: 'Retains the established frame',
      version: 'continuation-v1',
    }),
  ],
};

function bindShotImage(
  database: DatabaseHandle,
  shotPlanId: string,
  shotId: string,
  sha256: string,
  revision: number,
): string {
  const settings = new ImageGenerationSettingsRepository(database).getOrCreate(projectId);
  const packageId = randomUUID();
  const packageFingerprint = `${shotId}-package`;
  database.sqlite
    .prepare(
      `INSERT INTO visual_prompt_packages(
        id,project_id,scene_revision_id,shot_plan_id,shot_stable_id,revision,status,payload,
        consistency_status,consistency_issues,input_fingerprint,prompt_template_version,
        row_version,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      packageId,
      projectId,
      sceneId,
      shotPlanId,
      shotId,
      revision,
      'CURRENT',
      '{}',
      'PASS',
      '[]',
      packageFingerprint,
      'shot-test-v1',
      1,
      1,
      '2026-01-01',
      '2026-01-01',
    );
  return new SceneImageGenerationRepository(database).commitManual({
    projectId,
    sceneStableId,
    sceneRevisionId: sceneId,
    shotPlanId,
    shotStableId: shotId,
    visualPromptPackageId: packageId,
    packageFingerprint,
    settingsFingerprint: settings.inputFingerprint,
    assetPath: `projects/${projectId}/images/shots/${shotId}/manual.png`,
    mediaType: 'image/png',
    bytes: 10,
    sha256,
    width: 64,
    height: 64,
  }).assetId!;
}
describe('SceneVideoService', () => {
  it('refuses to schedule a Ken Burns scene', async () => {
    const { context, database, clipFixture } = await setup();
    const service = new SceneVideoService(
      context,
      new FakeVideoProvider(clipFixture, context.workspace.staging),
    );
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
    for (const key of [
      'id',
      'projectId',
      'rowVersion',
      'inputFingerprint',
      'createdAt',
      'updatedAt',
    ])
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
    const service = new SceneVideoService(
      context,
      new OomProvider(clipFixture, context.workspace.staging),
    );
    service.setMotionSource(projectId, sceneId, 'AI_VIDEO');
    const scheduled = service.schedule(projectId, sceneId, {});
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('video-worker')!;
    await expect(service.executeStep(step, 'video-worker')).rejects.toBeTruthy();
    const failed = service.getGeneration(projectId, sceneId, scheduled.generation.id);
    expect(failed.status).toBe('FAILED');
    database.sqlite.close();
  });

  it('rejects invalid motion plan intent fields', async () => {
    const { context, database, clipFixture } = await setup();
    const service = new SceneVideoService(
      context,
      new FakeVideoProvider(clipFixture, context.workspace.staging),
    );
    expect(() =>
      service.updateMotionPlan(projectId, sceneId, { cameraMotion: 'FLY_TO_MARS' }),
    ).toThrowError(/cameraMotion/u);
    expect(() =>
      service.updateMotionPlan(projectId, sceneId, { intensity: 'ABSURD' }),
    ).toThrowError(/intensity/u);
    expect(() =>
      service.updateMotionPlan(projectId, sceneId, { priority: 'URGENT_999' }),
    ).toThrowError(/priority/u);
    database.sqlite.close();
  });

  it('enforces expectedRevision on motion plan updates', async () => {
    const { context, database, clipFixture } = await setup();
    const service = new SceneVideoService(
      context,
      new FakeVideoProvider(clipFixture, context.workspace.staging),
    );
    expect(
      service.updateMotionPlan(projectId, sceneId, { characterAction: 'she waits' }).revision,
    ).toBe(2);
    expect(
      service.updateMotionPlan(projectId, sceneId, {
        expectedRevision: 2,
        characterAction: 'she runs',
      }).revision,
    ).toBe(3);
    let conflict: unknown;
    try {
      service.updateMotionPlan(projectId, sceneId, {
        expectedRevision: 2,
        characterAction: 'she sleeps',
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(AppError);
    expect((conflict as AppError).statusCode).toBe(409);
    expect((conflict as AppError).code).toBe('CONFLICT');
    expect((conflict as AppError).message).toMatch(/reload and retry/u);
    database.sqlite.close();
  });

  it('refuses rejected and unreviewed current images as AI video sources when approval is required', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    requireImageApproval(database, true);
    bindImageGeneration(database, 'REJECTED');
    expect(() => service.schedule(projectId, sceneId, {})).toThrowError(
      'A current accepted scene image is required before AI video generation',
    );
    database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET review_status='UNREVIEWED'
         WHERE project_id=? AND scene_stable_id=?`,
      )
      .run(projectId, sceneStableId);
    expect(() => service.schedule(projectId, sceneId, {})).toThrowError(
      'A current accepted scene image is required before AI video generation',
    );
    database.sqlite.close();
  });

  it('schedules from an accepted current image when approval is required', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    requireImageApproval(database, true);
    bindImageGeneration(database, 'ACCEPTED');
    const scheduled = service.schedule(projectId, sceneId, {});
    expect(scheduled.reused).toBe(false);
    expect(scheduled.generation.status).toBe('PENDING');
    database.sqlite.close();
  });

  it('keeps the canonical image gate when approval is disabled', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(database, context, clipFixture);
    requireImageApproval(database, false);
    // Documented approval-off behavior: an unreviewed current image still
    // schedules, but a rejected current image is never an AI video source.
    bindImageGeneration(database, 'UNREVIEWED');
    expect(service.schedule(projectId, sceneId, {}).reused).toBe(false);
    database.sqlite
      .prepare(
        `UPDATE scene_image_generations SET review_status='REJECTED'
         WHERE project_id=? AND scene_stable_id=?`,
      )
      .run(projectId, sceneStableId);
    expect(() => service.schedule(projectId, sceneId, {})).toThrowError(
      'A current accepted scene image is required before AI video generation',
    );
    database.sqlite.close();
  });
  it('extracts and persists exact prior Shot frame lineage before continuation generation', async () => {
    const { context, database, clipFixture } = await setup();
    const plan = new ShotPlanRepository(database).saveCurrent({
      stableId: 'shot-plan-scene-1',
      projectId,
      chapterId,
      sceneId: sceneStableId,
      sceneRevisionId: sceneId,
      templateVersion: 'shot-director-v1',
      schemaVersion: 'shot-plan-v1',
      inputFingerprint: 'shot-plan-fingerprint',
      candidate: continuationCandidate,
    });
    database.sqlite
      .prepare("UPDATE shot_plans SET review_status='APPROVED' WHERE id=?")
      .run(plan.id);
    const firstImageAssetId = bindShotImage(database, plan.id, 'shot-1', 'b'.repeat(64), 1);
    bindShotImage(database, plan.id, 'shot-2', 'c'.repeat(64), 2);
    new TimelineRepository(database).createSceneTiming({
      projectId,
      chapterId,
      chapterRevision: 1,
      audioAssetId: firstImageAssetId,
      mode: 'MANUAL',
      durationMs: 4_000,
      minimumSceneDurationMs: 1_000,
      items: [
        {
          sceneId,
          sceneRevision: 1,
          sourceRange: { start: 0, end: 14 },
          rawStartMs: 0,
          rawEndMs: 4_000,
          startMs: 0,
          endMs: 4_000,
          durationMs: 4_000,
          warning: null,
        },
      ],
      warnings: [],
      inputFingerprint: 'shot-timing-fingerprint',
    });
    const service = await configuredService(database, context, clipFixture);
    const workflow = new WorkflowRepository(database);

    const first = service.scheduleShot(projectId, sceneId, 'shot-1');
    const firstStep = workflow.claim('video-worker')!;
    expect(firstStep.type).toBe('GENERATE_AI_SHOT_VIDEO');
    await service.executeStep(firstStep, 'video-worker');
    workflow.complete(firstStep);
    const accepted = service.acceptShot(projectId, sceneId, 'shot-1', first.generation.id, {});
    expect(accepted.assetId).toBeTruthy();

    const second = service.scheduleShot(projectId, sceneId, 'shot-2');
    expect(second.generation.continuationSource).toMatchObject({
      sourceShotId: 'shot-1',
      sourceVideoAssetId: accepted.assetId,
      frameSha256: '0'.repeat(64),
      framePosition: 1,
      extractorVersion: 'ffmpeg-final-frame-v1',
    });
    const extractionStep = workflow.claim('video-worker')!;
    expect(extractionStep.type).toBe('EXTRACT_SHOT_CONTINUATION_FRAME');
    await service.executeContinuationStep(extractionStep);
    workflow.complete(extractionStep);

    const extracted = service.getShotGeneration(projectId, sceneId, 'shot-2', second.generation.id);
    const continuation = extracted.continuationSource!;
    expect(continuation).toMatchObject({
      sourceShotId: 'shot-1',
      sourceVideoAssetId: accepted.assetId,
      framePosition: 1,
      extractorVersion: 'ffmpeg-final-frame-v1',
    });
    expect(continuation.frameSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(continuation.frameSha256).not.toBe('0'.repeat(64));
    const frame = database.sqlite
      .prepare('SELECT status,is_current,source_entity_id,metadata FROM assets WHERE id=?')
      .get(continuation.frameAssetId) as {
      status: string;
      is_current: number;
      source_entity_id: string;
      metadata: string;
    };
    expect(frame).toMatchObject({
      status: 'READY',
      is_current: 1,
      source_entity_id: first.generation.id,
    });
    expect(JSON.parse(frame.metadata)).toMatchObject({
      sourceShotId: 'shot-1',
      sourceVideoAssetId: accepted.assetId,
      sourceVideoSha256: expect.any(String),
      framePosition: 1,
      extractorVersion: 'ffmpeg-final-frame-v1',
    });

    const generationStep = workflow.claim('video-worker')!;
    expect(generationStep.type).toBe('GENERATE_AI_SHOT_VIDEO');
    await service.executeStep(generationStep, 'video-worker');
    workflow.complete(generationStep);
    const completed = service.getShotGeneration(projectId, sceneId, 'shot-2', second.generation.id);
    expect(completed.metadata.request).toMatchObject({
      continuationSource: {
        frameAssetId: continuation.frameAssetId,
        frameSha256: continuation.frameSha256,
      },
    });
    database.sqlite.close();
  });
  it('persists critic infrastructure failure as unavailable quality', async () => {
    const { context, database, clipFixture } = await setup();
    const service = await configuredService(
      database,
      context,
      clipFixture,
      new UnavailableTemporalCritic(),
    );
    const workflow = new WorkflowRepository(database);
    const scheduled = service.schedule(projectId, sceneId, {});
    const step = workflow.claim('video-worker')!;
    await service.executeStep(step, 'video-worker');
    workflow.complete(step);

    expect(service.getGeneration(projectId, sceneId, scheduled.generation.id)).toMatchObject({
      status: 'COMPLETED',
      automaticQualityStatus: 'UNAVAILABLE',
      criticEvaluationId: expect.any(String),
      isCurrent: false,
    });
    expect(workflow.claim('video-worker')).toBeNull();
    database.sqlite.close();
  });
  it('records temporal rejection guidance and stops at the retry limit', async () => {
    const { context, database, clipFixture } = await setup();
    const critic = new TemporalCriticAgent();
    const service = await configuredService(database, context, clipFixture, critic);
    const workflow = new WorkflowRepository(database);
    const first = service.schedule(projectId, sceneId, {});
    let step = workflow.claim('video-worker')!;
    await service.executeStep(step, 'video-worker');
    workflow.complete(step);

    const firstCompleted = service.getGeneration(projectId, sceneId, first.generation.id);
    expect(firstCompleted).toMatchObject({
      status: 'COMPLETED',
      automaticQualityStatus: 'REJECTED',
      criticEvaluationId: expect.any(String),
      isCurrent: false,
    });
    let generations = service.listGenerations(projectId, sceneId);
    expect(generations).toHaveLength(2);
    expect((generations[0]!.metadata as Record<string, unknown>).qualityRetry).toMatchObject({
      sourceGenerationId: first.generation.id,
      issues: ['IDENTITY_DRIFT', 'FLICKER'],
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      step = workflow.claim('video-worker')!;
      await service.executeStep(step, 'video-worker');
      workflow.complete(step);
      generations = service.listGenerations(projectId, sceneId);
    }
    expect(critic.calls).toBe(3);
    expect(generations).toHaveLength(3);
    expect(
      generations.filter((generation) => generation.automaticQualityStatus === 'REJECTED'),
    ).toHaveLength(2);
    const exhausted = generations.find(
      (generation) => generation.automaticQualityStatus === 'MANUAL_REVIEW_REQUIRED',
    );
    expect(exhausted).toBeDefined();
    expect(exhausted?.reviewNotes).toContain('retry limit exhausted');
    expect(generations.every((generation) => !generation.isCurrent)).toBe(true);
    expect(workflow.claim('video-worker')).toBeNull();
    database.sqlite.close();
  });
});
