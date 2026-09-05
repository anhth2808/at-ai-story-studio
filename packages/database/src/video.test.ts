import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AssetRepository,
  SceneVideoGenerationRepository,
  VideoGenerationSettingsRepository,
  WorkflowRepository,
  createDatabase,
  migrateDatabase,
} from './index.js';

function fixture() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const projectId = randomUUID();
  const chapterId = randomUUID();
  const planId = randomUUID();
  const sceneId = randomUUID();
  const sceneStableId = randomUUID();
  const imageId = randomUUID();
  const stamp = '2026-01-01T00:00:00.000Z';
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,description,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(projectId, 'Project', '', 'vi', '{}', stamp, stamp);
  database.sqlite
    .prepare(
      'INSERT INTO chapters(id,project_id,number,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(chapterId, projectId, 1, 'Chapter', 'A short story.', stamp, stamp);
  database.sqlite
    .prepare(
      `INSERT INTO scene_plan_revisions(
        id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(planId, projectId, chapterId, 1, 1, 'MEDIUM', 'scene-plan', 'CURRENT', 1, stamp, stamp);
  database.sqlite
    .prepare(
      `INSERT INTO scene_revisions(
        id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,scene_number,revision,
        title,summary,purpose,source_start_offset,source_end_offset,visual_description,camera,composition,
        image_prompt,input_fingerprint,prompt_version,schema_version,is_current,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      'Scene',
      'Summary',
      'INTRODUCTION',
      0,
      10,
      'A scene',
      'Eye level',
      'Centered',
      'A scene',
      'scene',
      'v1',
      'v1',
      1,
      stamp,
      stamp,
    );
  new AssetRepository(database).register({
    id: imageId,
    projectId,
    type: 'SCENE_IMAGE',
    role: `scene:${sceneStableId}:image`,
    path: 'projects/p/scene.png',
    mediaType: 'image/png',
    bytes: 1,
    sha256: 'a'.repeat(64),
  });
  database.sqlite
    .prepare(
      `INSERT INTO scene_image_generations(
        id,project_id,scene_stable_id,scene_revision_id,revision,source,status,review_status,
        is_current,input_fingerprint,asset_id,automatic_quality_status,created_at,updated_at
      ) VALUES(?,?,?,?,?,'MANUAL','COMPLETED','ACCEPTED',1,?,?, 'NOT_RUN',?,?)`,
    )
    .run(randomUUID(), projectId, sceneStableId, sceneId, 1, 'manual-image', imageId, stamp, stamp);
  return { database, projectId, chapterId, sceneId, sceneStableId, imageId };
}

describe('scene video generation repository', () => {
  it('persists and returns the selected backend instead of the schema default', () => {
    const { database, projectId, chapterId, sceneId, sceneStableId, imageId } = fixture();
    const generation = new SceneVideoGenerationRepository(database).create({
      projectId,
      chapterId,
      sceneStableId,
      sceneRevisionId: sceneId,
      aiMotionPlanRevisionId: null,
      provider: 'COMFYUI',
      backend: 'LTX2_19B_DISTILLED',
      requestedSeed: 1,
      requestedWidth: 256,
      requestedHeight: 256,
      frameCount: 9,
      fps: 25,
      providerJobId: randomUUID(),
      workflowTemplate: 'ltx2-image-to-video-v1',
      modelSettings: {},
      requestSnapshot: {},
      motionPlanFingerprint: null,
      settingsFingerprint: null,
      inputFingerprint: 'video-input',
      sourceImageAssetId: imageId,
      sourceImageSha256: 'a'.repeat(64),
      generationInstructions: null,
    });
    expect(generation.backend).toBe('LTX2_19B_DISTILLED');
    database.sqlite.close();
  });
  it('only exposes a current Scene video with exact lineage and passing quality', () => {
    const { database, projectId, chapterId, sceneId, sceneStableId, imageId } = fixture();
    database.sqlite.prepare("UPDATE scene_revisions SET status='CURRENT' WHERE id=?").run(sceneId);
    const motionPlanId = randomUUID();
    const stamp = '2026-01-01T00:00:00.000Z';
    database.sqlite
      .prepare(
        `INSERT INTO ai_motion_plan_revisions(
          id,project_id,chapter_id,scene_stable_id,scene_revision_id,revision,character_action,
          environment_motion,camera_motion,intensity,priority,motion_prompt,negative_prompt,
          input_fingerprint,status,is_current,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        motionPlanId,
        projectId,
        chapterId,
        sceneStableId,
        sceneId,
        1,
        'still',
        'still',
        'STATIC',
        'SUBTLE',
        'LOW',
        'still',
        null,
        'motion-input',
        'CURRENT',
        1,
        stamp,
        stamp,
      );
    const repository = new SceneVideoGenerationRepository(database);
    const generation = repository.create({
      projectId,
      chapterId,
      sceneStableId,
      sceneRevisionId: sceneId,
      aiMotionPlanRevisionId: motionPlanId,
      provider: 'COMFYUI',
      backend: 'WAN22_TI2V_5B',
      requestedSeed: 1,
      requestedWidth: 256,
      requestedHeight: 256,
      frameCount: 9,
      fps: 25,
      providerJobId: randomUUID(),
      workflowTemplate: 'image-to-video-v1',
      modelSettings: {},
      requestSnapshot: {},
      motionPlanFingerprint: 'motion-input',
      settingsFingerprint: null,
      inputFingerprint: 'video-input',
      sourceImageAssetId: imageId,
      sourceImageSha256: 'a'.repeat(64),
      generationInstructions: null,
    });
    const assetId = randomUUID();
    new AssetRepository(database).register({
      id: assetId,
      projectId,
      type: 'AI_SCENE_VIDEO',
      role: `scene:${sceneStableId}:ai-motion`,
      path: 'projects/p/scene.mp4',
      mediaType: 'video/mp4',
      bytes: 10,
      sha256: 'b'.repeat(64),
      inputFingerprint: 'video-input',
      metadata: { clipDurationMs: 320 },
    });
    database.sqlite
      .prepare(
        `UPDATE scene_video_generations
         SET status='COMPLETED',automatic_quality_status='PASSED',asset_id=?,is_current=1,
           actual_seed=1,actual_width=256,actual_height=256,clip_duration_ms=320,
           generation_duration_ms=100,completed_at=?,updated_at=?
         WHERE id=?`,
      )
      .run(assetId, stamp, stamp, generation.id);
    expect(repository.currentRenderableSceneVideo(projectId, sceneStableId)).toMatchObject({
      generation: { id: generation.id },
      asset: { id: assetId },
    });
    database.sqlite
      .prepare("UPDATE scene_video_generations SET automatic_quality_status='REJECTED' WHERE id=?")
      .run(generation.id);
    expect(repository.currentRenderableSceneVideo(projectId, sceneStableId)).toBeNull();
    database.sqlite
      .prepare("UPDATE scene_video_generations SET automatic_quality_status='PASSED' WHERE id=?")
      .run(generation.id);
    database.sqlite
      .prepare("UPDATE scene_revisions SET status='STALE',is_current=0 WHERE id=?")
      .run(sceneId);
    expect(repository.currentRenderableSceneVideo(projectId, sceneStableId)).toBeNull();
    database.sqlite.close();
  });
  it('invalidates video descendants without touching source images when settings change', () => {
    const { database, projectId, chapterId, sceneId, sceneStableId, imageId } = fixture();
    const repository = new SceneVideoGenerationRepository(database);
    const generation = repository.create({
      projectId,
      chapterId,
      sceneStableId,
      sceneRevisionId: sceneId,
      aiMotionPlanRevisionId: null,
      provider: 'COMFYUI',
      backend: 'WAN22_TI2V_5B',
      requestedSeed: 1,
      requestedWidth: 256,
      requestedHeight: 256,
      frameCount: 9,
      fps: 25,
      providerJobId: randomUUID(),
      workflowTemplate: 'image-to-video-v1',
      modelSettings: {},
      requestSnapshot: {},
      motionPlanFingerprint: null,
      settingsFingerprint: null,
      inputFingerprint: 'video-input',
      sourceImageAssetId: imageId,
      sourceImageSha256: 'a'.repeat(64),
      generationInstructions: null,
    });
    const videoAssetId = randomUUID();
    new AssetRepository(database).register({
      id: videoAssetId,
      projectId,
      type: 'AI_SCENE_VIDEO',
      role: `scene:${sceneStableId}:ai-motion`,
      path: 'projects/p/scene.mp4',
      mediaType: 'video/mp4',
      bytes: 10,
      sha256: 'b'.repeat(64),
      inputFingerprint: 'video-input',
    });
    const stamp = '2026-01-01T00:00:00.000Z';
    database.sqlite
      .prepare(
        `UPDATE scene_video_generations
         SET status='COMPLETED',automatic_quality_status='PASSED',asset_id=?,is_current=1,
           actual_seed=1,actual_width=256,actual_height=256,clip_duration_ms=320,
           generation_duration_ms=100,completed_at=?,updated_at=?
         WHERE id=?`,
      )
      .run(videoAssetId, stamp, stamp, generation.id);
    const workflow = new WorkflowRepository(database);
    const executionId = workflow.createExecution(projectId, 'GENERATE_AI_SCENE_VIDEO');
    const stepId = workflow.createStep(
      executionId,
      'video',
      'GENERATE_AI_SCENE_VIDEO',
      sceneId,
      'video-input',
      3,
      { projectId, generationId: generation.id },
    );
    workflow.createJob('GENERATE_AI_SCENE_VIDEO', generation.id, stepId);
    repository.linkWorkflowStep(projectId, generation.id, stepId);
    const settings = new VideoGenerationSettingsRepository(database);
    const current = settings.getOrCreate(projectId);
    settings.update(projectId, {
      provider: current.provider,
      baseUrl: current.baseUrl,
      backend: 'LTX2_19B_DISTILLED',
      workflowTemplate: current.workflowTemplate,
      diffusionModel: current.diffusionModel,
      textEncoder: current.textEncoder,
      vaeName: current.vaeName,
      ltxCheckpoint: current.ltxCheckpoint,
      ltxTextEncoder: current.ltxTextEncoder,
      ltxVaeName: current.ltxVaeName,
      ltxFps: current.ltxFps,
      sampler: current.sampler,
      scheduler: current.scheduler,
      steps: current.steps,
      guidance: current.guidance,
      shift: current.shift,
      preset: current.preset,
      connectionTimeoutMs: current.connectionTimeoutMs,
      generationTimeoutMs: current.generationTimeoutMs,
      seedMode: current.seedMode,
      fixedSeed: current.fixedSeed,
      requireMotionApproval: current.requireMotionApproval,
      expectedRowVersion: current.rowVersion,
    });
    expect(repository.getCurrent(projectId, sceneStableId)).toBeNull();
    expect(
      new AssetRepository(database).current(projectId, `scene:${sceneStableId}:ai-motion`),
    ).toBeNull();
    expect(
      new AssetRepository(database).current(projectId, `scene:${sceneStableId}:image`),
    ).toMatchObject({
      id: imageId,
    });
    expect(workflow.getStep(stepId)?.status).toBe('INVALIDATED');
    expect(database.sqlite.prepare('SELECT status FROM jobs WHERE step_id=?').get(stepId)).toEqual({
      status: 'INVALIDATED',
    });
    database.sqlite.close();
  });
});
