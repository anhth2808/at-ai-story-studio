import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, SceneRepository } from './index.js';
import type { DatabaseHandle } from './db.js';

function setup(): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  database.sqlite
    .prepare(
      "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Scene test','vi-VN','{}','2026-01-01','2026-01-01')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,story_origin,created_at,updated_at) VALUES('chapter','project',1,'Chapter','Mở cửa 😀 rồi bước vào sân.','ACTIVE',1,1,'MANUAL','2026-01-01','2026-01-01')",
    )
    .run();
  return database;
}

function metadata(inputFingerprint: string) {
  return {
    operation: 'SCENE_PLANNING' as const,
    inputFingerprint,
    provider: null,
    model: null,
    promptVersion: 'scene-v1',
    schemaVersion: 'scene-v1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    costCurrency: null,
    finishReason: null,
    attempt: 1,
    contextHash: null,
    omittedContext: [],
  };
}

function sceneInput(fingerprint: string) {
  return {
    stableId: 'scene-stable-1',
    sceneNumber: 1,
    title: 'Cánh cửa mở ra',
    summary: 'Nhân vật bước qua cánh cửa.',
    purpose: 'INTRODUCTION' as const,
    sourceRange: { start: 0, end: 18 },
    location: 'Sân trong',
    timeOfDay: 'Sáng',
    weather: 'Trong',
    mood: 'Tò mò',
    characters: [
      {
        characterId: 'mai',
        displayName: 'Mai',
        roleInScene: 'Người quan sát',
        visualState: {
          clothing: 'Áo khoác xanh',
          injuries: [],
          expression: 'Thận trọng',
          pose: 'Đứng ở ngưỡng cửa',
          action: 'Bước vào',
          position: 'Trung tâm',
          heldObjects: [],
        },
        resolutionStatus: 'UNRESOLVED' as const,
        dependencyFingerprint: null,
      },
    ],
    importantObjects: ['Cánh cửa gỗ'],
    visualDescription: 'Một cánh cửa cũ mở vào sân sáng.',
    camera: { framing: 'MEDIUM' as const, angle: 'Ngang mắt', movementIntent: null },
    composition: {
      subjectFocus: 'Mai ở ngưỡng cửa',
      foreground: [],
      midground: ['Mai'],
      background: ['Sân trong'],
      characterPositions: [],
    },
    lighting: 'Ánh sáng buổi sáng',
    colorMood: 'Xanh và vàng nhạt',
    imagePrompt: 'Cinematic medium shot of Mai entering an old courtyard',
    negativePrompt: 'text, watermark',
    continuityNotes: '',
    locationId: null,
    unresolvedReferences: ['Mai'],
    styleRevisionId: null,
    inputFingerprint: fingerprint,
    promptVersion: 'scene-v1',
    schemaVersion: 'scene-v1',
  };
}

describe('SceneRepository', () => {
  it('persists revisioned plans, UTF-16 excerpts, edits, and stale state', () => {
    const database = setup();
    const repository = new SceneRepository(database);
    const fingerprint = 'a'.repeat(64);
    const generationId = 'generation-plan';
    database.sqlite
      .prepare(
        'INSERT INTO story_generation_records(id,project_id,operation,target_id,workflow_step_id,input_fingerprint,metadata,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        generationId,
        'project',
        'SCENE_PLANNING',
        'chapter',
        null,
        fingerprint,
        '{}',
        'RUNNING',
        '2026-01-01',
      );

    const plan = repository.saveGeneratedPlan({
      projectId: 'project',
      chapterId: 'chapter',
      chapterRevision: 1,
      density: 'MEDIUM',
      targetRange: { min: 1, max: 3 },
      styleRevisionId: null,
      generationId,
      inputFingerprint: fingerprint,
      metadata: metadata(fingerprint),
      scenes: [sceneInput(fingerprint)],
    });

    expect(plan.sceneCount).toBe(1);
    expect(
      database.sqlite
        .prepare('SELECT status FROM story_generation_records WHERE id=?')
        .get(generationId),
    ).toEqual({ status: 'COMPLETED' });
    const scene = repository.listScenes('chapter', 10, 0, true)[0]!;
    expect(scene.sourceExcerpt).toBe('Mở cửa 😀 rồi bước');
    expect(scene.characters[0]!.resolutionStatus).toBe('UNRESOLVED');
    repository.markCharacterPromptsStale('project', 'mai');
    expect(repository.getScene(scene.id)?.promptStatus).toBe('STALE');

    expect(() =>
      repository.saveGeneratedPlan({
        projectId: 'project',
        chapterId: 'chapter',
        chapterRevision: 1,
        density: 'MEDIUM',
        targetRange: null,
        styleRevisionId: null,
        generationId,
        inputFingerprint: fingerprint,
        metadata: metadata(fingerprint),
        scenes: [{ ...sceneInput(fingerprint), sourceRange: { start: -1, end: 4 } }],
      }),
    ).toThrow();
    expect(() =>
      repository.saveGeneratedPlan({
        projectId: 'project',
        chapterId: 'chapter',
        chapterRevision: 1,
        density: 'MEDIUM',
        targetRange: null,
        styleRevisionId: null,
        generationId,
        inputFingerprint: fingerprint,
        metadata: metadata(fingerprint),
        scenes: [{ ...sceneInput(fingerprint), sourceRange: { start: 0, end: 100 } }],
      }),
    ).toThrow('outside');
    expect(() =>
      repository.saveGeneratedPlan({
        projectId: 'project',
        chapterId: 'chapter',
        chapterRevision: 1,
        density: 'MEDIUM',
        targetRange: null,
        styleRevisionId: null,
        generationId,
        inputFingerprint: fingerprint,
        metadata: metadata(fingerprint),
        scenes: [
          sceneInput(fingerprint),
          {
            ...sceneInput(fingerprint),
            stableId: 'scene-stable-2',
            sceneNumber: 2,
            sourceRange: { start: 10, end: 20 },
          },
        ],
      }),
    ).toThrow('overlap');

    const edited = repository.updateScene(scene.id, {
      expectedRevision: 1,
      mood: 'Bình tĩnh',
      imagePrompt: 'A calmer cinematic medium shot',
    });
    expect(edited.revision).toBe(2);
    expect(() =>
      repository.updateScene(edited.id, {
        expectedRevision: 1,
        mood: 'Không hợp lệ',
      }),
    ).toThrow('Revision conflict');
    expect(repository.listScenes('chapter')).toHaveLength(1);
    expect(repository.getScene(scene.id)).toBeNull();

    database.sqlite
      .prepare('UPDATE chapters SET content=?,revision=? WHERE id=?')
      .run('Nội dung mới không còn cánh cửa.', 2, 'chapter');
    repository.markChapterStale('chapter');
    expect(repository.getScenePlan('chapter')?.status).toBe('STALE');
    expect(repository.getScene(edited.id, true)?.sourceExcerpt).toBe('Mở cửa 😀 rồi bước');
    expect(repository.listScenes('chapter')[0]?.promptStatus).toBe('STALE');
    database.sqlite.close();
  });

  it('normalizes locations and creates a draft only for an unknown name', () => {
    const database = setup();
    const repository = new SceneRepository(database);
    const first = repository.resolveLocation('project', 'The Old Gate');
    expect(first.createdDraft).toBe(true);
    expect(first.locationId).not.toBeNull();
    const second = repository.resolveLocation('project', 'old-gate');
    expect(second.createdDraft).toBe(false);
    expect(second.locationId).toBe(first.locationId);
    expect(repository.listLocations('project')).toHaveLength(1);
    database.sqlite.close();
  });
});
