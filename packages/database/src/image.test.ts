import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  ImageGenerationSettingsRepository,
  SceneImageGenerationRepository,
  SceneImageCandidateSetRepository,
  WorkflowRepository,
} from './index.js';
import type { DatabaseHandle } from './db.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const planId = '33333333-3333-4333-8333-333333333333';
const sceneRevisionId = '44444444-4444-4444-8444-444444444444';
const sceneStableId = '55555555-5555-4555-8555-555555555555';
const packageId = '66666666-6666-4666-8666-666666666666';
const providerJobId = '77777777-7777-4777-8777-777777777777';

function setup(filename = ':memory:'): DatabaseHandle {
  const database = createDatabase(filename);
  migrateDatabase(database);
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Image test', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(chapterId, projectId, 1, 'Chapter', 'Text', 'ACTIVE', 1, 1, '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      'INSERT INTO scene_plan_revisions(id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
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
        purpose,source_start_offset,source_end_offset,visual_description,camera,composition,image_prompt,negative_prompt,
        input_fingerprint,prompt_version,schema_version,status,prompt_status,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      sceneRevisionId,
      sceneStableId,
      planId,
      projectId,
      chapterId,
      1,
      1,
      1,
      'Scene',
      'Summary',
      'INTRODUCTION',
      0,
      10,
      'Visual',
      '{}',
      '{}',
      'Prompt',
      'Negative',
      'scene-fingerprint',
      'scene-v1',
      'scene-v1',
      'CURRENT',
      'CURRENT',
      1,
      '2026-01-01',
      '2026-01-01',
    );
  database.sqlite
    .prepare(
      `INSERT INTO visual_prompt_packages(
        id,project_id,scene_revision_id,revision,status,payload,consistency_status,input_fingerprint,prompt_template_version,
        row_version,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      packageId,
      projectId,
      sceneRevisionId,
      1,
      'CURRENT',
      '{}',
      'PASS',
      'package-fingerprint',
      'visual-prompt-v1',
      1,
      1,
      '2026-01-01',
      '2026-01-01',
    );
  return database;
}

describe('scene image persistence', () => {
  it('creates settings, revisions, and keeps optimistic updates safe', () => {
    const database = setup();
    const settings = new ImageGenerationSettingsRepository(database);
    const current = settings.getOrCreate(projectId);
    expect(current.width).toBe(1024);
    const updated = settings.update(projectId, {
      provider: current.provider,
      baseUrl: current.baseUrl,
      workflowTemplate: current.workflowTemplate,
      diffusionModel: current.diffusionModel,
      textEncoder: current.textEncoder,
      vaeName: current.vaeName,
      sampler: current.sampler,
      connectionTimeoutMs: current.connectionTimeoutMs,
      generationTimeoutMs: current.generationTimeoutMs,
      width: 768,
      height: current.height,
      steps: current.steps,
      guidance: current.guidance,
      seedMode: current.seedMode,
      fixedSeed: current.fixedSeed,
      conditioningMode: current.conditioningMode,
      requireImageApproval: current.requireImageApproval,
      expectedRowVersion: current.rowVersion,
    });
    expect(updated.rowVersion).toBe(current.rowVersion + 1);
    expect(() =>
      settings.update(projectId, {
        provider: current.provider,
        baseUrl: current.baseUrl,
        workflowTemplate: current.workflowTemplate,
        diffusionModel: current.diffusionModel,
        textEncoder: current.textEncoder,
        vaeName: current.vaeName,
        sampler: current.sampler,
        connectionTimeoutMs: current.connectionTimeoutMs,
        generationTimeoutMs: current.generationTimeoutMs,
        width: current.width,
        height: 720,
        steps: current.steps,
        guidance: current.guidance,
        seedMode: current.seedMode,
        fixedSeed: current.fixedSeed,
        conditioningMode: current.conditioningMode,
        requireImageApproval: current.requireImageApproval,
        expectedRowVersion: current.rowVersion,
      }),
    ).toThrow(/changed/);
    database.sqlite.close();
  });

  it('commits a guarded generated asset and derives stale freshness', () => {
    const database = setup();
    const settings = new ImageGenerationSettingsRepository(database).getOrCreate(projectId);
    const repository = new SceneImageGenerationRepository(database);
    const generation = repository.create({
      projectId,
      sceneStableId,
      sceneRevisionId,
      visualPromptPackageId: packageId,
      source: 'GENERATED',
      provider: 'COMFYUI',
      requestedSeed: 42,
      requestedWidth: 1024,
      requestedHeight: 576,
      providerJobId,
      workflowTemplate: 'text-to-image-v1',
      modelSettings: { width: 1024 },
      packageFingerprint: 'package-fingerprint',
      settingsFingerprint: settings.inputFingerprint,
      inputFingerprint: 'generation-fingerprint',
      generationInstructions: '',
    });
    const workflow = new WorkflowRepository(database);
    const executionId = workflow.createExecution(projectId, 'IMAGE_GENERATION');
    const stepId = workflow.createStep(
      executionId,
      'scene-image',
      'GENERATE_SCENE_IMAGE',
      sceneRevisionId,
      'generation-fingerprint',
      3,
      {},
    );
    workflow.createJob('GENERATE_SCENE_IMAGE', sceneRevisionId, stepId);
    repository.linkWorkflowStep(projectId, generation.id, stepId);
    const claim = workflow.claim('image-worker')!;
    repository.markRunning(projectId, generation.id, claim.attemptNumber);
    const commit = {
      generationId: generation.id,
      projectId,
      sceneStableId,
      sceneRevisionId,
      assetPath: `projects/${projectId}/images/scenes/${sceneStableId}/${generation.id}.png`,
      mediaType: 'image/png' as const,
      bytes: 10,
      sha256: 'hash',
      width: 1024,
      height: 576,
      seed: 42,
      durationMs: 100,
    };
    expect(
      repository.commitGenerated(commit, {
        stepId: claim.id,
        attemptId: '88888888-8888-4888-8888-888888888888',
        workerId: 'image-worker',
        inputFingerprint: claim.input_fingerprint,
      }),
    ).toBe(false);
    expect(database.sqlite.prepare('SELECT COUNT(*) as count FROM assets').get()).toEqual({
      count: 0,
    });
    expect(
      repository.commitGenerated(commit, {
        stepId: claim.id,
        attemptId: claim.attemptId,
        workerId: 'image-worker',
        inputFingerprint: claim.input_fingerprint,
      }),
    ).toBe(true);
    const completed = repository.get(projectId, generation.id)!;
    expect(completed.status).toBe('COMPLETED');
    expect(completed.freshness).toBe('CURRENT');
    expect(completed.assetId).toBeTruthy();
    database.sqlite
      .prepare("UPDATE visual_prompt_packages SET status='STALE',is_current=0 WHERE id=?")
      .run(packageId);
    expect(repository.get(projectId, generation.id)?.freshness).toBe('STALE');
    database.sqlite.close();
  });

  it('keeps manual replacements, reviews, current pointers, and project scope coherent', () => {
    const database = setup();
    const repository = new SceneImageGenerationRepository(database);
    const first = repository.commitManual({
      projectId,
      sceneStableId,
      sceneRevisionId,
      assetPath: `projects/${projectId}/images/scenes/${sceneStableId}/manual-a.png`,
      mediaType: 'image/png',
      bytes: 11,
      sha256: 'manual-a',
      width: 640,
      height: 360,
      notes: 'first',
    });
    const second = repository.commitManual({
      projectId,
      sceneStableId,
      sceneRevisionId,
      assetPath: `projects/${projectId}/images/scenes/${sceneStableId}/manual-b.webp`,
      mediaType: 'image/webp',
      bytes: 12,
      sha256: 'manual-b',
      width: 1280,
      height: 720,
    });

    expect(repository.getCurrent(projectId, sceneStableId)?.id).toBe(second.id);
    expect(repository.get(projectId, first.id)?.isCurrent).toBe(false);
    expect(repository.get('99999999-9999-4999-8999-999999999999', second.id)).toBeNull();
    expect(
      repository.updateReview(projectId, first.id, {
        status: 'REJECTED',
        notes: 'framing off',
        scores: { COMPOSITION: 2 },
        issues: ['WRONG_COMPOSITION'],
      }),
    ).toMatchObject({ reviewStatus: 'REJECTED', notes: 'framing off' });
    expect(repository.setCurrent(projectId, sceneStableId, first.id, 1).id).toBe(first.id);
    expect(repository.getCurrent(projectId, sceneStableId)?.id).toBe(first.id);
    expect(repository.list(projectId, sceneStableId).map((image) => image.revision)).toEqual([
      2, 1,
    ]);
    expect(() => repository.setCurrent(projectId, sceneStableId, second.id, 2)).toThrow(/changed/);
    database.sqlite.close();
  });
  it('groups candidate sets, enforces unique indexes, and persists reviews after reopen', () => {
    const database = setup(join(tmpdir(), `candidates-${randomUUID()}.db`));
    const repository = new SceneImageGenerationRepository(database);
    const candidateSets = new SceneImageCandidateSetRepository(database);
    const set = candidateSets.create({
      projectId,
      sceneStableId,
      sceneRevisionId: sceneRevisionId,
      visualPromptPackageId: null,
      mode: 'REFERENCE_CONDITIONED',
      workflowTemplate: 'reference-character-v1',
      packageFingerprint: 'pkg',
      settingsFingerprint: 'set',
      requestedCount: 4,
      generationInstructions: null,
      metadata: { characters: [{ characterId: 'linh' }] },
    });
    expect(set.requestedCount).toBe(4);
    const createCandidate = (index: number) =>
      repository.create({
        projectId,
        sceneStableId,
        sceneRevisionId: sceneRevisionId,
        visualPromptPackageId: null,
        source: 'MANUAL',
        provider: null,
        status: 'COMPLETED',
        requestedSeed: 100 + index,
        requestedWidth: 1024,
        requestedHeight: 576,
        providerJobId: null,
        workflowTemplate: null,
        modelSettings: {},
        packageFingerprint: null,
        settingsFingerprint: null,
        inputFingerprint: `fp-${index}`,
        generationInstructions: null,
      });
    const candidateA = createCandidate(1);
    const candidateB = createCandidate(2);
    database.sqlite
      .prepare('UPDATE scene_image_generations SET candidate_set_id=?,candidate_index=? WHERE id=?')
      .run(set.id, 1, candidateA.id);
    database.sqlite
      .prepare('UPDATE scene_image_generations SET candidate_set_id=?,candidate_index=? WHERE id=?')
      .run(set.id, 2, candidateB.id);
    expect(() =>
      database.sqlite
        .prepare(
          'UPDATE scene_image_generations SET candidate_set_id=?,candidate_index=? WHERE id=?',
        )
        .run(set.id, 1, candidateB.id),
    ).toThrow(/UNIQUE/);
    expect(
      repository.updateReview(projectId, candidateA.id, {
        status: 'REJECTED',
        scores: { COMPOSITION: 2, OVERALL: 2 },
        issues: ['WRONG_COMPOSITION', 'REFERENCE_POSE_BLEED'],
        notes: 'reference framing dominates',
      }).review,
    ).toMatchObject({
      status: 'REJECTED',
      scores: { COMPOSITION: 2, OVERALL: 2 },
      issues: ['WRONG_COMPOSITION', 'REFERENCE_POSE_BLEED'],
      notes: 'reference framing dominates',
    });
    const assetId = '88888888-8888-4888-8888-888888888888';
    database.sqlite
      .prepare(
        `INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,input_fingerprint,metadata,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        assetId,
        projectId,
        'SCENE_IMAGE',
        `scene:${sceneStableId}:image`,
        'READY',
        `projects/${projectId}/images/scenes/x/${candidateB.id}.png`,
        'image/png',
        10,
        'candidate-b',
        'fp',
        '{}',
        0,
        '2026-01-01',
        '2026-01-01',
      );
    database.sqlite
      .prepare('UPDATE scene_image_generations SET asset_id=? WHERE id=?')
      .run(assetId, candidateB.id);
    expect(
      repository.acceptCandidate(projectId, sceneStableId, candidateB.id, {
        status: 'REJECTED',
        notes: 'approved instead',
        issues: [],
      }).isCurrent,
    ).toBe(true);
    expect(candidateSets.get(projectId, set.id)?.metadata.characters).toEqual([
      { characterId: 'linh' },
    ]);
    const databasePath = database.sqlite.name;
    database.sqlite.close();
    const reopened = createDatabase(databasePath);
    migrateDatabase(reopened);
    expect(
      reopened.sqlite
        .prepare('SELECT requested_count as requestedCount FROM scene_image_candidate_sets')
        .get(),
    ).toMatchObject({ requestedCount: 4 });
    reopened.sqlite.close();
  });
});
