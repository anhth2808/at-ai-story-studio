import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AssetRepository, TimelineRepository, createDatabase, migrateDatabase } from './index.js';
import type { DatabaseHandle } from './db.js';

function setup() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const projectId = randomUUID();
  const chapterId = randomUUID();
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Timeline test', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
  database.sqlite
    .prepare(
      'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      chapterId,
      projectId,
      1,
      'Chapter',
      'Một câu.',
      'ACTIVE',
      1,
      1,
      '2026-01-01',
      '2026-01-01',
    );
  return { database, projectId, chapterId };
}

function registerAsset(
  database: DatabaseHandle,
  projectId: string,
  id: string,
  type: string,
  role: string,
): void {
  new AssetRepository(database).register({
    id,
    projectId,
    type,
    role,
    path: `${role.replaceAll(':', '-')}-${id}.asset`,
    mediaType: 'application/octet-stream',
    bytes: 1,
    sha256: `${id}-hash`,
  });
}

describe('timeline repositories', () => {
  it('persists current and historical SceneTiming revisions', () => {
    const fixture = setup();
    const audioAssetId = randomUUID();
    registerAsset(
      fixture.database,
      fixture.projectId,
      audioAssetId,
      'CHAPTER_AUDIO',
      `chapter:${fixture.chapterId}:audio`,
    );
    const repo = new TimelineRepository(fixture.database);
    const sceneId = randomUUID();
    const item = {
      sceneId,
      sceneRevision: 1,
      sourceRange: { start: 0, end: 8 },
      rawStartMs: 0,
      rawEndMs: 1_000,
      startMs: 0,
      endMs: 1_000,
      durationMs: 1_000,
      warning: null,
    } as const;
    const first = repo.createSceneTiming({
      projectId: fixture.projectId,
      chapterId: fixture.chapterId,
      chapterRevision: 1,
      audioAssetId,
      mode: 'AUTO',
      durationMs: 1_000,
      minimumSceneDurationMs: 1,
      items: [item],
      warnings: [],
      inputFingerprint: 'timing-one',
    });
    const second = repo.createSceneTiming({
      projectId: fixture.projectId,
      chapterId: fixture.chapterId,
      chapterRevision: 1,
      audioAssetId,
      mode: 'MANUAL',
      durationMs: 1_000,
      minimumSceneDurationMs: 1,
      items: [item],
      warnings: [],
      inputFingerprint: 'timing-two',
    });
    expect(repo.getCurrentSceneTiming(fixture.chapterId)?.id).toBe(second.id);
    expect(repo.listSceneTimingRevisions(fixture.chapterId).map((value) => value.id)).toEqual([
      second.id,
      first.id,
    ]);
    fixture.database.sqlite.close();
  });

  it('persists current MotionPlan revisions with source revision provenance', () => {
    const fixture = setup();
    const audioAssetId = randomUUID();
    registerAsset(
      fixture.database,
      fixture.projectId,
      audioAssetId,
      'CHAPTER_AUDIO',
      `chapter:${fixture.chapterId}:audio`,
    );
    const timing = new TimelineRepository(fixture.database).createSceneTiming({
      projectId: fixture.projectId,
      chapterId: fixture.chapterId,
      chapterRevision: 1,
      audioAssetId,
      mode: 'AUTO',
      durationMs: 1_000,
      minimumSceneDurationMs: 1,
      items: [
        {
          sceneId: randomUUID(),
          sceneRevision: 1,
          sourceRange: { start: 0, end: 8 },
          rawStartMs: 0,
          rawEndMs: 1_000,
          startMs: 0,
          endMs: 1_000,
          durationMs: 1_000,
          warning: null,
        },
      ],
      warnings: [],
      inputFingerprint: 'timing',
    });
    const sceneRevisionId = randomUUID();
    const scenePlanRevisionId = randomUUID();
    fixture.database.sqlite
      .prepare(
        `INSERT INTO scene_plan_revisions
         (id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        scenePlanRevisionId,
        fixture.projectId,
        fixture.chapterId,
        1,
        1,
        'LOW',
        'plan',
        'CURRENT',
        1,
        '2026-01-01',
        '2026-01-01',
      );
    fixture.database.sqlite
      .prepare(
        `INSERT INTO scene_revisions
         (id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,source_content,scene_number,revision,
          title,summary,purpose,source_start_offset,source_end_offset,visual_description,camera,composition,image_prompt,
          input_fingerprint,prompt_version,schema_version,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        sceneRevisionId,
        'scene-stable-1',
        scenePlanRevisionId,
        fixture.projectId,
        fixture.chapterId,
        1,
        'Một câu.',
        1,
        1,
        'Scene',
        'Summary',
        'DIALOGUE',
        0,
        8,
        'Visual',
        '{"framing":"MEDIUM"}',
        '{}',
        'Prompt',
        'scene',
        '1',
        '1',
        1,
        '2026-01-01',
        '2026-01-01',
      );
    const repo = new TimelineRepository(fixture.database);
    const created = repo.createMotionPlan(
      {
        projectId: fixture.projectId,
        chapterId: fixture.chapterId,
        sceneStableId: 'scene-stable-1',
        sceneRevisionId,
        timingRevisionId: timing.id,
        motionType: 'SLOW_PUSH_IN',
        startScale: 1,
        endScale: 1.05,
        startPositionX: 0.5,
        startPositionY: 0.5,
        endPositionX: 0.5,
        endPositionY: 0.5,
        easing: 'EASE_IN_OUT',
        focusPointX: 0.5,
        focusPointY: 0.5,
        intensity: 0.5,
        durationMs: 1_000,
        inputFingerprint: 'motion',
      },
      1,
    );
    expect(created).toMatchObject({
      sceneId: 'scene-stable-1',
      sceneRevision: 1,
      timingRevision: 1,
      motionType: 'SLOW_PUSH_IN',
    });
    fixture.database.sqlite.close();
  });

  it('finds matching current assets and invalidates only dependency descendants', () => {
    const fixture = setup();
    const assets = new AssetRepository(fixture.database);
    const inputId = randomUUID();
    const outputId = randomUUID();
    registerAsset(fixture.database, fixture.projectId, inputId, 'SCENE_IMAGE', 'scene:one:image');
    assets.register({
      id: outputId,
      projectId: fixture.projectId,
      type: 'SCENE_VIDEO_CLIP',
      role: 'scene:one:video',
      path: `scene-one-${outputId}.mp4`,
      mediaType: 'video/mp4',
      bytes: 1,
      sha256: 'output-hash',
      inputFingerprint: 'fingerprint',
    });
    assets.addDependency({
      assetId: outputId,
      dependsOnAssetId: inputId,
      role: 'scene-image',
      sourceHash: `${inputId}-hash`,
    });
    expect(assets.currentMatching(fixture.projectId, 'scene:one:video', 'fingerprint')?.id).toBe(
      outputId,
    );
    assets.invalidateDependents(fixture.projectId, inputId);
    expect(assets.current(fixture.projectId, 'scene:one:video')).toBeNull();
    fixture.database.sqlite.close();
  });
});
