import { copyFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  VisualProfileRepository,
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
import { ImageProviderError, type ImageProvider } from './comfyui.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const sceneStableId = 'scene-stable-1';

async function setup(): Promise<{
  context: StudioContext;
  database: DatabaseHandle;
  fixture: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'studio-image-workflow-'));
  const database = createDatabase(join(root, 'studio.db'));
  migrateDatabase(database);
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Image workflow', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
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
  constructor(
    private readonly fixture: string,
    private readonly outputRoot: string,
  ) {}

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
    const regeneration = restarted.regenerate(projectId, sceneId, completed.id, {
      mode: 'SAME_SEED',
      instructions: 'Keep the composition',
    });
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
    await expect(images.executeStep(step, 'image-worker')).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    expect(images.getGeneration(projectId, sceneId, scheduled.generation.id).status).toBe('FAILED');
    database.sqlite.close();
  });

  it('binds approved references, conditions scheduling, and stales in-flight work on reference change', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    const profiles = new VisualProfileRepository(database);
    database.sqlite
      .prepare(
        `INSERT INTO assets(
          id,project_id,type,role,status,path,media_type,bytes,sha256,metadata,is_current,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        '66666666-6666-4666-8666-666666666666',
        projectId,
        'CHARACTER_REFERENCE_IMAGE',
        'CHARACTER_REFERENCE_IMAGE',
        'READY',
        `projects/${projectId}/references/ref-v1.png`,
        'image/png',
        1,
        'a'.repeat(64),
        JSON.stringify({ characterId: 'li-wei', approval: 'APPROVED' }),
        0,
        '2026-01-01',
        '2026-01-01',
      );
    database.sqlite
      .prepare(
        `INSERT INTO scene_characters(
          id,scene_revision_id,character_id,display_name,resolution_status,role_in_scene,visual_state,dependency_fingerprint,created_at
        ) VALUES('sc1',?,'li-wei','Li Wei','RESOLVED','protagonist','{}',NULL,'2026-01-01')`,
      )
      .run(sceneId);
    profiles.saveCharacter({
      projectId,
      characterId: 'li-wei',
      payload: { referenceAssetIds: ['66666666-6666-4666-8666-666666666666'] },
      inputFingerprint: 'profile-with-reference',
      status: 'APPROVED',
    });
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);

    // Conditioned scheduling requires an approved reference and succeeds here.
    const conditioned = images.schedule(projectId, sceneId, {
      conditioningMode: 'REFERENCE_CONDITIONED',
    });
    const metadata = conditioned.generation.metadata as {
      request: {
        conditioning: { mode: string; characters: Array<Record<string, unknown>> };
        providerSettings: { workflowTemplate: string };
      };
    };
    expect(metadata.request.providerSettings.workflowTemplate).toBe('reference-character-v1');
    expect(metadata.request.conditioning.mode).toBe('REFERENCE_CONDITIONED');
    expect(metadata.request.conditioning.characters).toHaveLength(1);
    expect(metadata.request.conditioning.characters[0]).toMatchObject({
      characterId: 'li-wei',
      referenceAssetId: '66666666-6666-4666-8666-666666666666',
      referenceSha256: 'a'.repeat(64),
    });
    expect(conditioned.generation.workflowTemplate).toBe('reference-character-v1');
    // A different mode produces a different fingerprint.
    const baseline = images.schedule(projectId, sceneId, { conditioningMode: 'TEXT_ONLY' });
    expect(baseline.generation.inputFingerprint).not.toBe(conditioned.generation.inputFingerprint);
    expect(baseline.generation.workflowTemplate).toBe('text-to-image-v1');
    // Conditioned scheduling without any approved reference fails explicitly.
    profiles.saveCharacter({
      projectId,
      characterId: 'li-wei',
      payload: { referenceAssetIds: [] },
      inputFingerprint: 'profile-without-reference',
      status: 'APPROVED',
    });
    studio.visual.buildPromptPackage({ projectId, sceneId });
    try {
      images.schedule(projectId, sceneId, { conditioningMode: 'REFERENCE_CONDITIONED' });
      throw new Error('expected PREREQUISITE_MISSING');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('PREREQUISITE_MISSING');
    }

    // Restore the reference, schedule, then remove the primary mid-flight.
    const restored = profiles.saveCharacter({
      projectId,
      characterId: 'li-wei',
      payload: { referenceAssetIds: ['66666666-6666-4666-8666-666666666666'] },
      inputFingerprint: 'profile-reference-restored',
      status: 'APPROVED',
    });
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const inFlight = images.schedule(projectId, sceneId, {
      conditioningMode: 'REFERENCE_CONDITIONED',
    });
    const workflow = new WorkflowRepository(database);
    let step = workflow.claim('image-worker')!;
    while (step.id !== inFlight.stepId) {
      workflow.complete(step);
      step = workflow.claim('image-worker')!;
    }
    studio.visual.updateCharacterProfile(projectId, 'li-wei', {
      expectedRevision: restored.revision,
      referenceAssetIds: [],
    });
    await expect(images.executeStep(step, 'image-worker')).rejects.toMatchObject({
      code: 'STALE_INPUT',
    });
    const staleGeneration = images.getGeneration(projectId, sceneId, inFlight.generation.id);
    expect(staleGeneration.status).toBe('FAILED');
    expect(staleGeneration.isCurrent).toBe(false);
    expect(staleGeneration.assetId).toBeNull();
    database.sqlite.close();
  });

  it('schedules four candidates with unique seeds, one set, and keeps them non-current', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const scheduled = images.schedule(projectId, sceneId, { candidateCount: 4 });
    const all = images.listGenerations(projectId, sceneId);
    expect(all).toHaveLength(4);
    const seeds = new Set(all.map((image) => image.requestedSeed));
    expect(seeds.size).toBe(4);
    const metadata = scheduled.generation.metadata as {
      candidateSetId: string;
      candidateIndex: number;
    };
    expect(metadata.candidateSetId).toBeTruthy();
    const workflow = new WorkflowRepository(database);
    let step = workflow.claim('image-worker');
    while (step) {
      await images.executeStep(step, 'image-worker');
      workflow.complete(step);
      step = workflow.claim('image-worker');
    }
    const after = images.listGenerations(projectId, sceneId);
    expect(after.every((image) => image.status === 'COMPLETED')).toBe(true);
    expect(after.every((image) => !image.isCurrent)).toBe(true);
    expect(after.every((image) => image.productionBlockers.includes('NOT_CURRENT'))).toBe(true);
    // Accept one candidate; it becomes the only current image.
    const accepted = images.acceptCandidate(projectId, sceneId, after[2]!.id, {
      status: 'REJECTED',
      issues: [],
      notes: 'selected',
    });
    expect(accepted.isCurrent).toBe(true);
    expect(
      images.listGenerations(projectId, sceneId).filter((image) => image.isCurrent),
    ).toHaveLength(1);
    database.sqlite.close();
  });

  it('regenerates with deterministic review feedback and fresh reference mapping', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const first = images.schedule(projectId, sceneId, {});
    const workflow = new WorkflowRepository(database);
    const step = workflow.claim('image-worker')!;
    await images.executeStep(step, 'image-worker');
    workflow.complete(step);
    images.updateReview(projectId, sceneId, first.generation.id, {
      status: 'REJECTED',
      scores: { COMPOSITION: 2, OVERALL: 2 },
      issues: ['WRONG_COMPOSITION', 'MISSING_OBJECT', 'REFERENCE_POSE_BLEED'],
      notes: 'Engine room framing was lost',
    });
    const regenerated = images.regenerate(projectId, sceneId, first.generation.id, {
      mode: 'SAME_SEED',
      useReviewFeedback: true,
    });
    const request = regenerated.generation.metadata as {
      request: { reviewFeedback: { guidance: string; sourceGenerationId: string } | null };
    };
    const feedback = request.request.reviewFeedback;
    expect(feedback).not.toBeNull();
    expect(feedback!.sourceGenerationId).toBe(first.generation.id);
    expect(feedback!.guidance).toContain('composition and camera');
    expect(feedback!.guidance).toContain('Do not copy the reference image framing');
    expect(feedback!.guidance).toContain('required objects');
    const completedFirst = images.getGeneration(projectId, sceneId, first.generation.id);
    expect(regenerated.generation.requestedSeed).toBe(completedFirst.actualSeed);
    // Feedback-less regeneration request is rejected without a rejected review.
    const plain = images.schedule(projectId, sceneId, {});
    expect(() =>
      images.regenerate(projectId, sceneId, plain.generation.id, {
        mode: 'SAME_SEED',
        useReviewFeedback: true,
      }),
    ).toThrow();
    database.sqlite.close();
  });
});

describe('Conditioned batch generation isolation', () => {
  it('keeps completed scenes intact and retries only the failed scene', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    const profiles = new VisualProfileRepository(database);
    const sceneCount = 6;
    for (let index = 2; index <= sceneCount; index += 1) {
      const id = `77777777-7777-4777-8777-77777777777${index}`;
      const stableId = `scene-stable-${index}`;
      database.sqlite
        .prepare(
          `INSERT INTO scene_revisions(
            id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,scene_number,revision,title,summary,
            purpose,source_start_offset,source_end_offset,source_content,visual_description,camera,composition,image_prompt,
            negative_prompt,input_fingerprint,prompt_version,schema_version,status,prompt_status,is_current,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          stableId,
          planId,
          projectId,
          chapterId,
          1,
          index,
          1,
          `Scene ${index}`,
          `Summary ${index}`,
          'INTRODUCTION',
          0,
          14,
          'A quiet river.',
          'A quiet river at dawn.',
          JSON.stringify({ framing: 'MEDIUM', angle: 'Eye level', movementIntent: null }),
          JSON.stringify({
            subjectFocus: 'River',
            foreground: [],
            midground: [],
            background: [],
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
    }
    database.sqlite
      .prepare(
        `INSERT INTO assets(
          id,project_id,type,role,status,path,media_type,bytes,sha256,metadata,is_current,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        '66666666-6666-4666-8666-666666666666',
        projectId,
        'CHARACTER_REFERENCE_IMAGE',
        'CHARACTER_REFERENCE_IMAGE',
        'READY',
        `projects/${projectId}/references/ref-v1.png`,
        'image/png',
        1,
        'a'.repeat(64),
        JSON.stringify({ characterId: 'li-wei', approval: 'APPROVED' }),
        0,
        '2026-01-01',
        '2026-01-01',
      );
    for (const scene of database.sqlite
      .prepare('SELECT id FROM scene_revisions WHERE project_id=?')
      .all(projectId) as Array<{ id: string }>) {
      database.sqlite
        .prepare(
          `INSERT INTO scene_characters(
            id,scene_revision_id,character_id,display_name,resolution_status,role_in_scene,visual_state,dependency_fingerprint,created_at
          ) VALUES(?,?,'li-wei','Li Wei','RESOLVED','protagonist','{}',NULL,'2026-01-01')`,
        )
        .run(`sc-${scene.id}`, scene.id);
    }
    profiles.saveCharacter({
      projectId,
      characterId: 'li-wei',
      payload: { referenceAssetIds: ['66666666-6666-4666-8666-666666666666'] },
      inputFingerprint: 'profile-batch',
      status: 'APPROVED',
    });
    const scenes = database.sqlite
      .prepare('SELECT id,stable_id as stableId FROM scene_revisions WHERE project_id=?')
      .all(projectId) as Array<{ id: string; stableId: string }>;
    for (const scene of scenes) studio.visual.buildPromptPackage({ projectId, sceneId: scene.id });

    let generateCalls = 0;
    const failingCall = 3;
    class FlakyFixtureProvider extends FixtureProvider {
      override async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
        generateCalls += 1;
        if (generateCalls === failingCall)
          throw new ImageProviderError('REFERENCE_UPLOAD_FAILED', 'flaky reference failure', true);
        return super.generate(request);
      }
    }
    const images = createImageGenerationService(
      context,
      new FlakyFixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const batch = images.scheduleBatch(projectId, {
      sceneIds: scenes.map((scene) => scene.id),
      onlyMissing: true,
      includeStale: false,
    });
    expect(batch.jobs).toHaveLength(6);
    const workflow = new WorkflowRepository(database);
    const failures: Array<{ code: string }> = [];
    let failedStepId: string | null = null;
    for (let index = 0; index < batch.jobs.length; index += 1) {
      const step = workflow.claim('image-worker')!;
      try {
        await images.executeStep(step, 'image-worker');
        workflow.complete(step);
      } catch (cause) {
        const retry = (cause as { retryable?: boolean }).retryable ?? false;
        const message = cause instanceof Error ? cause.message : 'failed';
        workflow.fail(step, message, retry);
        if (retry) {
          failedStepId = step.id;
          failures.push({ code: (cause as { code?: string }).code ?? 'UNKNOWN' });
        }
      }
    }
    expect(failures).toHaveLength(1);
    expect(failures[0]?.code).toBe('REFERENCE_UPLOAD_FAILED');
    const statuses = batch.jobs.map((job) =>
      images.getGeneration(projectId, job.generation.sceneRevisionId, job.generation.id),
    );
    // Retry only the failed generation: reset its step, provider now succeeds.
    database.sqlite
      .prepare('UPDATE workflow_steps SET next_attempt_at=NULL WHERE id=?')
      .run(failedStepId!);
    workflow.retryStep(failedStepId!);
    const retryStep = workflow.claim('image-worker');
    expect(retryStep).not.toBeNull();
    expect(retryStep!.id).toBe(failedStepId);
    await images.executeStep(retryStep!, 'image-worker');
    workflow.complete(retryStep!);
    const retried = batch.jobs
      .map((job) =>
        images.getGeneration(projectId, job.generation.sceneRevisionId, job.generation.id),
      )
      .find((generation) => generation.status === 'COMPLETED' && generation.attempt === 2);
    expect(retried).toBeDefined();
    expect(retried?.isCurrent).toBe(true);
    // Completed scenes were not duplicated.
    expect(
      statuses.filter(
        (generation) => generation.status === 'COMPLETED' && generation.attempt === 1,
      ),
    ).toHaveLength(5);
    database.sqlite.close();
  });
});

describe('Candidate batch guardrails', () => {
  it('rejects excessive multi-candidate batches before any writes', async () => {
    const { context, database, fixture } = await setup();
    const studio = new StudioService(context);
    studio.visual.buildPromptPackage({ projectId, sceneId });
    const images = createImageGenerationService(
      context,
      new FixtureProvider(fixture, context.workspace.staging),
    );
    configure(images);
    const sceneIds = Array.from({ length: 11 }, (_, index) =>
      index === 0
        ? sceneId
        : `${index === 10 ? '7' : '8'}${String(index).padStart(7, '0')}-7777-4777-8777-77777777777${index === 10 ? '0' : index}`,
    );
    expect(() =>
      images.scheduleBatch(projectId, {
        sceneIds,
        onlyMissing: true,
        includeStale: false,
        candidateCount: 4,
      }),
    ).toThrow(/limited to 40/u);
    const setCount = database.sqlite
      .prepare('SELECT COUNT(*) as count FROM scene_image_candidate_sets')
      .get() as { count: number };
    const generationCount = database.sqlite
      .prepare('SELECT COUNT(*) as count FROM scene_image_generations')
      .get() as { count: number };
    const stepCount = database.sqlite
      .prepare('SELECT COUNT(*) as count FROM workflow_steps')
      .get() as { count: number };
    expect(setCount.count).toBe(0);
    expect(generationCount.count).toBe(0);
    expect(stepCount.count).toBe(0);
    database.sqlite.close();
  });
});
