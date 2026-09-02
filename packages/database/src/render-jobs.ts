import { randomUUID } from 'node:crypto';
import { AppError } from '@studio/shared';
import type { Id } from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();

export type RenderJobType = 'SCENE_CLIP' | 'CHAPTER_VIDEO' | 'PROJECT_VIDEO' | 'LEGACY_PROJECT';
export type RenderJobStatus =
  'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INVALIDATED' | 'CANCELLED';

export type RenderJobRecord = {
  id: Id;
  projectId: Id;
  stepId: Id;
  renderType: RenderJobType;
  scopeId: string | null;
  timelineAssetId: Id | null;
  outputAssetId: Id | null;
  expectedDurationMs: number | null;
  actualDurationMs: number | null;
  progressTimeMs: number | null;
  diagnostics: unknown;
  status: RenderJobStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateRenderJobInput = {
  projectId: Id;
  stepId: Id;
  renderType: RenderJobType;
  scopeId: string;
  expectedDurationMs: number | null;
  status?: RenderJobStatus;
};

export class RenderJobRepository {
  constructor(private readonly database: DatabaseHandle) {}

  create(input: CreateRenderJobInput): RenderJobRecord {
    if (!input.scopeId.trim())
      throw new AppError('INVALID_INPUT', 'Render job scope is required', 400);
    const active = this.database.sqlite
      .prepare(
        "SELECT id FROM render_jobs WHERE project_id=? AND render_type=? AND scope_id=? AND status IN ('PENDING','RUNNING') LIMIT 1",
      )
      .get(input.projectId, input.renderType, input.scopeId) as { id: Id } | undefined;
    if (active)
      throw new AppError('CONFLICT', 'A render job for this scope is already active', 409);
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO render_jobs(
          id,project_id,step_id,render_type,scope_id,expected_duration_ms,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.stepId,
        input.renderType,
        input.scopeId,
        input.expectedDurationMs,
        input.status ?? 'PENDING',
        stamp,
        stamp,
      );
    const record = this.get(id);
    if (!record) throw new AppError('RENDER_JOB_NOT_FOUND', 'Render job was not persisted', 500);
    return record;
  }

  get(id: Id): RenderJobRecord | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,step_id as stepId,render_type as renderType,scope_id as scopeId,
          timeline_asset_id as timelineAssetId,output_asset_id as outputAssetId,
          expected_duration_ms as expectedDurationMs,actual_duration_ms as actualDurationMs,
          progress_time_ms as progressTimeMs,diagnostics,status,created_at as createdAt,updated_at as updatedAt
         FROM render_jobs WHERE id=?`,
      )
      .get(id) as
      (Omit<RenderJobRecord, 'diagnostics'> & { diagnostics: string | null }) | undefined;
    if (!row) return null;
    let diagnostics: unknown = null;
    if (row.diagnostics) {
      try {
        diagnostics = JSON.parse(row.diagnostics);
      } catch {
        diagnostics = row.diagnostics;
      }
    }
    return { ...row, diagnostics } as RenderJobRecord;
  }

  list(projectId: Id, renderType?: RenderJobType): RenderJobRecord[] {
    const clause = renderType ? ' AND render_type=?' : '';
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,step_id as stepId,render_type as renderType,scope_id as scopeId,
          timeline_asset_id as timelineAssetId,output_asset_id as outputAssetId,
          expected_duration_ms as expectedDurationMs,actual_duration_ms as actualDurationMs,
          progress_time_ms as progressTimeMs,diagnostics,status,created_at as createdAt,updated_at as updatedAt
         FROM render_jobs WHERE project_id=?${clause} ORDER BY created_at DESC`,
      )
      .all(projectId, ...(renderType ? [renderType] : [])) as Array<
      Omit<RenderJobRecord, 'diagnostics'> & { diagnostics: string | null }
    >;
    return rows.map((row) => {
      let diagnostics: unknown = null;
      if (row.diagnostics) {
        try {
          diagnostics = JSON.parse(row.diagnostics);
        } catch {
          diagnostics = row.diagnostics;
        }
      }
      return { ...row, diagnostics } as RenderJobRecord;
    });
  }

  updateProgress(
    id: Id,
    progressTimeMs: number,
    actualDurationMs?: number | null,
    diagnostics?: unknown,
  ): void {
    if (!Number.isInteger(progressTimeMs) || progressTimeMs < 0) {
      throw new AppError('INVALID_INPUT', 'Render progress time is invalid', 400);
    }
    if (
      actualDurationMs !== undefined &&
      actualDurationMs !== null &&
      (!Number.isInteger(actualDurationMs) || actualDurationMs < 0)
    ) {
      throw new AppError('INVALID_INPUT', 'Render duration is invalid', 400);
    }
    this.database.sqlite
      .prepare(
        'UPDATE render_jobs SET progress_time_ms=?,actual_duration_ms=COALESCE(?,actual_duration_ms),diagnostics=COALESCE(?,diagnostics),updated_at=? WHERE id=?',
      )
      .run(
        progressTimeMs,
        actualDurationMs ?? null,
        diagnostics === undefined ? null : JSON.stringify(diagnostics),
        now(),
        id,
      );
  }

  linkAssets(id: Id, timelineAssetId: Id | null, outputAssetId: Id | null): void {
    this.database.sqlite
      .prepare(
        'UPDATE render_jobs SET timeline_asset_id=?,output_asset_id=?,updated_at=? WHERE id=?',
      )
      .run(timelineAssetId, outputAssetId, now(), id);
  }
  getByStep(stepId: Id): RenderJobRecord | null {
    const row = this.database.sqlite
      .prepare('SELECT id FROM render_jobs WHERE step_id=? LIMIT 1')
      .get(stepId) as { id: Id } | undefined;
    return row ? this.get(row.id) : null;
  }

  setStatus(
    id: Id,
    status: RenderJobStatus,
    diagnostics?: unknown,
    actualDurationMs?: number | null,
  ): void {
    this.database.sqlite
      .prepare(
        'UPDATE render_jobs SET status=?,diagnostics=COALESCE(?,diagnostics),actual_duration_ms=COALESCE(?,actual_duration_ms),updated_at=? WHERE id=?',
      )
      .run(
        status,
        diagnostics === undefined ? null : JSON.stringify(diagnostics),
        actualDurationMs ?? null,
        now(),
        id,
      );
  }
}
