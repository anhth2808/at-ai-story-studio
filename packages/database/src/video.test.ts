import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AssetRepository,
  SceneVideoGenerationRepository,
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
});
