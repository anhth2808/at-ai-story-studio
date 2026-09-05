import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ShotPlanCandidate } from '@studio/shared';
import { createDatabase, migrateDatabase } from './db.js';
import { ShotPlanRepository } from './shot.js';

const state = {
  characters: [],
  objects: [],
  cameraAxis: '',
  locationId: null,
  sourceShotId: null,
  fingerprint: 'a'.repeat(64),
};

const candidate: ShotPlanCandidate = {
  beats: [
    {
      id: 'beat-1',
      ordinal: 1,
      sourceRange: { startOffset: 0, endOffset: 10 },
      kind: 'ACTION',
      meaning: 'A door opens',
      importance: 'MEDIUM',
      turningPoint: false,
      timingGroupKey: 'group-1',
    },
  ],
  shots: [
    {
      id: 'shot-1',
      beatId: 'beat-1',
      ordinal: 1,
      sourceRange: { startOffset: 0, endOffset: 10 },
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
        subject: 'A door',
        action: 'opens',
        pose: '',
        expression: '',
        relationship: '',
        importantObjectIds: [],
        framing: 'MEDIUM',
        angle: '',
        composition: '',
        lighting: '',
        colorMood: '',
        atmosphere: '',
      },
      dynamicIntent: {
        subjectMotion: 'the door opens',
        cameraMotion: 'STATIC',
        cameraSpeed: 'NONE',
        environmentMotion: '',
        emotionalTiming: '',
        speakingMotion: '',
        stabilityConstraints: [],
      },
      initialState: state,
      finalState: state,
      continuation: {
        mode: 'NEW_KEYFRAME',
        eligible: false,
        reason: 'First Shot',
        version: 'continuation-v1',
      },
      plannedDurationMs: 2_000,
      variationIntent: 'NORMAL',
    },
  ],
};

describe('ShotPlanRepository', () => {
  it('promotes immutable revisions for one current Scene', () => {
    const database = createDatabase(':memory:');
    migrateDatabase(database);
    const projectId = randomUUID();
    const chapterId = randomUUID();
    const scenePlanId = randomUUID();
    const sceneRevisionId = randomUUID();
    database.sqlite
      .prepare(
        'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(projectId, 'Story', 'vi-VN', '{}', '2026-01-01', '2026-01-01');
    database.sqlite
      .prepare(
        'INSERT INTO chapters(id,project_id,number,title,content,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(chapterId, projectId, 1, 'Chapter', 'A door opens.', 1, '2026-01-01', '2026-01-01');
    database.sqlite
      .prepare(
        "INSERT INTO scene_plan_revisions(id,project_id,chapter_id,chapter_revision,revision,density,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,'MEDIUM','hash','CURRENT',1,?,?)",
      )
      .run(scenePlanId, projectId, chapterId, 1, 1, '2026-01-01', '2026-01-01');
    database.sqlite
      .prepare(
        `INSERT INTO scene_revisions(id,stable_id,scene_plan_revision_id,project_id,chapter_id,chapter_revision,source_content,scene_number,revision,title,summary,purpose,source_start_offset,source_end_offset,visual_description,camera,composition,image_prompt,input_fingerprint,prompt_version,schema_version,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,1,1,'Scene','Summary','Purpose',0,10,'Door','{}','{}','Door','hash','v1','v1',1,?,?)`,
      )
      .run(
        sceneRevisionId,
        'scene-1',
        scenePlanId,
        projectId,
        chapterId,
        1,
        'A door opens.',
        '2026-01-01',
        '2026-01-01',
      );
    const repository = new ShotPlanRepository(database);
    const first = repository.saveCurrent({
      stableId: 'shot-plan-scene-1',
      projectId,
      chapterId,
      sceneId: 'scene-1',
      sceneRevisionId,
      templateVersion: 'shot-director-v1',
      schemaVersion: 'shot-plan-v1',
      inputFingerprint: 'first',
      candidate,
    });
    const second = repository.saveCurrent({
      stableId: 'shot-plan-scene-1',
      projectId,
      chapterId,
      sceneId: 'scene-1',
      sceneRevisionId,
      templateVersion: 'shot-director-v1',
      schemaVersion: 'shot-plan-v1',
      inputFingerprint: 'second',
      candidate,
      expectedRevision: 1,
    });
    expect(first).toMatchObject({ revision: 1, isCurrent: true });
    expect(second).toMatchObject({ revision: 2, isCurrent: true });
    expect(
      database.sqlite
        .prepare('SELECT status,is_current as isCurrent FROM shot_plans WHERE id=?')
        .get(first.id),
    ).toEqual({ status: 'STALE', isCurrent: 0 });
    expect(repository.getCurrent(projectId, sceneRevisionId)?.candidate.shots[0]?.id).toBe(
      'shot-1',
    );
    const reviewed = repository.review(projectId, second.id, {
      status: 'APPROVED',
      notes: 'Ready',
      expectedRowVersion: second.rowVersion,
    });
    expect(reviewed).toMatchObject({
      reviewStatus: 'APPROVED',
      reviewNotes: 'Ready',
      rowVersion: 2,
    });
    expect(() =>
      repository.review(projectId, second.id, {
        status: 'REJECTED',
        notes: '',
        expectedRowVersion: second.rowVersion,
      }),
    ).toThrow('Shot plan changed');
    database.sqlite.close();
  });
});
