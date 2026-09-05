import { createHash, randomUUID } from 'node:crypto';
import {
  AppError,
  defaultProductionProfileSettings,
  productionInterventionStatusSchema,
  productionInterventionTypeSchema,
  productionIssueSeveritySchema,
  productionProfileKeySchema,
  productionProfileSettingsSchema,
  productionRunStatusSchema,
  productionScopeSchema,
  productionStageKeySchema,
  productionStageStatusSchema,
  type Id,
  type ProductionInterventionDto,
  type ProductionInterventionResolution,
  type ProductionInterventionStatus,
  type ProductionInterventionType,
  type ProductionIssueSeverity,
  type ProductionPlanClassification,
  type ProductionProfileDto,
  type ProductionProfileKey,
  type ProductionProfileSettings,
  type ProductionProfileUpdate,
  type ProductionRunDto,
  type ProductionRunStatus,
  type ProductionSafeError,
  type ProductionScope,
  type ProductionStageDto,
  type ProductionStageKey,
  type ProductionStageProgress,
  type ProductionStageStatus,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const STAGE_ORDER: ProductionStageKey[] = [
  'STORY',
  'CHAPTERS',
  'AUDIO',
  'SCENES',
  'VISUAL_PROFILES',
  'VISUAL_PROMPTS',
  'SCENE_IMAGES',
  'AI_MOTION',
  'TIMELINE',
  'RENDER',
  'PUBLICATION_PACKAGE',
];
const ACTIVE_RUN_STATUSES = ['READY', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED'] as const;
const STAGE_TRANSITIONS: Record<ProductionStageStatus, ProductionStageStatus[]> = {
  PENDING: ['READY', 'RUNNING', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE'],
  READY: ['RUNNING', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE'],
  RUNNING: ['PENDING', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE'],
  WAITING: ['PENDING', 'READY', 'RUNNING', 'COMPLETED', 'FAILED', 'STALE'],
  COMPLETED: ['STALE'],
  SKIPPED: ['STALE'],
  FAILED: ['PENDING', 'READY', 'RUNNING', 'STALE'],
  STALE: ['PENDING', 'READY', 'RUNNING', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED'],
};
const WORKFLOW_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'INVALIDATED',
  'CANCELLED',
] as const;
const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const safeJson = (value: string | null | undefined, fallback: unknown): unknown => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
};
const safeRecord = (value: string | null | undefined): Record<string, unknown> => {
  const parsed = safeJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};
const safeArray = (value: string | null | undefined): string[] => {
  const parsed = safeJson(value, []);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
};
const safeError = (value: string | null | undefined): ProductionSafeError | null => {
  const parsed = safeJson(value, null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return null;
  return {
    code: candidate.code.slice(0, 120),
    message: candidate.message.slice(0, 500),
    retryable: Boolean(candidate.retryable),
    ...(typeof candidate.category === 'string'
      ? { category: candidate.category as ProductionSafeError['category'] }
      : {}),
    ...(typeof candidate.diagnostics === 'string'
      ? { diagnostics: candidate.diagnostics.slice(0, 2_000) }
      : {}),
  };
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function productionFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function parseProfileSettings(value: string): ProductionProfileSettings {
  const parsed = safeRecord(value);
  return productionProfileSettingsSchema.parse({ ...defaultProductionProfileSettings, ...parsed });
}

function profilePreset(key: ProductionProfileKey): ProductionProfileSettings {
  if (key === 'MANUAL_REVIEW') {
    return productionProfileSettingsSchema.parse({
      ...defaultProductionProfileSettings,
      requireStoryApproval: true,
      requireImageApproval: true,
      requireReferenceApproval: true,
      requireContinuityReview: true,
      requireQualityReview: true,
      imageCandidatePolicy: 'QUALITY',
      imageCandidateCount: 3,
      imageQualityGate: 'REQUIRED',
      videoQualityGate: 'REQUIRED',
      strictReferenceRequirement: true,
      qualityFallback: 'MANUAL_REVIEW',
      aiMotionPolicy: 'OFF',
      maxAiVideoScenes: 0,
      generateMetadataDraft: false,
    });
  }
  if (key === 'AUTO') {
    return productionProfileSettingsSchema.parse({
      ...defaultProductionProfileSettings,
      requireStoryApproval: false,
      requireImageApproval: false,
      requireReferenceApproval: false,
      requireContinuityReview: false,
      requireQualityReview: false,
      imageCandidatePolicy: 'BALANCED',
      imageCandidateCount: 2,
      imageQualityGate: 'REQUIRED',
      videoQualityGate: 'REQUIRED',
      qualityFallback: 'BLOCK',
      aiMotionPolicy: 'ALL_ELIGIBLE',
      aiPriorityThreshold: 'LOW',
      maxAiVideoScenes: 10_000,
      generateMetadataDraft: true,
    });
  }
  return productionProfileSettingsSchema.parse({
    ...defaultProductionProfileSettings,
    requireImageApproval: false,
    requireQualityReview: false,
  });
}

function projectIsActive(database: DatabaseHandle, projectId: Id): void {
  const project = database.sqlite
    .prepare('SELECT status FROM projects WHERE id=?')
    .get(projectId) as { status: string } | undefined;
  if (!project) throw new AppError('NOT_FOUND', 'Project not found', 404);
  if (project.status !== 'ACTIVE')
    throw new AppError('PROJECT_ARCHIVED', 'Archived projects cannot run production', 409);
}

function normalizeScope(
  database: DatabaseHandle,
  projectId: Id,
  input: ProductionScope,
): ProductionScope {
  const scope = productionScopeSchema.parse(input);
  projectIsActive(database, projectId);
  if (scope.type === 'FULL_PROJECT') return scope;
  const row = database.sqlite
    .prepare(
      'SELECT MIN(number) as minimum,MAX(number) as maximum,COUNT(*) as count FROM chapters WHERE project_id=? AND number BETWEEN ? AND ?',
    )
    .get(projectId, scope.startChapter, scope.endChapter) as {
    minimum: number | null;
    maximum: number | null;
    count: number;
  };
  if (
    row.minimum !== scope.startChapter ||
    row.maximum !== scope.endChapter ||
    row.count !== scope.endChapter - scope.startChapter + 1
  ) {
    throw new AppError('INVALID_SCOPE', 'Chapter range is outside the current project', 400);
  }
  return scope;
}

function scopeColumns(scope: ProductionScope): [string, number | null, number | null] {
  return scope.type === 'FULL_PROJECT'
    ? [scope.type, null, null]
    : [scope.type, scope.startChapter, scope.endChapter];
}

function scopeFromColumns(
  scopeType: string,
  scopeStart: number | null,
  scopeEnd: number | null,
): ProductionScope {
  if (scopeType === 'FULL_PROJECT') return { type: 'FULL_PROJECT' };
  return productionScopeSchema.parse({
    type: 'CHAPTER_RANGE',
    startChapter: scopeStart,
    endChapter: scopeEnd,
  });
}

export type ProductionProfileRecord = ProductionProfileDto;

export class ProductionProfileRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private read(row: Record<string, unknown> | undefined): ProductionProfileRecord | null {
    if (!row) return null;
    const key = productionProfileKeySchema.parse(row.key);
    return {
      id: row.id as Id,
      projectId: row.projectId as Id,
      key,
      revision: Number(row.revision),
      rowVersion: Number(row.rowVersion),
      settings: parseProfileSettings(String(row.settings ?? '{}')),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  get(id: Id): ProductionProfileRecord | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,profile_key as key,revision,row_version as rowVersion,
          settings,created_at as createdAt,updated_at as updatedAt
         FROM production_profiles WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return this.read(row);
  }

  getCurrent(projectId: Id, key: ProductionProfileKey): ProductionProfileRecord | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,profile_key as key,revision,row_version as rowVersion,
          settings,created_at as createdAt,updated_at as updatedAt
         FROM production_profiles WHERE project_id=? AND profile_key=? AND is_current=1`,
      )
      .get(projectId, key) as Record<string, unknown> | undefined;
    return this.read(row);
  }

  list(projectId: Id): ProductionProfileRecord[] {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,profile_key as key,revision,row_version as rowVersion,
          settings,created_at as createdAt,updated_at as updatedAt
         FROM production_profiles WHERE project_id=? AND is_current=1 ORDER BY profile_key`,
      )
      .all(projectId)
      .map((row) => this.read(row as Record<string, unknown>)!)
      .filter(Boolean);
  }

  getOrCreate(projectId: Id, key: ProductionProfileKey = 'BALANCED'): ProductionProfileRecord {
    projectIsActive(this.database, projectId);
    const existing = this.getCurrent(projectId, key);
    if (existing) return existing;
    const tx = this.database.sqlite.transaction(() => {
      const afterLock = this.getCurrent(projectId, key);
      if (afterLock) return afterLock;
      const revisionRow = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0)+1 as revision FROM production_profiles WHERE project_id=? AND profile_key=?',
        )
        .get(projectId, key) as { revision: number };
      const id = randomUUID();
      const stamp = now();
      this.database.sqlite
        .prepare(
          `INSERT INTO production_profiles(id,project_id,profile_key,revision,settings,is_current,row_version,created_at,updated_at)
           VALUES(?,?,?,?,?,1,1,?,?)`,
        )
        .run(id, projectId, key, revisionRow.revision, json(profilePreset(key)), stamp, stamp);
      return this.get(id);
    });
    const created = tx();
    if (!created)
      throw new AppError('PROFILE_NOT_FOUND', 'Production profile was not persisted', 500);
    return created;
  }

  update(
    projectId: Id,
    key: ProductionProfileKey,
    input: ProductionProfileUpdate,
  ): ProductionProfileRecord {
    projectIsActive(this.database, projectId);
    const current = this.getCurrent(projectId, key);
    if (!current) throw new AppError('PROFILE_NOT_FOUND', 'Production profile not found', 404);
    if (input.expectedRowVersion !== current.rowVersion)
      throw new AppError(
        'PROFILE_VERSION_CONFLICT',
        'Production profile changed; reload before saving',
        409,
      );
    const settings = productionProfileSettingsSchema.parse({
      ...current.settings,
      ...input.settings,
    });
    const tx = this.database.sqlite.transaction(() => {
      const guard = this.database.sqlite
        .prepare(
          'UPDATE production_profiles SET is_current=0,updated_at=? WHERE id=? AND is_current=1 AND row_version=?',
        )
        .run(now(), current.id, current.rowVersion);
      if (guard.changes !== 1)
        throw new AppError(
          'PROFILE_VERSION_CONFLICT',
          'Production profile changed; reload before saving',
          409,
        );
      const id = randomUUID();
      const stamp = now();
      this.database.sqlite
        .prepare(
          `INSERT INTO production_profiles(id,project_id,profile_key,revision,settings,is_current,row_version,created_at,updated_at)
           VALUES(?,?,?,?,?,1,?,?,?)`,
        )
        .run(
          id,
          projectId,
          key,
          current.revision + 1,
          json(settings),
          current.rowVersion + 1,
          stamp,
          stamp,
        );
      return this.get(id);
    });
    const updated = tx();
    if (!updated)
      throw new AppError('PROFILE_NOT_FOUND', 'Production profile was not persisted', 500);
    return updated;
  }
}

export type ProductionRunRecord = ProductionRunDto;

export class ProductionRunRepository {
  constructor(
    private readonly database: DatabaseHandle,
    private readonly profiles: ProductionProfileRepository = new ProductionProfileRepository(
      database,
    ),
  ) {}

  private read(row: Record<string, unknown> | undefined): ProductionRunRecord | null {
    if (!row) return null;
    return {
      id: row.id as Id,
      projectId: row.projectId as Id,
      workflowExecutionId: row.workflowExecutionId as Id,
      profileId: row.profileId as Id,
      profileRevision: Number(row.profileRevision),
      scope: scopeFromColumns(
        String(row.scopeType),
        (row.scopeStart as number | null) ?? null,
        (row.scopeEnd as number | null) ?? null,
      ),
      fingerprint: String(row.fingerprint),
      status: productionRunStatusSchema.parse(row.status),
      currentStage: row.currentStage ? productionStageKeySchema.parse(row.currentStage) : null,
      rowVersion: Number(row.rowVersion),
      progress: { current: Number(row.progressCurrent), total: Number(row.progressTotal) },
      metrics: safeRecord(row.metrics as string | null),
      error: safeError(row.error as string | null),
      createdAt: String(row.createdAt),
      startedAt: (row.startedAt as string | null) ?? null,
      pausedAt: (row.pausedAt as string | null) ?? null,
      completedAt: (row.completedAt as string | null) ?? null,
      cancellationRequestedAt: (row.cancellationRequestedAt as string | null) ?? null,
      updatedAt: String(row.updatedAt),
    };
  }

  private row(id: Id): Record<string, unknown> | undefined {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,workflow_execution_id as workflowExecutionId,
          profile_id as profileId,profile_revision as profileRevision,scope_type as scopeType,
          scope_start as scopeStart,scope_end as scopeEnd,fingerprint,status,current_stage as currentStage,
          row_version as rowVersion,progress_current as progressCurrent,progress_total as progressTotal,
          metrics,error,created_at as createdAt,started_at as startedAt,paused_at as pausedAt,
          completed_at as completedAt,cancellation_requested_at as cancellationRequestedAt,updated_at as updatedAt
         FROM production_runs WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
  }

  get(id: Id): ProductionRunRecord | null {
    return this.read(this.row(id));
  }

  getByWorkflowExecution(workflowExecutionId: Id): ProductionRunRecord | null {
    const row = this.database.sqlite
      .prepare('SELECT id FROM production_runs WHERE workflow_execution_id=?')
      .get(workflowExecutionId) as { id: Id } | undefined;
    return row ? this.get(row.id) : null;
  }

  list(projectId: Id, limit = 50): ProductionRunRecord[] {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,workflow_execution_id as workflowExecutionId,
          profile_id as profileId,profile_revision as profileRevision,scope_type as scopeType,
          scope_start as scopeStart,scope_end as scopeEnd,fingerprint,status,current_stage as currentStage,
          row_version as rowVersion,progress_current as progressCurrent,progress_total as progressTotal,
          metrics,error,created_at as createdAt,started_at as startedAt,paused_at as pausedAt,
          completed_at as completedAt,cancellation_requested_at as cancellationRequestedAt,updated_at as updatedAt
         FROM production_runs WHERE project_id=? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, Math.max(1, Math.min(100, limit)))
      .map((row) => this.read(row as Record<string, unknown>)!)
      .filter(Boolean);
  }

  create(
    projectId: Id,
    profileId: Id | undefined,
    inputScope: ProductionScope,
  ): ProductionRunRecord {
    const scope = normalizeScope(this.database, projectId, inputScope);
    const profile = profileId
      ? this.profiles.get(profileId)
      : this.profiles.getOrCreate(projectId, 'BALANCED');
    if (!profile || profile.projectId !== projectId)
      throw new AppError('PROFILE_NOT_FOUND', 'Production profile not found for this project', 404);
    const [scopeType, scopeStart, scopeEnd] = scopeColumns(scope);
    const fingerprint = productionFingerprint({
      projectId,
      profileId: profile.id,
      profileRevision: profile.revision,
      settings: profile.settings,
      scope,
    });
    const tx = this.database.sqlite.transaction(() => {
      const id = randomUUID();
      const executionId = randomUUID();
      const stamp = now();
      this.database.sqlite
        .prepare(
          'INSERT INTO workflow_executions(id,project_id,type,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
        )
        .run(executionId, projectId, 'PRODUCTION_PIPELINE', 'PENDING', stamp, stamp);
      this.database.sqlite
        .prepare(
          `INSERT INTO production_runs(
            id,project_id,workflow_execution_id,profile_id,profile_revision,scope_type,scope_start,scope_end,
            fingerprint,status,row_version,progress_current,progress_total,metrics,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',1,0,0,'{}',?,?)`,
        )
        .run(
          id,
          projectId,
          executionId,
          profile.id,
          profile.revision,
          scopeType,
          scopeStart,
          scopeEnd,
          fingerprint,
          stamp,
          stamp,
        );
      for (let ordinal = 0; ordinal < STAGE_ORDER.length; ordinal += 1) {
        const stage = STAGE_ORDER[ordinal];
        this.database.sqlite
          .prepare(
            `INSERT INTO production_stages(
              id,run_id,stage_key,ordinal,status,attempt,fingerprint,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            randomUUID(),
            id,
            stage,
            ordinal,
            'PENDING',
            0,
            productionFingerprint({ fingerprint, stage }),
            stamp,
            stamp,
          );
      }
      return id;
    });
    return this.get(tx())!;
  }

  private hasActiveOverlap(projectId: Id, scope: ProductionScope, excludingRunId?: Id): boolean {
    const [scopeType, scopeStart, scopeEnd] = scopeColumns(scope);
    const excluded = excludingRunId ?? '';
    const row = this.database.sqlite
      .prepare(
        `SELECT 1 FROM production_runs
         WHERE project_id=? AND id<>? AND status IN ('READY','RUNNING','WAITING_FOR_USER','PAUSED')
           AND (
             scope_type='FULL_PROJECT' OR ?='FULL_PROJECT' OR
             (scope_type='CHAPTER_RANGE' AND ?='CHAPTER_RANGE' AND scope_start<=? AND scope_end>=?)
           ) LIMIT 1`,
      )
      .get(projectId, excluded, scopeType, scopeType, scopeEnd, scopeStart) as
      { 1: number } | undefined;
    return Boolean(row);
  }

  start(id: Id, expectedRowVersion?: number): ProductionRunRecord {
    const tx = this.database.sqlite.transaction(() => {
      const current = this.get(id);
      if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
      if (expectedRowVersion !== undefined && expectedRowVersion !== current.rowVersion)
        throw new AppError(
          'PRODUCTION_VERSION_CONFLICT',
          'Production run changed; reload before starting',
          409,
        );
      if (!['READY', 'PAUSED'].includes(current.status))
        throw new AppError(
          'PRODUCTION_INVALID_TRANSITION',
          `Run cannot start from ${current.status}`,
          409,
        );
      if (this.hasActiveOverlap(current.projectId, current.scope, current.id))
        throw new AppError(
          'PRODUCTION_SCOPE_CONFLICT',
          'An overlapping production run is already active',
          409,
        );
      const stamp = now();
      const result = this.database.sqlite
        .prepare(
          `UPDATE production_runs SET status='RUNNING',started_at=COALESCE(started_at,?),paused_at=NULL,
            row_version=row_version+1,updated_at=? WHERE id=? AND row_version=?`,
        )
        .run(stamp, stamp, id, current.rowVersion);
      if (result.changes !== 1)
        throw new AppError(
          'PRODUCTION_VERSION_CONFLICT',
          'Production run changed; reload before starting',
          409,
        );
      this.database.sqlite
        .prepare(
          "UPDATE workflow_executions SET status='RUNNING',updated_at=? WHERE id=? AND status!='COMPLETED'",
        )
        .run(stamp, current.workflowExecutionId);
      return this.get(id);
    });
    const run = tx();
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    return run;
  }

  setReady(id: Id, expectedRowVersion?: number): ProductionRunRecord {
    return this.transition(id, 'READY', expectedRowVersion);
  }

  transition(
    id: Id,
    status: ProductionRunStatus,
    expectedRowVersion?: number,
    error?: ProductionSafeError | null,
  ): ProductionRunRecord {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const allowed: Record<ProductionRunStatus, ProductionRunStatus[]> = {
      DRAFT: ['READY', 'CANCELLED'],
      READY: ['RUNNING', 'CANCELLED'],
      RUNNING: ['WAITING_FOR_USER', 'PAUSED', 'FAILED', 'CANCELLED', 'COMPLETED'],
      WAITING_FOR_USER: ['RUNNING', 'PAUSED', 'FAILED', 'CANCELLED'],
      PAUSED: ['RUNNING', 'CANCELLED', 'FAILED'],
      FAILED: ['READY', 'CANCELLED'],
      CANCELLED: [],
      COMPLETED: [],
    };
    if (current.status !== status && !allowed[current.status].includes(status))
      throw new AppError(
        'PRODUCTION_INVALID_TRANSITION',
        `Run cannot transition from ${current.status} to ${status}`,
        409,
      );
    if (expectedRowVersion !== undefined && expectedRowVersion !== current.rowVersion)
      throw new AppError(
        'PRODUCTION_VERSION_CONFLICT',
        'Production run changed; reload before updating',
        409,
      );
    const stamp = now();
    const completedAt = status === 'COMPLETED' ? stamp : null;
    const pausedAt = status === 'PAUSED' ? stamp : status === 'RUNNING' ? null : current.pausedAt;
    const result = this.database.sqlite
      .prepare(
        `UPDATE production_runs SET status=?,error=?,paused_at=?,completed_at=COALESCE(?,completed_at),
          row_version=row_version+1,updated_at=? WHERE id=? AND row_version=?`,
      )
      .run(
        status,
        error ? json(error) : null,
        pausedAt,
        completedAt,
        stamp,
        id,
        current.rowVersion,
      );
    if (result.changes !== 1)
      throw new AppError(
        'PRODUCTION_VERSION_CONFLICT',
        'Production run changed; reload before updating',
        409,
      );
    const workflowStatus =
      status === 'CANCELLED' ? 'CANCELLED' : status === 'COMPLETED' ? 'COMPLETED' : null;
    if (workflowStatus)
      this.database.sqlite
        .prepare('UPDATE workflow_executions SET status=?,updated_at=? WHERE id=?')
        .run(workflowStatus, stamp, current.workflowExecutionId);
    return this.get(id)!;
  }

  requestCancel(id: Id, expectedRowVersion?: number): ProductionRunRecord {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (expectedRowVersion !== undefined && expectedRowVersion !== current.rowVersion)
      throw new AppError(
        'PRODUCTION_VERSION_CONFLICT',
        'Production run changed; reload before cancelling',
        409,
      );
    if (['COMPLETED', 'CANCELLED'].includes(current.status)) return current;
    const stamp = now();
    this.database.sqlite
      .prepare(
        "UPDATE production_runs SET status='CANCELLED',cancellation_requested_at=?,row_version=row_version+1,updated_at=? WHERE id=? AND row_version=?",
      )
      .run(stamp, stamp, id, current.rowVersion);
    this.database.sqlite
      .prepare(
        "UPDATE workflow_executions SET status='CANCELLED',cancellation_requested_at=?,updated_at=? WHERE id=?",
      )
      .run(stamp, stamp, current.workflowExecutionId);
    return this.get(id)!;
  }

  updateProgress(
    id: Id,
    progress: ProductionStageProgress,
    metrics?: Record<string, unknown>,
  ): void {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const currentValue = Math.max(0, Math.min(1_000_000, Math.trunc(progress.current)));
    const totalValue = Math.max(0, Math.min(1_000_000, Math.trunc(progress.total)));
    this.database.sqlite
      .prepare(
        'UPDATE production_runs SET progress_current=?,progress_total=?,metrics=COALESCE(?,metrics),row_version=row_version+1,updated_at=? WHERE id=?',
      )
      .run(currentValue, totalValue, metrics ? json(metrics) : null, now(), id);
  }

  setCurrentStage(id: Id, stage: ProductionStageKey | null): void {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (stage) productionStageKeySchema.parse(stage);
    this.database.sqlite
      .prepare('UPDATE production_runs SET current_stage=?,updated_at=? WHERE id=?')
      .run(stage, now(), id);
  }

  active(projectId: Id): ProductionRunRecord[] {
    return this.database.sqlite
      .prepare(
        `SELECT id FROM production_runs WHERE project_id=? AND status IN ('READY','RUNNING','WAITING_FOR_USER','PAUSED') ORDER BY created_at`,
      )
      .all(projectId)
      .map((row) => this.get((row as { id: Id }).id)!)
      .filter(Boolean);
  }

  stages(runId: Id): ProductionStageRecord[] {
    return new ProductionStageRepository(this.database).list(runId);
  }
}

export type ProductionStageRecord = ProductionStageDto;
export type ProductionStageProjection = {
  status?: ProductionStageStatus;
  attempt?: number;
  fingerprint?: string;
  progress?: ProductionStageProgress;
  reusableCount?: number;
  generatedCount?: number;
  reviewCount?: number;
  blockedCount?: number;
  summary?: Record<string, unknown>;
  warnings?: string[];
  fallbacks?: string[];
  blockers?: string[];
  error?: ProductionSafeError | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

function boundedCount(value: number | undefined): number {
  return Math.max(0, Math.min(1_000_000, Math.trunc(value ?? 0)));
}

export class ProductionStageRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private read(row: Record<string, unknown> | undefined): ProductionStageRecord | null {
    if (!row) return null;
    return {
      id: row.id as Id,
      runId: row.runId as Id,
      key: productionStageKeySchema.parse(row.key),
      ordinal: Number(row.ordinal),
      status: productionStageStatusSchema.parse(row.status),
      attempt: Number(row.attempt),
      fingerprint: String(row.fingerprint),
      progress: { current: Number(row.progressCurrent), total: Number(row.progressTotal) },
      reusableCount: Number(row.reusableCount),
      generatedCount: Number(row.generatedCount),
      reviewCount: Number(row.reviewCount),
      blockedCount: Number(row.blockedCount),
      summary: safeRecord(row.summary as string | null),
      warnings: safeArray(row.warnings as string | null),
      fallbacks: safeArray(row.fallbacks as string | null),
      blockers: safeArray(row.blockers as string | null),
      error: safeError(row.error as string | null),
      createdAt: String(row.createdAt),
      startedAt: (row.startedAt as string | null) ?? null,
      completedAt: (row.completedAt as string | null) ?? null,
      updatedAt: String(row.updatedAt),
    };
  }

  private select(id: Id): Record<string, unknown> | undefined {
    return this.database.sqlite
      .prepare(
        `SELECT id,run_id as runId,stage_key as key,ordinal,status,attempt,fingerprint,
          progress_current as progressCurrent,progress_total as progressTotal,reusable_count as reusableCount,
          generated_count as generatedCount,review_count as reviewCount,blocked_count as blockedCount,
          summary,warnings,fallbacks,blockers,error,created_at as createdAt,started_at as startedAt,
          completed_at as completedAt,updated_at as updatedAt FROM production_stages WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
  }

  get(id: Id): ProductionStageRecord | null {
    return this.read(this.select(id));
  }

  getByRunAndKey(runId: Id, key: ProductionStageKey): ProductionStageRecord | null {
    const row = this.database.sqlite
      .prepare('SELECT id FROM production_stages WHERE run_id=? AND stage_key=?')
      .get(runId, key) as { id: Id } | undefined;
    return row ? this.get(row.id) : null;
  }

  list(runId: Id): ProductionStageRecord[] {
    return this.database.sqlite
      .prepare('SELECT id FROM production_stages WHERE run_id=? ORDER BY ordinal')
      .all(runId)
      .map((row) => this.get((row as { id: Id }).id)!)
      .filter(Boolean);
  }

  initialize(runId: Id, runFingerprint: string): ProductionStageRecord[] {
    const stamp = now();
    const tx = this.database.sqlite.transaction(() => {
      for (let ordinal = 0; ordinal < STAGE_ORDER.length; ordinal += 1) {
        const key = STAGE_ORDER[ordinal];
        this.database.sqlite
          .prepare(
            `INSERT OR IGNORE INTO production_stages(id,run_id,stage_key,ordinal,status,attempt,fingerprint,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            randomUUID(),
            runId,
            key,
            ordinal,
            'PENDING',
            0,
            productionFingerprint({ runFingerprint, key }),
            stamp,
            stamp,
          );
      }
    });
    tx();
    return this.list(runId);
  }

  update(id: Id, input: ProductionStageProjection): ProductionStageRecord {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production stage not found', 404);
    const progress = input.progress ?? current.progress;
    const values = {
      status: input.status ?? current.status,
      attempt: boundedCount(input.attempt ?? current.attempt),
      fingerprint: input.fingerprint ?? current.fingerprint,
      progressCurrent: boundedCount(progress.current),
      progressTotal: boundedCount(progress.total),
      reusableCount: boundedCount(input.reusableCount ?? current.reusableCount),
      generatedCount: boundedCount(input.generatedCount ?? current.generatedCount),
      reviewCount: boundedCount(input.reviewCount ?? current.reviewCount),
      blockedCount: boundedCount(input.blockedCount ?? current.blockedCount),
      summary: input.summary ?? current.summary,
      warnings: input.warnings ?? current.warnings,
      fallbacks: input.fallbacks ?? current.fallbacks,
      blockers: input.blockers ?? current.blockers,
      error: input.error === undefined ? current.error : input.error,
      startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt,
      completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt,
    };
    productionStageStatusSchema.parse(values.status);
    if (
      current.status !== values.status &&
      !STAGE_TRANSITIONS[current.status].includes(values.status)
    )
      throw new AppError(
        'PRODUCTION_STAGE_INVALID_TRANSITION',
        `Stage cannot transition from ${current.status} to ${values.status}`,
        409,
      );
    this.database.sqlite
      .prepare(
        `UPDATE production_stages SET status=?,attempt=?,fingerprint=?,progress_current=?,progress_total=?,
          reusable_count=?,generated_count=?,review_count=?,blocked_count=?,summary=?,warnings=?,fallbacks=?,blockers=?,
          error=?,started_at=?,completed_at=?,updated_at=? WHERE id=?`,
      )
      .run(
        values.status,
        values.attempt,
        values.fingerprint,
        values.progressCurrent,
        values.progressTotal,
        values.reusableCount,
        values.generatedCount,
        values.reviewCount,
        values.blockedCount,
        json(values.summary),
        json(values.warnings.slice(0, 100)),
        json(values.fallbacks.slice(0, 100)),
        json(values.blockers.slice(0, 100)),
        values.error ? json(values.error) : null,
        values.startedAt,
        values.completedAt,
        now(),
        id,
      );
    return this.get(id)!;
  }

  linkWork(input: {
    stageId: Id;
    workflowStepId: Id;
    unitKey: string;
    entityId?: Id | null;
    classification: ProductionPlanClassification;
    inputFingerprint: string;
    outputFingerprint?: string | null;
    status?: (typeof WORKFLOW_STATUSES)[number];
    summary?: Record<string, unknown>;
  }): Id {
    if (!input.unitKey.trim())
      throw new AppError('INVALID_INPUT', 'Production unit key is required', 400);
    const existing = this.database.sqlite
      .prepare('SELECT id FROM production_stage_work WHERE stage_id=? AND unit_key=?')
      .get(input.stageId, input.unitKey) as { id: Id } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.database.sqlite
      .prepare(
        `INSERT INTO production_stage_work(
          id,stage_id,workflow_step_id,unit_key,entity_id,classification,input_fingerprint,output_fingerprint,status,summary,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.stageId,
        input.workflowStepId,
        input.unitKey,
        input.entityId ?? null,
        input.classification,
        input.inputFingerprint,
        input.outputFingerprint ?? null,
        input.status ?? 'PENDING',
        json(input.summary ?? {}),
        now(),
        now(),
      );
    return id;
  }

  listWork(stageId: Id, limit = 100, offset = 0): Array<Record<string, unknown>> {
    const rows = this.database.sqlite
      .prepare(
        `SELECT id,stage_id as stageId,workflow_step_id as workflowStepId,unit_key as unitKey,entity_id as entityId,
          classification,input_fingerprint as inputFingerprint,output_fingerprint as outputFingerprint,status,summary,
          created_at as createdAt,updated_at as updatedAt FROM production_stage_work WHERE stage_id=?
         ORDER BY unit_key LIMIT ? OFFSET ?`,
      )
      .all(stageId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({ ...row, summary: safeRecord(row.summary as string | null) }));
  }

  aggregateWork(
    stageId: Id,
    sampleLimit = 20,
  ): {
    total: number;
    byClassification: Record<string, number>;
    byStatus: Record<string, number>;
    samples: Array<Record<string, unknown>>;
  } {
    const total = Number(
      (
        this.database.sqlite
          .prepare('SELECT COUNT(*) as count FROM production_stage_work WHERE stage_id=?')
          .get(stageId) as { count: number }
      ).count,
    );
    const byClassification: Record<string, number> = {};
    for (const row of this.database.sqlite
      .prepare(
        'SELECT classification,COUNT(*) as count FROM production_stage_work WHERE stage_id=? GROUP BY classification',
      )
      .all(stageId) as Array<{ classification: string; count: number }>) {
      byClassification[row.classification] = row.count;
    }
    const byStatus: Record<string, number> = {};
    for (const row of this.database.sqlite
      .prepare(
        'SELECT status,COUNT(*) as count FROM production_stage_work WHERE stage_id=? GROUP BY status',
      )
      .all(stageId) as Array<{ status: string; count: number }>) {
      byStatus[row.status] = row.count;
    }
    return {
      total,
      byClassification,
      byStatus,
      samples: this.listWork(stageId, Math.min(20, sampleLimit), 0),
    };
  }

  updateWorkStatus(
    stageId: Id,
    unitKey: string,
    status: (typeof WORKFLOW_STATUSES)[number],
    outputFingerprint?: string | null,
  ): void {
    if (!WORKFLOW_STATUSES.includes(status))
      throw new AppError('INVALID_INPUT', 'Invalid production work status', 400);
    this.database.sqlite
      .prepare(
        'UPDATE production_stage_work SET status=?,output_fingerprint=COALESCE(?,output_fingerprint),updated_at=? WHERE stage_id=? AND unit_key=?',
      )
      .run(status, outputFingerprint ?? null, now(), stageId, unitKey);
  }
}

export type ProductionInterventionRecord = ProductionInterventionDto;

export class ProductionInterventionRepository {
  constructor(private readonly database: DatabaseHandle) {}

  private read(row: Record<string, unknown> | undefined): ProductionInterventionRecord | null {
    if (!row) return null;
    return {
      id: row.id as Id,
      runId: row.runId as Id,
      stageId: (row.stageId as Id | null) ?? null,
      type: productionInterventionTypeSchema.parse(row.type),
      severity: productionIssueSeveritySchema.parse(row.severity),
      status: productionInterventionStatusSchema.parse(row.status),
      affectedEntityType: (row.affectedEntityType as string | null) ?? null,
      affectedEntityId: (row.affectedEntityId as Id | null) ?? null,
      message: String(row.message),
      actions: safeArray(row.actions as string | null),
      dedupeKey: String(row.dedupeKey),
      resolution: row.resolution ? safeRecord(row.resolution as string) : null,
      createdAt: String(row.createdAt),
      resolvedAt: (row.resolvedAt as string | null) ?? null,
      updatedAt: String(row.updatedAt),
    };
  }

  private get(id: Id): ProductionInterventionRecord | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT id,run_id as runId,stage_id as stageId,type,severity,status,affected_entity_type as affectedEntityType,
          affected_entity_id as affectedEntityId,message,actions,dedupe_key as dedupeKey,resolution,
          created_at as createdAt,resolved_at as resolvedAt,updated_at as updatedAt FROM production_interventions WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return this.read(row);
  }

  list(runId: Id, status?: ProductionInterventionStatus): ProductionInterventionRecord[] {
    const clause = status ? ' AND status=?' : '';
    return this.database.sqlite
      .prepare(
        `SELECT id,run_id as runId,stage_id as stageId,type,severity,status,affected_entity_type as affectedEntityType,
          affected_entity_id as affectedEntityId,message,actions,dedupe_key as dedupeKey,resolution,
          created_at as createdAt,resolved_at as resolvedAt,updated_at as updatedAt
         FROM production_interventions WHERE run_id=?${clause} ORDER BY created_at DESC`,
      )
      .all(runId, ...(status ? [status] : []))
      .map((row) => this.read(row as Record<string, unknown>)!)
      .filter(Boolean);
  }

  upsertOpen(input: {
    runId: Id;
    stageId?: Id | null;
    type: ProductionInterventionType;
    severity: ProductionIssueSeverity;
    affectedEntityType?: string | null;
    affectedEntityId?: Id | null;
    message: string;
    actions?: string[];
    dedupeKey: string;
  }): ProductionInterventionRecord {
    productionInterventionTypeSchema.parse(input.type);
    productionIssueSeveritySchema.parse(input.severity);
    if (!input.dedupeKey.trim())
      throw new AppError('INVALID_INPUT', 'Intervention dedupe key is required', 400);
    const existing = this.database.sqlite
      .prepare(
        "SELECT id FROM production_interventions WHERE run_id=? AND dedupe_key=? AND status='OPEN'",
      )
      .get(input.runId, input.dedupeKey) as { id: Id } | undefined;
    if (existing) return this.get(existing.id)!;
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        `INSERT INTO production_interventions(
          id,run_id,stage_id,type,severity,status,affected_entity_type,affected_entity_id,message,actions,dedupe_key,created_at,updated_at
        ) VALUES(?,?,?,?,?,'OPEN',?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.runId,
        input.stageId ?? null,
        input.type,
        input.severity,
        input.affectedEntityType ?? null,
        input.affectedEntityId ?? null,
        input.message.slice(0, 500),
        json((input.actions ?? []).slice(0, 20)),
        input.dedupeKey.slice(0, 300),
        stamp,
        stamp,
      );
    return this.get(id)!;
  }

  resolve(id: Id, input: ProductionInterventionResolution): ProductionInterventionRecord {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production intervention not found', 404);
    if (current.status !== 'OPEN') return current;
    const stamp = now();
    this.database.sqlite
      .prepare(
        "UPDATE production_interventions SET status='RESOLVED',resolution=?,resolved_at=?,updated_at=? WHERE id=? AND status='OPEN'",
      )
      .run(json(input.resolution), stamp, stamp, id);
    return this.get(id)!;
  }

  dismiss(id: Id, input: ProductionInterventionResolution): ProductionInterventionRecord {
    const current = this.get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Production intervention not found', 404);
    if (current.severity === 'BLOCKING' && current.status === 'OPEN')
      throw new AppError(
        'PRODUCTION_GATE_REQUIRED',
        'Blocking production interventions must be resolved, not dismissed',
        409,
      );
    if (current.status !== 'OPEN') return current;
    const stamp = now();
    this.database.sqlite
      .prepare(
        "UPDATE production_interventions SET status='DISMISSED',resolution=?,resolved_at=?,updated_at=? WHERE id=? AND status='OPEN'",
      )
      .run(json(input.resolution), stamp, stamp, id);
    return this.get(id)!;
  }
}

export const productionStageOrder = STAGE_ORDER;
export const productionActiveRunStatuses = ACTIVE_RUN_STATUSES;
