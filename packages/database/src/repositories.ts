import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from './db.js';
import { AppError } from '@studio/shared';
import type {
  ChapterDto,
  ChapterInput,
  Id,
  ProjectDto,
  ProjectInput,
  RenderConfig,
  WorkflowStatus,
} from '@studio/shared';
const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parseMetadata = (value: unknown): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(typeof value === 'string' ? value : '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
const safeError = (value: string): string => value.slice(0, 2_000);
export type ChapterStatusFilter = 'FAILED' | 'PENDING' | 'CONTINUITY_STALE' | 'WARN';

export class ProjectRepository {
  constructor(private readonly database: DatabaseHandle) {}

  list(): ProjectDto[] {
    return this.database.sqlite
      .prepare(
        'SELECT id, title, description, language, workflow_type as workflowType, status, created_at as createdAt, updated_at as updatedAt FROM projects WHERE status != ? ORDER BY updated_at DESC',
      )
      .all('DELETED') as ProjectDto[];
  }

  get(id: Id): ProjectDto | null {
    return this.database.sqlite
      .prepare(
        'SELECT id, title, description, language, workflow_type as workflowType, status, created_at as createdAt, updated_at as updatedAt FROM projects WHERE id = ?',
      )
      .get(id) as ProjectDto | null;
  }

  create(input: ProjectInput): ProjectDto {
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO projects (id,title,description,language,workflow_type,status,render_config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.title,
        input.description,
        input.language,
        input.workflowType,
        'ACTIVE',
        json({}),
        stamp,
        stamp,
      );
    return this.get(id)!;
  }

  update(id: Id, input: Partial<ProjectInput>): ProjectDto {
    const current = this.get(id);
    if (!current) throw new Error('Project not found');
    const next = { ...current, ...input };
    const stamp = now();
    this.database.sqlite
      .prepare(
        'UPDATE projects SET title=?, description=?, language=?, workflow_type=?, updated_at=?, row_version=row_version+1 WHERE id=?',
      )
      .run(next.title, next.description, next.language, next.workflowType, stamp, id);
    return this.get(id)!;
  }

  delete(id: Id): void {
    this.database.sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
  }

  getRenderConfig(id: Id): RenderConfig {
    const row = this.database.sqlite
      .prepare('SELECT render_config FROM projects WHERE id=?')
      .get(id) as { render_config: string } | undefined;
    return JSON.parse(row?.render_config ?? '{}') as RenderConfig;
  }

  setRenderConfig(id: Id, config: RenderConfig): void {
    this.database.sqlite
      .prepare('UPDATE projects SET render_config=?, updated_at=? WHERE id=?')
      .run(json(config), now(), id);
  }
}

export class ChapterRepository {
  constructor(private readonly database: DatabaseHandle) {}

  list(projectId: Id): ChapterDto[] {
    return this.database.sqlite
      .prepare(
        `SELECT c.id,c.project_id as projectId,c.number,c.title,c.content,c.revision,
          c.story_origin as origin,c.story_plan_item_id as storyPlanItemId,
          c.story_generation_id as storyGenerationId,c.continuity_status as continuityStatus,
          c.continuity_check_status as continuityCheckStatus,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM story_summary_revisions s
              WHERE s.chapter_id=c.id AND s.is_current=1 AND s.status='CURRENT'
            ) THEN 'CURRENT'
            WHEN EXISTS (SELECT 1 FROM story_summary_revisions s WHERE s.chapter_id=c.id)
              THEN 'STALE'
            ELSE 'MISSING'
          END as summaryStatus,
          COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='MERGE_AUDIO' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as audioStatus,
          COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='SUBTITLE' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as subtitleStatus,
          c.created_at as createdAt,c.updated_at as updatedAt
         FROM chapters c WHERE c.project_id=? ORDER BY c.number`,
      )
      .all(projectId) as ChapterDto[];
  }
  listPage(
    projectId: Id,
    limit = 25,
    offset = 0,
    search = '',
    status: ChapterStatusFilter | '' = '',
  ): ChapterDto[] {
    const normalizedSearch = search.trim();
    const pattern = `%${normalizedSearch}%`;
    const statusClause =
      status === 'FAILED'
        ? "AND (c.continuity_check_status='FAIL' OR EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.entity_id=c.id AND ws.status='FAILED'))"
        : status === 'PENDING'
          ? "AND (c.continuity_status='NOT_ANALYZED' OR NOT EXISTS (SELECT 1 FROM story_summary_revisions s WHERE s.chapter_id=c.id AND s.is_current=1 AND s.status='CURRENT') OR EXISTS (SELECT 1 FROM workflow_steps ws WHERE ws.entity_id=c.id AND ws.status IN ('PENDING','RUNNING')))"
          : status === 'CONTINUITY_STALE'
            ? "AND c.continuity_status='CONTINUITY_STALE'"
            : status === 'WARN'
              ? "AND c.continuity_check_status='WARN'"
              : '';
    return this.database.sqlite
      .prepare(
        `SELECT c.id,c.project_id as projectId,c.number,c.title,c.content,c.revision,
          c.story_origin as origin,c.story_plan_item_id as storyPlanItemId,
          c.story_generation_id as storyGenerationId,c.continuity_status as continuityStatus,
          c.continuity_check_status as continuityCheckStatus,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM story_summary_revisions s
              WHERE s.chapter_id=c.id AND s.is_current=1 AND s.status='CURRENT'
            ) THEN 'CURRENT'
            WHEN EXISTS (SELECT 1 FROM story_summary_revisions s WHERE s.chapter_id=c.id)
              THEN 'STALE'
            ELSE 'MISSING'
          END as summaryStatus,
          COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='MERGE_AUDIO' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as audioStatus,
          COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='SUBTITLE' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as subtitleStatus,
          c.created_at as createdAt,c.updated_at as updatedAt
         FROM chapters c
         WHERE c.project_id=? AND (?='' OR c.title LIKE ? OR c.content LIKE ?) ${statusClause}
         ORDER BY c.number LIMIT ? OFFSET ?`,
      )
      .all(
        projectId,
        normalizedSearch,
        pattern,
        pattern,
        Math.max(1, Math.min(100, limit)),
        Math.max(0, offset),
      ) as ChapterDto[];
  }
  listMetadata(
    projectId: Id,
  ): Array<{ id: Id; number: number; revision: number; origin: 'MANUAL' | 'GENERATED' }> {
    return this.database.sqlite
      .prepare(
        'SELECT id,number,revision,story_origin as origin FROM chapters WHERE project_id=? ORDER BY number',
      )
      .all(projectId) as Array<{
      id: Id;
      number: number;
      revision: number;
      origin: 'MANUAL' | 'GENERATED';
    }>;
  }
  get(id: Id): ChapterDto | null {
    return (
      (this.database.sqlite
        .prepare(
          `SELECT c.id,c.project_id as projectId,c.number,c.title,c.content,c.revision,
            c.story_origin as origin,c.story_plan_item_id as storyPlanItemId,
            c.story_generation_id as storyGenerationId,c.continuity_status as continuityStatus,
            c.continuity_check_status as continuityCheckStatus,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM story_summary_revisions s
                WHERE s.chapter_id=c.id AND s.is_current=1 AND s.status='CURRENT'
              ) THEN 'CURRENT'
              WHEN EXISTS (SELECT 1 FROM story_summary_revisions s WHERE s.chapter_id=c.id)
                THEN 'STALE'
              ELSE 'MISSING'
            END as summaryStatus,
            COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='MERGE_AUDIO' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as audioStatus,
            COALESCE((SELECT ws.status FROM workflow_steps ws WHERE ws.type='SUBTITLE' AND ws.entity_id=c.id ORDER BY ws.updated_at DESC LIMIT 1),'PENDING') as subtitleStatus,
            c.created_at as createdAt,c.updated_at as updatedAt
           FROM chapters c WHERE c.id=?`,
        )
        .get(id) as ChapterDto | undefined) ?? null
    );
  }
  getByPlanItem(projectId: Id, planItemId: string): ChapterDto | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId, planItemId) as { id: Id } | undefined;
    return row ? this.get(row.id) : null;
  }
  create(projectId: Id, input: ChapterInput): ChapterDto {
    const max = this.database.sqlite
      .prepare('SELECT COALESCE(MAX(number),0)+1 as next FROM chapters WHERE project_id=?')
      .get(projectId) as { next: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO chapters (id,project_id,number,title,content,story_origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(id, projectId, max.next, input.title, input.content, 'MANUAL', stamp, stamp);
    return this.get(id)!;
  }
  createGenerated(
    projectId: Id,
    input: ChapterInput,
    storyPlanItemId: string,
    storyGenerationId: Id,
  ): ChapterDto {
    const max = this.database.sqlite
      .prepare('SELECT COALESCE(MAX(number),0)+1 as next FROM chapters WHERE project_id=?')
      .get(projectId) as { next: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO chapters (id,project_id,number,title,content,story_origin,story_plan_item_id,story_generation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        projectId,
        max.next,
        input.title,
        input.content,
        'GENERATED',
        storyPlanItemId,
        storyGenerationId,
        stamp,
        stamp,
      );
    return this.get(id)!;
  }
  update(id: Id, input: ChapterInput): ChapterDto {
    const current = this.get(id);
    if (!current) throw new Error('Chapter not found');
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision)
      throw new Error('Revision conflict');
    const changed = input.title !== current.title || input.content !== current.content;
    const stamp = now();
    this.database.sqlite
      .prepare(
        "UPDATE chapters SET title=?, content=?, story_origin=CASE WHEN ? THEN 'MANUAL' ELSE story_origin END, story_generation_id=CASE WHEN ? THEN NULL ELSE story_generation_id END, source_state_revision=CASE WHEN ? THEN NULL ELSE source_state_revision END, revision=revision+?, row_version=row_version+1, updated_at=? WHERE id=?",
      )
      .run(
        input.title,
        input.content,
        changed ? 1 : 0,
        changed ? 1 : 0,
        changed ? 1 : 0,
        changed ? 1 : 0,
        stamp,
        id,
      );
    return this.get(id)!;
  }
  delete(id: Id): void {
    this.database.sqlite.prepare('DELETE FROM chapters WHERE id=?').run(id);
  }
  reorder(projectId: Id, ids: Id[]): ChapterDto[] {
    const current = this.list(projectId);
    const expected = new Set(current.map((item) => item.id));
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !expected.has(id))
    )
      throw new Error('Complete chapter ordering is required');
    const tx = this.database.sqlite.transaction(() => {
      for (let index = 0; index < ids.length; index += 1)
        this.database.sqlite
          .prepare('UPDATE chapters SET number=? WHERE id=?')
          .run(1000000 + index, ids[index]);
      for (let index = 0; index < ids.length; index += 1)
        this.database.sqlite
          .prepare('UPDATE chapters SET number=?, updated_at=? WHERE id=?')
          .run(index + 1, now(), ids[index]);
    });
    tx();
    return this.list(projectId);
  }
}

export class HeartbeatRepository {
  constructor(private readonly database: DatabaseHandle) {}
  beat(workerId: string, status = 'READY'): void {
    this.database.sqlite
      .prepare(
        'INSERT INTO worker_heartbeats(worker_id,last_seen_at,status,version) VALUES(?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,status=excluded.status',
      )
      .run(workerId, now(), status, '0.1.0');
  }
  isHealthy(maxAgeMs = 10_000): boolean {
    const row = this.database.sqlite
      .prepare('SELECT last_seen_at FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1')
      .get() as { last_seen_at: string } | undefined;
    return Boolean(row && Date.now() - Date.parse(row.last_seen_at) <= maxAgeMs);
  }
}

export type StepRow = {
  id: Id;
  execution_id: Id;
  step_key: string;
  type: string;
  entity_id: Id;
  status: WorkflowStatus;
  input_fingerprint: string;
  payload: string;
  progress: number;
  progress_message: string;
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  current_attempt_id: Id | null;
  error: string | null;
};
export type ClaimedStep = StepRow & { attemptId: Id; attemptNumber: number };

export class WorkflowRepository {
  constructor(private readonly database: DatabaseHandle) {}
  createExecution(projectId: Id, type: string): Id {
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO workflow_executions(id,project_id,type,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(id, projectId, type, 'PENDING', stamp, stamp);
    return id;
  }
  createStep(
    executionId: Id,
    stepKey: string,
    type: string,
    entityId: string,
    fingerprint: string,
    maxAttempts = 3,
    payload: unknown = {},
  ): Id {
    const id = randomUUID();
    const stamp = now();
    const hasPayloadColumn = (
      this.database.sqlite.prepare('PRAGMA table_info(workflow_steps)').all() as Array<{
        name: string;
      }>
    ).some((column) => column.name === 'payload');
    if (hasPayloadColumn) {
      this.database.sqlite
        .prepare(
          'INSERT INTO workflow_steps(id,execution_id,step_key,type,entity_id,status,input_fingerprint,payload,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          executionId,
          stepKey,
          type,
          entityId,
          'PENDING',
          fingerprint,
          json(payload),
          maxAttempts,
          stamp,
          stamp,
        );
    } else {
      this.database.sqlite
        .prepare(
          'INSERT INTO workflow_steps(id,execution_id,step_key,type,entity_id,status,input_fingerprint,max_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          executionId,
          stepKey,
          type,
          entityId,
          'PENDING',
          fingerprint,
          maxAttempts,
          stamp,
          stamp,
        );
    }
    return id;
  }
  updateRunningStepFingerprint(step: ClaimedStep, fingerprint: string): void {
    const result = this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET input_fingerprint=?,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
      )
      .run(fingerprint, now(), step.id, step.attemptId, step.lease_owner);
    if (result.changes !== 1)
      throw new AppError('STALE_INPUT', 'Story workflow step is no longer current', 409);
  }
  assertRunningStepFingerprint(stepId: Id, fingerprint: string): void {
    const current = this.database.sqlite
      .prepare(
        "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND input_fingerprint=?",
      )
      .get(stepId, fingerprint);
    if (!current)
      throw new AppError('STALE_INPUT', 'Story workflow step input is no longer current', 409);
  }
  dependentStepIds(stepId: Id): Id[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT step_id as stepId FROM workflow_step_dependencies WHERE depends_on_step_id=?',
      )
      .all(stepId) as Array<{ stepId: Id }>;
    return rows.map((row) => row.stepId);
  }
  dependency(stepId: Id, dependsOnStepId: Id): void {
    if (stepId === dependsOnStepId)
      throw new AppError('WORKFLOW_CYCLE', 'A step cannot depend on itself');
    const pending = [dependsOnStepId];
    const visited = new Set<Id>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === stepId)
        throw new AppError('WORKFLOW_CYCLE', 'Workflow dependency cycle detected');
      if (visited.has(current)) continue;
      visited.add(current);
      const rows = this.database.sqlite
        .prepare(
          'SELECT depends_on_step_id as dependencyId FROM workflow_step_dependencies WHERE step_id=?',
        )
        .all(current) as Array<{ dependencyId: Id }>;
      pending.push(...rows.map((row) => row.dependencyId));
    }
    this.database.sqlite
      .prepare(
        'INSERT OR IGNORE INTO workflow_step_dependencies(step_id,depends_on_step_id) VALUES(?,?)',
      )
      .run(stepId, dependsOnStepId);
  }
  createJob(type: string, entityId: string, stepId: Id): Id {
    const id = randomUUID();
    this.database.sqlite
      .prepare('INSERT INTO jobs(id,type,entity_id,step_id,created_at) VALUES(?,?,?,?,?)')
      .run(id, type, entityId, stepId, now());
    return id;
  }
  getStep(id: Id): StepRow | null {
    return this.database.sqlite
      .prepare('SELECT * FROM workflow_steps WHERE id=?')
      .get(id) as StepRow | null;
  }
  claim(workerId: string, leaseMs = 30_000): ClaimedStep | null {
    const candidate = this.database.sqlite
      .prepare(
        "SELECT ws.* FROM workflow_steps ws WHERE ws.status='PENDING' AND ws.cancellation_requested_at IS NULL AND (ws.next_attempt_at IS NULL OR ws.next_attempt_at<=?) AND NOT EXISTS (SELECT 1 FROM workflow_step_dependencies d JOIN workflow_steps dep ON dep.id=d.depends_on_step_id WHERE d.step_id=ws.id AND d.required=1 AND dep.status!='COMPLETED') ORDER BY ws.created_at LIMIT 1",
      )
      .get(now()) as StepRow | undefined;
    if (!candidate) return null;
    const attemptId = randomUUID();
    const attemptNumber = candidate.attempts + 1;
    const stamp = now();
    const expiry = new Date(Date.now() + leaseMs).toISOString();
    const tx = this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='RUNNING',lease_owner=?,lease_expires_at=?,current_attempt_id=?,attempts=?,updated_at=? WHERE id=? AND status='PENDING'",
        )
        .run(workerId, expiry, attemptId, attemptNumber, stamp, candidate.id);
      if (result.changes !== 1) return false;
      this.database.sqlite
        .prepare(
          'INSERT INTO workflow_step_attempts(id,step_id,attempt_number,worker_id,status,started_at,heartbeat_at) VALUES(?,?,?,?,?,?,?)',
        )
        .run(attemptId, candidate.id, attemptNumber, workerId, 'RUNNING', stamp, stamp);
      this.database.sqlite
        .prepare("UPDATE jobs SET status='RUNNING',attempts=?,started_at=? WHERE step_id=?")
        .run(attemptNumber, stamp, candidate.id);
      return true;
    });
    return tx()
      ? {
          ...candidate,
          status: 'RUNNING',
          lease_owner: workerId,
          lease_expires_at: expiry,
          current_attempt_id: attemptId,
          attempts: attemptNumber,
          attemptId,
          attemptNumber,
        }
      : null;
  }
  progress(step: ClaimedStep, value: number, message: string): void {
    const result = this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET progress=?,progress_message=?,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
      )
      .run(
        Math.max(0, Math.min(1, value)),
        safeError(message),
        now(),
        step.id,
        step.attemptId,
        step.lease_owner,
      );
    if (result.changes === 1)
      this.database.sqlite
        .prepare('UPDATE jobs SET progress=? WHERE step_id=?')
        .run(value, step.id);
  }
  heartbeat(step: ClaimedStep, leaseMs = 30_000): boolean {
    const expiry = new Date(Date.now() + leaseMs).toISOString();
    const result = this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET lease_expires_at=?,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
      )
      .run(expiry, now(), step.id, step.attemptId, step.lease_owner);
    if (result.changes === 1)
      this.database.sqlite
        .prepare("UPDATE workflow_step_attempts SET heartbeat_at=? WHERE id=? AND status='RUNNING'")
        .run(now(), step.attemptId);
    return result.changes === 1;
  }
  complete(step: ClaimedStep): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='COMPLETED',progress=1,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
        )
        .run(stamp, step.id, step.attemptId, step.lease_owner);
      if (result.changes !== 1) return;
      this.database.sqlite
        .prepare(
          "UPDATE workflow_step_attempts SET status='COMPLETED',finished_at=? WHERE id=? AND status='RUNNING'",
        )
        .run(stamp, step.attemptId);
      this.database.sqlite
        .prepare(
          "UPDATE jobs SET status='COMPLETED',progress=1,completed_at=? WHERE step_id=? AND status='RUNNING'",
        )
        .run(stamp, step.id);
    })();
  }
  fail(step: ClaimedStep, error: string, retry = true): void {
    const stamp = now();
    const safe = safeError(error);
    const next =
      retry && step.attemptNumber < step.max_attempts
        ? new Date(Date.now() + 1000).toISOString()
        : null;
    const status = next ? 'PENDING' : 'FAILED';
    this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          'UPDATE workflow_steps SET status=?,error=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND current_attempt_id=? AND lease_owner=?',
        )
        .run(status, safe, next, stamp, step.id, step.attemptId, step.lease_owner);
      if (result.changes !== 1) return;
      this.database.sqlite
        .prepare('UPDATE workflow_step_attempts SET status=?,error=?,finished_at=? WHERE id=?')
        .run(status, safe, stamp, step.attemptId);
      this.database.sqlite
        .prepare("UPDATE jobs SET status=?,error=? WHERE step_id=? AND status='RUNNING'")
        .run(status, safe, step.id);
    })();
  }
  invalidateSteps(entityId: Id, types: string[], error = 'StaleInput'): number {
    if (!types.length) return 0;
    const placeholders = types.map(() => '?').join(',');
    const stamp = now();
    return this.database.sqlite.transaction(() => {
      const steps = this.database.sqlite
        .prepare(
          `SELECT id,current_attempt_id FROM workflow_steps WHERE entity_id=? AND type IN (${placeholders}) AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
        )
        .all(entityId, ...types) as Array<{ id: Id; current_attempt_id: Id | null }>;
      for (const step of steps) {
        this.database.sqlite
          .prepare(
            "UPDATE workflow_steps SET status='INVALIDATED',error=?,cancellation_requested_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
          )
          .run(error, stamp, stamp, step.id);
        if (step.current_attempt_id) {
          this.database.sqlite
            .prepare(
              "UPDATE workflow_step_attempts SET status='FAILED',error=?,finished_at=? WHERE id=? AND status='RUNNING'",
            )
            .run(error, stamp, step.current_attempt_id);
        }
        this.database.sqlite
          .prepare(
            "UPDATE jobs SET status='INVALIDATED',error=?,completed_at=NULL WHERE step_id=? AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')",
          )
          .run(error, step.id);
      }
      return steps.length;
    })();
  }
  invalidateEntities(entityIds: Id[], types: string[], error = 'StaleInput'): number {
    if (!entityIds.length || !types.length) return 0;
    const entities = entityIds.map(() => '?').join(',');
    const placeholders = types.map(() => '?').join(',');
    const stamp = now();
    return this.database.sqlite.transaction(() => {
      const steps = this.database.sqlite
        .prepare(
          `SELECT id,current_attempt_id FROM workflow_steps WHERE entity_id IN (${entities}) AND type IN (${placeholders}) AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
        )
        .all(...entityIds, ...types) as Array<{ id: Id; current_attempt_id: Id | null }>;
      for (const step of steps) {
        this.database.sqlite
          .prepare(
            "UPDATE workflow_steps SET status='INVALIDATED',error=?,cancellation_requested_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
          )
          .run(error, stamp, stamp, step.id);
        if (step.current_attempt_id) {
          this.database.sqlite
            .prepare(
              "UPDATE workflow_step_attempts SET status='FAILED',error=?,finished_at=? WHERE id=? AND status='RUNNING'",
            )
            .run(error, stamp, step.current_attempt_id);
        }
        this.database.sqlite
          .prepare(
            "UPDATE jobs SET status='INVALIDATED',error=?,completed_at=NULL WHERE step_id=? AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')",
          )
          .run(error, step.id);
      }
      return steps.length;
    })();
  }
  recoverExpired(): number {
    const expired = this.database.sqlite
      .prepare("SELECT * FROM workflow_steps WHERE status='RUNNING' AND lease_expires_at<?")
      .all(now()) as StepRow[];
    const tx = this.database.sqlite.transaction(() => {
      for (const step of expired) {
        const status = step.attempts < step.max_attempts ? 'PENDING' : 'FAILED';
        const stamp = now();
        this.database.sqlite
          .prepare(
            "UPDATE workflow_steps SET status=?,error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=?",
          )
          .run(status, 'WorkerLost', stamp, step.id, step.current_attempt_id);
        if (step.current_attempt_id)
          this.database.sqlite
            .prepare(
              "UPDATE workflow_step_attempts SET status='FAILED',error='WorkerLost',finished_at=? WHERE id=? AND status='RUNNING'",
            )
            .run(stamp, step.current_attempt_id);
        this.database.sqlite
          .prepare(
            "UPDATE jobs SET status=?,error=?,completed_at=NULL WHERE step_id=? AND status='RUNNING'",
          )
          .run(status, 'WorkerLost', step.id);
      }
    });
    tx();
    return expired.length;
  }
  requestCancel(stepId: Id): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET cancellation_requested_at=?,status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE status END,updated_at=? WHERE id=?",
        )
        .run(stamp, stamp, stepId);
      this.database.sqlite
        .prepare(
          "UPDATE jobs SET status='CANCELLED',error='Cancelled by user' WHERE step_id=? AND status='PENDING'",
        )
        .run(stepId);
    })();
  }
  isCancellationRequested(stepId: Id): boolean {
    const row = this.database.sqlite
      .prepare('SELECT cancellation_requested_at as requestedAt FROM workflow_steps WHERE id=?')
      .get(stepId) as { requestedAt: string | null } | undefined;
    return Boolean(row?.requestedAt);
  }
  cancel(step: ClaimedStep, error = 'Cancelled by user'): boolean {
    const stamp = now();
    const safe = safeError(error);
    return this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='CANCELLED',error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
        )
        .run(safe, stamp, step.id, step.attemptId, step.lease_owner);
      if (result.changes !== 1) return false;
      this.database.sqlite
        .prepare(
          "UPDATE workflow_step_attempts SET status='CANCELLED',error=?,finished_at=? WHERE id=? AND status='RUNNING'",
        )
        .run(safe, stamp, step.attemptId);
      this.database.sqlite
        .prepare("UPDATE jobs SET status='CANCELLED',error=? WHERE step_id=? AND status='RUNNING'")
        .run(safe, step.id);
      return true;
    })();
  }
  getJob(id: Id): Record<string, unknown> | null {
    return this.database.sqlite
      .prepare(
        'SELECT id,type,entity_id as entityId,status,progress,error,attempts,created_at as createdAt,started_at as startedAt,completed_at as completedAt FROM jobs WHERE id=?',
      )
      .get(id) as Record<string, unknown> | null;
  }
  retryStep(stepId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET status='PENDING',error=NULL,next_attempt_at=NULL,cancellation_requested_at=NULL,updated_at=? WHERE id=? AND status IN ('FAILED','INVALIDATED','CANCELLED')",
      )
      .run(now(), stepId);
    this.database.sqlite
      .prepare("UPDATE jobs SET status='PENDING',error=NULL,completed_at=NULL WHERE step_id=?")
      .run(stepId);
  }
  markCompleted(stepId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET status='COMPLETED',progress=1,updated_at=? WHERE id=? AND status='PENDING'",
      )
      .run(now(), stepId);
  }
}

export type AssetRegistration = {
  id: Id;
  projectId: Id;
  type: string;
  role: string;
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  sourceEntityId?: Id;
  sourceStepId?: Id;
  inputFingerprint?: string;
  metadata?: unknown;
  validationError?: string;
};

export type AssetRecord = AssetRegistration & {
  status: 'READY' | 'INVALID';
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CurrentAsset = {
  id: Id;
  path: string;
  type: string;
  sha256: string;
  mediaType: string;
};
export type StepLeaseGuard = {
  stepId: Id;
  attemptId: Id;
  workerId: string;
  inputFingerprint: string;
};

export class AssetRepository {
  constructor(private readonly database: DatabaseHandle) {}
  private assertSafePath(path: string): void {
    if (
      !path ||
      path.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.split(/[\\/]/).includes('..')
    )
      throw new AppError('UNSAFE_PATH', 'Asset path must be workspace-relative', 400);
  }
  current(projectId: Id, role: string): CurrentAsset | null {
    return this.database.sqlite
      .prepare(
        "SELECT id,path,type,sha256,media_type as mediaType FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, role) as CurrentAsset | null;
  }
  registerReference(input: AssetRegistration): void {
    this.assertSafePath(input.path);
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,source_step_id,input_fingerprint,metadata,is_current,validation_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        input.id,
        input.projectId,
        input.type,
        input.role,
        input.validationError ? 'INVALID' : 'READY',
        input.path,
        input.mediaType,
        input.bytes,
        input.sha256,
        input.sourceEntityId ?? null,
        input.sourceStepId ?? null,
        input.inputFingerprint ?? null,
        json(input.metadata ?? {}),
        0,
        input.validationError ?? null,
        stamp,
        stamp,
      );
  }
  listCharacterReferences(projectId: Id, characterId: string): AssetRecord[] {
    return this.database.sqlite
      .prepare(
        `SELECT id,project_id as projectId,type,role,status,path,media_type as mediaType,bytes,sha256,
          source_entity_id as sourceEntityId,source_step_id as sourceStepId,input_fingerprint as inputFingerprint,
          metadata,is_current as isCurrent,validation_error as validationError,created_at as createdAt,updated_at as updatedAt
         FROM assets
         WHERE project_id=? AND type='CHARACTER_REFERENCE_IMAGE' AND json_extract(metadata,'$.characterId')=?
         ORDER BY created_at DESC`,
      )
      .all(projectId, characterId) as AssetRecord[];
  }
  setReferenceApproval(
    projectId: Id,
    assetId: Id,
    characterId: string,
    approval: string,
  ): AssetRecord {
    const asset = this.get(assetId);
    if (!asset || asset.projectId !== projectId)
      throw new AppError('NOT_FOUND', 'Asset not found', 404);
    if (asset.type !== 'CHARACTER_REFERENCE_IMAGE')
      throw new AppError('INVALID_INPUT', 'Asset is not a character reference', 400);
    const metadata = parseMetadata(asset.metadata);
    if (metadata.characterId !== characterId)
      throw new AppError('INVALID_INPUT', 'Reference belongs to a different character', 400);
    metadata.approval = approval;
    this.database.sqlite
      .prepare('UPDATE assets SET metadata=?,updated_at=? WHERE id=? AND project_id=?')
      .run(json(metadata), now(), assetId, projectId);
    return { ...asset, metadata: json(metadata), updatedAt: now() };
  }
  get(id: Id): AssetRecord | null {
    return this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,type,role,status,path,media_type as mediaType,bytes,sha256,source_entity_id as sourceEntityId,source_step_id as sourceStepId,input_fingerprint as inputFingerprint,metadata,is_current as isCurrent,validation_error as validationError,created_at as createdAt,updated_at as updatedAt FROM assets WHERE id=?',
      )
      .get(id) as AssetRecord | null;
  }
  register(input: AssetRegistration): void {
    this.assertSafePath(input.path);
    const stamp = now();
    const valid = !input.validationError;
    this.database.sqlite.transaction(() => {
      if (valid)
        this.database.sqlite
          .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
          .run(stamp, input.projectId, input.role);
      this.database.sqlite
        .prepare(
          'INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,source_step_id,input_fingerprint,metadata,is_current,validation_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          input.id,
          input.projectId,
          input.type,
          input.role,
          valid ? 'READY' : 'INVALID',
          input.path,
          input.mediaType,
          input.bytes,
          input.sha256,
          input.sourceEntityId ?? null,
          input.sourceStepId ?? null,
          input.inputFingerprint ?? null,
          json(input.metadata ?? {}),
          valid ? 1 : 0,
          input.validationError ?? null,
          stamp,
          stamp,
        );
    })();
  }
  registerIfCurrentStep(input: AssetRegistration, guard: StepLeaseGuard): boolean {
    this.assertSafePath(input.path);
    const stamp = now();
    return this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare(
          "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=? AND input_fingerprint=?",
        )
        .get(guard.stepId, guard.attemptId, guard.workerId, guard.inputFingerprint);
      if (!current) return false;
      this.database.sqlite
        .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
        .run(stamp, input.projectId, input.role);
      this.database.sqlite
        .prepare(
          'INSERT INTO assets(id,project_id,type,role,status,path,media_type,bytes,sha256,source_entity_id,source_step_id,input_fingerprint,metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          input.id,
          input.projectId,
          input.type,
          input.role,
          'READY',
          input.path,
          input.mediaType,
          input.bytes,
          input.sha256,
          input.sourceEntityId ?? null,
          input.sourceStepId ?? null,
          input.inputFingerprint ?? null,
          json(input.metadata ?? {}),
          1,
          stamp,
          stamp,
        );
      return true;
    })();
  }
  invalidateRole(projectId: Id, role: string): void {
    this.database.sqlite
      .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
      .run(now(), projectId, role);
  }
  invalidateSource(projectId: Id, sourceEntityId: Id, types: string[] = []): void {
    const condition = types.length ? ` AND type IN (${types.map(() => '?').join(',')})` : '';
    this.database.sqlite
      .prepare(
        `UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND source_entity_id=?${condition}`,
      )
      .run(now(), projectId, sourceEntityId, ...types);
  }
}
