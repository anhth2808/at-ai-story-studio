import { randomUUID } from 'node:crypto';
import { AppError } from '@studio/shared';
import {
  motionPlanSchema,
  sceneTimingSchema,
  type Id,
  type MotionPlan,
  type MotionType,
  type SceneTiming,
  type SceneTimingItem,
  type TimelineMode,
  type MotionEasing,
} from '@studio/shared';
import { invalidateAssetDependents } from './repositories.js';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type SceneTimingRow = {
  id: Id;
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  audioAssetId: Id;
  mode: TimelineMode;
  revision: number;
  durationMs: number;
  minimumSceneDurationMs: number;
  items: string;
  warnings: string;
  inputFingerprint: string;
  status: SceneTiming['status'];
  isCurrent: number;
  createdAt: string;
  updatedAt: string;
};

type MotionPlanRow = {
  id: Id;
  projectId: Id;
  chapterId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  sceneRevision: number;
  timingRevisionId: Id | null;
  timingRevision: number | null;
  revision: number;
  motionType: MotionType;
  startScale: number;
  endScale: number;
  startPositionX: number;
  startPositionY: number;
  endPositionX: number;
  endPositionY: number;
  easing: MotionEasing;
  focusPointX: number | null;
  focusPointY: number | null;
  intensity: number;
  durationMs: number;
  inputFingerprint: string;
  status: MotionPlan['status'];
  isCurrent: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSceneTimingInput = {
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  audioAssetId: Id;
  mode: TimelineMode;
  durationMs: number;
  minimumSceneDurationMs: number;
  items: SceneTimingItem[];
  warnings: string[];
  inputFingerprint: string;
  status?: SceneTiming['status'];
};

export type CreateMotionPlanInput = {
  projectId: Id;
  chapterId: Id;
  sceneStableId: string;
  sceneRevisionId: Id;
  timingRevisionId: Id | null;
  motionType: MotionType;
  startScale: number;
  endScale: number;
  startPositionX: number;
  startPositionY: number;
  endPositionX: number;
  endPositionY: number;
  easing: MotionEasing;
  focusPointX: number | null;
  focusPointY: number | null;
  intensity: number;
  durationMs: number;
  inputFingerprint: string;
  status?: MotionPlan['status'];
};

export type TtsSourceSegment = {
  id: Id;
  index: number;
  text: string;
  textHash: string;
  chapterRevision: number | null;
  sourceStartOffset: number | null;
  sourceEndOffset: number | null;
  sourceText: string | null;
  status: string;
  audioAssetId: Id | null;
  durationMs: number | null;
  fingerprint: string;
};

export class TimelineRepository {
  constructor(private readonly database: DatabaseHandle) {}
  private invalidateChapterVideoAssets(projectId: Id, chapterId: Id, stamp: string): void {
    const assets = this.database.sqlite
      .prepare(
        `SELECT DISTINCT a.id
         FROM assets a
         LEFT JOIN scene_revisions sr ON sr.id=a.source_entity_id
         WHERE a.project_id=? AND a.is_current=1 AND a.status='READY'
           AND (
             (a.type='SCENE_VIDEO_CLIP' AND sr.chapter_id=?)
             OR (a.type='CHAPTER_VIDEO' AND a.source_entity_id=?)
           )`,
      )
      .all(projectId, chapterId, chapterId) as Array<{ id: Id }>;
    this.database.sqlite
      .prepare(
        `UPDATE assets SET is_current=0,updated_at=?
         WHERE project_id=? AND id IN (${assets.length ? assets.map(() => '?').join(',') : 'NULL'})`,
      )
      .run(stamp, projectId, ...assets.map((asset) => asset.id));
    for (const asset of assets)
      invalidateAssetDependents(this.database, projectId, asset.id, stamp);
  }
  private invalidateCurrentRole(projectId: Id, role: string, stamp: string): void {
    const assets = this.database.sqlite
      .prepare('SELECT id FROM assets WHERE project_id=? AND role=? AND is_current=1')
      .all(projectId, role) as Array<{ id: Id }>;
    this.database.sqlite
      .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
      .run(stamp, projectId, role);
    for (const asset of assets)
      invalidateAssetDependents(this.database, projectId, asset.id, stamp);
  }

  private readTiming(row: SceneTimingRow | undefined): SceneTiming | null {
    if (!row) return null;
    return sceneTimingSchema.parse({
      id: row.id,
      projectId: row.projectId,
      chapterId: row.chapterId,
      chapterRevision: row.chapterRevision,
      audioAssetId: row.audioAssetId,
      mode: row.mode,
      revision: row.revision,
      durationMs: row.durationMs,
      minimumSceneDurationMs: row.minimumSceneDurationMs,
      items: parseJson<SceneTimingItem[]>(row.items, []),
      warnings: parseJson<string[]>(row.warnings, []),
      inputFingerprint: row.inputFingerprint,
      status: row.status,
      isCurrent: Boolean(row.isCurrent),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  getSceneTiming(id: Id): SceneTiming | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,chapter_id as chapterId,chapter_revision as chapterRevision,
          audio_asset_id as audioAssetId,mode,revision,duration_ms as durationMs,
          minimum_scene_duration_ms as minimumSceneDurationMs,items,warnings,
          input_fingerprint as inputFingerprint,status,is_current as isCurrent,
          created_at as createdAt,updated_at as updatedAt
         FROM scene_timing_revisions WHERE id=?`,
      )
      .get(id) as SceneTimingRow | undefined;
    return this.readTiming(row);
  }

  getCurrentSceneTiming(chapterId: Id): SceneTiming | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,chapter_id as chapterId,chapter_revision as chapterRevision,
          audio_asset_id as audioAssetId,mode,revision,duration_ms as durationMs,
          minimum_scene_duration_ms as minimumSceneDurationMs,items,warnings,
          input_fingerprint as inputFingerprint,status,is_current as isCurrent,
          created_at as createdAt,updated_at as updatedAt
         FROM scene_timing_revisions
         WHERE chapter_id=? AND is_current=1 AND status='COMPLETED'
         ORDER BY revision DESC LIMIT 1`,
      )
      .get(chapterId) as SceneTimingRow | undefined;
    return this.readTiming(row);
  }

  listSceneTimingRevisions(chapterId: Id): SceneTiming[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,chapter_id as chapterId,chapter_revision as chapterRevision,
          audio_asset_id as audioAssetId,mode,revision,duration_ms as durationMs,
          minimum_scene_duration_ms as minimumSceneDurationMs,items,warnings,
          input_fingerprint as inputFingerprint,status,is_current as isCurrent,
          created_at as createdAt,updated_at as updatedAt
         FROM scene_timing_revisions WHERE chapter_id=? ORDER BY revision DESC`,
      )
      .all(chapterId) as SceneTimingRow[];
    return rows.flatMap((row) => {
      const value = this.readTiming(row);
      return value ? [value] : [];
    });
  }

  createSceneTiming(input: CreateSceneTimingInput): SceneTiming {
    return this.database.sqlite.transaction(() => this.createSceneTimingInTransaction(input))();
  }

  createSceneTimingInTransaction(input: CreateSceneTimingInput): SceneTiming {
    const id = randomUUID();
    const stamp = now();
    const revisionRow = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0)+1 as revision FROM scene_timing_revisions WHERE chapter_id=?',
      )
      .get(input.chapterId) as { revision: number };
    const revision = revisionRow.revision;
    const status = input.status ?? 'COMPLETED';
    this.invalidateChapterVideoAssets(input.projectId, input.chapterId, stamp);
    this.database.sqlite
      .prepare(
        'UPDATE scene_timing_revisions SET is_current=0,updated_at=? WHERE chapter_id=? AND is_current=1',
      )
      .run(stamp, input.chapterId);
    this.database.sqlite
      .prepare(
        `INSERT INTO scene_timing_revisions
         (id,project_id,chapter_id,chapter_revision,audio_asset_id,mode,revision,duration_ms,
          minimum_scene_duration_ms,items,warnings,input_fingerprint,status,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.chapterId,
        input.chapterRevision,
        input.audioAssetId,
        input.mode,
        revision,
        input.durationMs,
        input.minimumSceneDurationMs,
        json(input.items),
        json(input.warnings),
        input.inputFingerprint,
        status,
        status === 'COMPLETED' ? 1 : 0,
        stamp,
        stamp,
      );
    const timing = this.getSceneTiming(id);
    if (!timing) throw new AppError('TIMELINE_NOT_FOUND', 'Scene timing was not persisted', 500);
    return timing;
  }
  invalidateSceneTiming(chapterId: Id, message = 'Scene timing is stale'): void {
    const row = this.database.sqlite
      .prepare('SELECT project_id as projectId FROM chapters WHERE id=?')
      .get(chapterId) as { projectId: Id } | undefined;
    if (!row) return;
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.invalidateChapterVideoAssets(row.projectId, chapterId, stamp);
      this.database.sqlite
        .prepare(
          `UPDATE scene_timing_revisions SET status='INVALIDATED',is_current=0,warnings=?,updated_at=?
           WHERE chapter_id=? AND is_current=1`,
        )
        .run(json([message]), stamp, chapterId);
    })();
  }
  invalidateRenderOutputs(projectId: Id, message = 'Render configuration changed'): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      const assets = this.database.sqlite
        .prepare(
          `SELECT id FROM assets
           WHERE project_id=? AND type IN ('SCENE_VIDEO_CLIP','CHAPTER_VIDEO','PROJECT_VIDEO')
             AND is_current=1`,
        )
        .all(projectId) as Array<{ id: Id }>;
      this.database.sqlite
        .prepare(
          `UPDATE assets SET is_current=0,updated_at=?
           WHERE project_id=? AND type IN ('SCENE_VIDEO_CLIP','CHAPTER_VIDEO','PROJECT_VIDEO')
             AND is_current=1`,
        )
        .run(stamp, projectId);
      for (const asset of assets)
        invalidateAssetDependents(this.database, projectId, asset.id, stamp);
      if (assets.length === 0) {
        this.database.sqlite
          .prepare(
            `UPDATE render_jobs SET status='INVALIDATED',diagnostics=?,updated_at=?
             WHERE project_id=? AND render_type IN ('SCENE_CLIP','CHAPTER_VIDEO','PROJECT_VIDEO')
               AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
          )
          .run(json({ error: message }), stamp, projectId);
      }
    })();
  }

  private readMotion(row: MotionPlanRow | undefined): MotionPlan | null {
    if (!row) return null;
    return motionPlanSchema.parse({
      id: row.id,
      sceneId: row.sceneStableId,
      sceneRevision: row.sceneRevision,
      timingRevision: row.timingRevision,
      revision: row.revision,
      motionType: row.motionType,
      startScale: row.startScale,
      endScale: row.endScale,
      startPosition: { x: row.startPositionX, y: row.startPositionY },
      endPosition: { x: row.endPositionX, y: row.endPositionY },
      easing: row.easing,
      focusPoint:
        row.focusPointX === null || row.focusPointY === null
          ? null
          : { x: row.focusPointX, y: row.focusPointY },
      intensity: row.intensity,
      durationMs: row.durationMs,
      status: row.status,
      inputFingerprint: row.inputFingerprint,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  getMotionPlan(id: Id): MotionPlan | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT mp.id,mp.project_id as projectId,mp.chapter_id as chapterId,mp.scene_stable_id as sceneStableId,
          mp.scene_revision_id as sceneRevisionId,sr.revision as sceneRevision,
          mp.timing_revision_id as timingRevisionId,tr.revision as timingRevision,mp.revision,
          mp.motion_type as motionType,mp.start_scale as startScale,mp.end_scale as endScale,
          mp.start_position_x as startPositionX,mp.start_position_y as startPositionY,
          mp.end_position_x as endPositionX,mp.end_position_y as endPositionY,mp.easing,
          mp.focus_point_x as focusPointX,mp.focus_point_y as focusPointY,mp.intensity,mp.duration_ms as durationMs,
          mp.input_fingerprint as inputFingerprint,mp.status,mp.is_current as isCurrent,
          mp.created_at as createdAt,mp.updated_at as updatedAt
         FROM motion_plan_revisions mp
         JOIN scene_revisions sr ON sr.id=mp.scene_revision_id
         LEFT JOIN scene_timing_revisions tr ON tr.id=mp.timing_revision_id
         WHERE mp.id=?`,
      )
      .get(id) as MotionPlanRow | undefined;
    return this.readMotion(row);
  }

  getCurrentMotionPlan(sceneStableId: string, sceneRevisionId: Id): MotionPlan | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT mp.id,mp.project_id as projectId,mp.chapter_id as chapterId,mp.scene_stable_id as sceneStableId,
          mp.scene_revision_id as sceneRevisionId,sr.revision as sceneRevision,
          mp.timing_revision_id as timingRevisionId,tr.revision as timingRevision,mp.revision,
          mp.motion_type as motionType,mp.start_scale as startScale,mp.end_scale as endScale,
          mp.start_position_x as startPositionX,mp.start_position_y as startPositionY,
          mp.end_position_x as endPositionX,mp.end_position_y as endPositionY,mp.easing,
          mp.focus_point_x as focusPointX,mp.focus_point_y as focusPointY,mp.intensity,mp.duration_ms as durationMs,
          mp.input_fingerprint as inputFingerprint,mp.status,mp.is_current as isCurrent,
          mp.created_at as createdAt,mp.updated_at as updatedAt
         FROM motion_plan_revisions mp
         JOIN scene_revisions sr ON sr.id=mp.scene_revision_id
         LEFT JOIN scene_timing_revisions tr ON tr.id=mp.timing_revision_id
         WHERE mp.scene_stable_id=? AND mp.scene_revision_id=? AND mp.is_current=1 AND mp.status='COMPLETED'
           AND (tr.id IS NULL OR (tr.is_current=1 AND tr.status='COMPLETED'))
         ORDER BY mp.revision DESC LIMIT 1`,
      )
      .get(sceneStableId, sceneRevisionId) as MotionPlanRow | undefined;
    return this.readMotion(row);
  }

  listMotionPlans(sceneStableId: string, sceneRevisionId: Id): MotionPlan[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT mp.id,mp.project_id as projectId,mp.chapter_id as chapterId,mp.scene_stable_id as sceneStableId,
          mp.scene_revision_id as sceneRevisionId,sr.revision as sceneRevision,
          mp.timing_revision_id as timingRevisionId,tr.revision as timingRevision,mp.revision,
          mp.motion_type as motionType,mp.start_scale as startScale,mp.end_scale as endScale,
          mp.start_position_x as startPositionX,mp.start_position_y as startPositionY,
          mp.end_position_x as endPositionX,mp.end_position_y as endPositionY,mp.easing,
          mp.focus_point_x as focusPointX,mp.focus_point_y as focusPointY,mp.intensity,mp.duration_ms as durationMs,
          mp.input_fingerprint as inputFingerprint,mp.status,mp.is_current as isCurrent,
          mp.created_at as createdAt,mp.updated_at as updatedAt
         FROM motion_plan_revisions mp
         JOIN scene_revisions sr ON sr.id=mp.scene_revision_id
         LEFT JOIN scene_timing_revisions tr ON tr.id=mp.timing_revision_id
         WHERE mp.scene_stable_id=? AND mp.scene_revision_id=? ORDER BY mp.revision DESC`,
      )
      .all(sceneStableId, sceneRevisionId) as MotionPlanRow[];
    return rows.flatMap((row) => {
      const value = this.readMotion(row);
      return value ? [value] : [];
    });
  }

  createMotionPlan(input: CreateMotionPlanInput, sceneRevision: number): MotionPlan {
    return this.database.sqlite.transaction(() =>
      this.createMotionPlanInTransaction(input, sceneRevision),
    )();
  }

  createMotionPlanInTransaction(input: CreateMotionPlanInput, sceneRevision: number): MotionPlan {
    const id = randomUUID();
    const stamp = now();
    const revisionRow = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0)+1 as revision FROM motion_plan_revisions WHERE scene_revision_id=?',
      )
      .get(input.sceneRevisionId) as { revision: number };
    const revision = revisionRow.revision;
    this.invalidateCurrentRole(input.projectId, `scene:${input.sceneStableId}:video`, stamp);
    this.database.sqlite
      .prepare(
        'UPDATE motion_plan_revisions SET is_current=0,updated_at=? WHERE scene_stable_id=? AND scene_revision_id=? AND is_current=1',
      )
      .run(stamp, input.sceneStableId, input.sceneRevisionId);
    this.database.sqlite
      .prepare(
        `INSERT INTO motion_plan_revisions
         (id,project_id,chapter_id,scene_stable_id,scene_revision_id,timing_revision_id,revision,
          motion_type,start_scale,end_scale,start_position_x,start_position_y,end_position_x,end_position_y,
          easing,focus_point_x,focus_point_y,intensity,duration_ms,input_fingerprint,status,is_current,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.chapterId,
        input.sceneStableId,
        input.sceneRevisionId,
        input.timingRevisionId,
        revision,
        input.motionType,
        input.startScale,
        input.endScale,
        input.startPositionX,
        input.startPositionY,
        input.endPositionX,
        input.endPositionY,
        input.easing,
        input.focusPointX,
        input.focusPointY,
        input.intensity,
        input.durationMs,
        input.inputFingerprint,
        input.status ?? 'COMPLETED',
        input.status === 'INVALIDATED' ? 0 : 1,
        stamp,
        stamp,
      );
    const plan = this.getMotionPlan(id);
    if (!plan) throw new AppError('MOTION_PLAN_NOT_FOUND', 'Motion plan was not persisted', 500);
    return { ...plan, sceneRevision };
  }

  invalidateMotionPlan(
    sceneStableId: string,
    sceneRevisionId: Id,
    message = 'Motion plan is stale',
  ): void {
    const row = this.database.sqlite
      .prepare('SELECT project_id as projectId FROM scene_revisions WHERE id=? AND stable_id=?')
      .get(sceneRevisionId, sceneStableId) as { projectId: Id } | undefined;
    if (!row) return;
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.invalidateCurrentRole(row.projectId, `scene:${sceneStableId}:video`, stamp);
      this.database.sqlite
        .prepare(
          `UPDATE motion_plan_revisions SET status='INVALIDATED',is_current=0,input_fingerprint=?,updated_at=?
           WHERE scene_stable_id=? AND scene_revision_id=? AND is_current=1`,
        )
        .run(`invalidated:${message}`, stamp, sceneStableId, sceneRevisionId);
    })();
  }

  listTtsSourceSegments(chapterId: Id): TtsSourceSegment[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,segment_index as segmentIndex,text,text_hash as textHash,chapter_revision as chapterRevision,
          source_start_offset as sourceStartOffset,source_end_offset as sourceEndOffset,
          source_text as sourceText,status,audio_asset_id as audioAssetId,duration_ms as durationMs,fingerprint
         FROM tts_segments WHERE chapter_id=? ORDER BY segment_index`,
      )
      .all(chapterId) as Array<Omit<TtsSourceSegment, 'index'> & { segmentIndex: number }>;
    return rows.map(({ segmentIndex, ...row }) => ({ ...row, index: segmentIndex }));
  }
}
export type ShotTimingAllocation = {
  id: Id;
  projectId: Id;
  sceneTimingRevisionId: Id;
  shotPlanId: Id;
  shotId: string;
  ordinal: number;
  targetDurationMs: number;
  actualDurationMs: number;
  frameCount: number;
  fps: number;
  residualMs: number;
  backend: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveShotTimingAllocationInput = Omit<
  ShotTimingAllocation,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: Id;
};

export class ShotTimingAllocationRepository {
  constructor(private readonly database: DatabaseHandle) {}

  saveMany(inputs: SaveShotTimingAllocationInput[]): ShotTimingAllocation[] {
    if (!inputs.length) return [];
    const stamp = now();
    const save = this.database.sqlite.prepare(
      `INSERT INTO shot_timing_allocations(
         id,project_id,scene_timing_revision_id,shot_plan_id,shot_id,ordinal,target_duration_ms,
         actual_duration_ms,frame_count,fps,residual_ms,backend,created_at,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scene_timing_revision_id,shot_id) DO UPDATE SET
         shot_plan_id=excluded.shot_plan_id,ordinal=excluded.ordinal,target_duration_ms=excluded.target_duration_ms,
         actual_duration_ms=excluded.actual_duration_ms,frame_count=excluded.frame_count,fps=excluded.fps,
         residual_ms=excluded.residual_ms,backend=excluded.backend,updated_at=excluded.updated_at`,
    );
    this.database.sqlite.transaction(() => {
      for (const input of inputs) {
        const shot = this.database.sqlite
          .prepare(
            `SELECT s.id FROM shots s
             JOIN shot_plans sp ON sp.id=s.shot_plan_id
             WHERE sp.project_id=? AND s.shot_plan_id=? AND (s.stable_id=? OR s.id=?)`,
          )
          .get(input.projectId, input.shotPlanId, input.shotId, input.shotId) as
          { id: Id } | undefined;
        if (!shot)
          throw new AppError('NOT_FOUND', `Shot ${input.shotId} is not in the current plan`, 404);
        save.run(
          input.id ?? randomUUID(),
          input.projectId,
          input.sceneTimingRevisionId,
          input.shotPlanId,
          shot.id,
          input.ordinal,
          input.targetDurationMs,
          input.actualDurationMs,
          input.frameCount,
          input.fps,
          input.residualMs,
          input.backend,
          stamp,
          stamp,
        );
      }
    })();
    return this.list(inputs[0]!.projectId, inputs[0]!.sceneTimingRevisionId);
  }

  list(projectId: Id, sceneTimingRevisionId: Id): ShotTimingAllocation[] {
    return this.database.sqlite
      .prepare(
        `SELECT a.id,a.project_id as projectId,a.scene_timing_revision_id as sceneTimingRevisionId,
          a.shot_plan_id as shotPlanId,s.stable_id as shotId,a.ordinal,
          a.target_duration_ms as targetDurationMs,a.actual_duration_ms as actualDurationMs,
          a.frame_count as frameCount,a.fps,a.residual_ms as residualMs,a.backend,
          a.created_at as createdAt,a.updated_at as updatedAt
         FROM shot_timing_allocations a
         JOIN shots s ON s.id=a.shot_id
         WHERE a.project_id=? AND a.scene_timing_revision_id=? ORDER BY a.ordinal`,
      )
      .all(projectId, sceneTimingRevisionId) as ShotTimingAllocation[];
  }
}
