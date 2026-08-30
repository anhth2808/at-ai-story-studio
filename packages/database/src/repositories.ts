import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from './db.js';
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
        'SELECT id, project_id as projectId, number, title, content, revision, created_at as createdAt, updated_at as updatedAt FROM chapters WHERE project_id=? ORDER BY number',
      )
      .all(projectId) as ChapterDto[];
  }
  get(id: Id): ChapterDto | null {
    return this.database.sqlite
      .prepare(
        'SELECT id, project_id as projectId, number, title, content, revision, created_at as createdAt, updated_at as updatedAt FROM chapters WHERE id=?',
      )
      .get(id) as ChapterDto | null;
  }
  create(projectId: Id, input: ChapterInput): ChapterDto {
    const max = this.database.sqlite
      .prepare('SELECT COALESCE(MAX(number),0)+1 as next FROM chapters WHERE project_id=?')
      .get(projectId) as { next: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT INTO chapters (id,project_id,number,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(id, projectId, max.next, input.title, input.content, stamp, stamp);
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
        'UPDATE chapters SET title=?, content=?, revision=revision+?, row_version=row_version+1, updated_at=? WHERE id=?',
      )
      .run(input.title, input.content, changed ? 1 : 0, stamp, id);
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
    entityId: Id,
    fingerprint: string,
    maxAttempts = 3,
  ): Id {
    const id = randomUUID();
    const stamp = now();
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
    return id;
  }
  dependency(stepId: Id, dependsOnStepId: Id): void {
    this.database.sqlite
      .prepare(
        'INSERT OR IGNORE INTO workflow_step_dependencies(step_id,depends_on_step_id) VALUES(?,?)',
      )
      .run(stepId, dependsOnStepId);
  }
  createJob(type: string, entityId: Id, stepId: Id): Id {
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
        "SELECT ws.* FROM workflow_steps ws WHERE ws.status='PENDING' AND (ws.next_attempt_at IS NULL OR ws.next_attempt_at<=?) AND NOT EXISTS (SELECT 1 FROM workflow_step_dependencies d JOIN workflow_steps dep ON dep.id=d.depends_on_step_id WHERE d.step_id=ws.id AND d.required=1 AND dep.status!='COMPLETED') ORDER BY ws.created_at LIMIT 1",
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
    this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET progress=?,progress_message=?,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
      )
      .run(
        Math.max(0, Math.min(1, value)),
        message,
        now(),
        step.id,
        step.attemptId,
        step.lease_owner,
      );
    this.database.sqlite.prepare('UPDATE jobs SET progress=? WHERE step_id=?').run(value, step.id);
  }
  complete(step: ClaimedStep): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='COMPLETED',progress=1,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='RUNNING' AND current_attempt_id=? AND lease_owner=?",
        )
        .run(stamp, step.id, step.attemptId, step.lease_owner);
      this.database.sqlite
        .prepare("UPDATE workflow_step_attempts SET status='COMPLETED',finished_at=? WHERE id=?")
        .run(stamp, step.attemptId);
      this.database.sqlite
        .prepare("UPDATE jobs SET status='COMPLETED',progress=1,completed_at=? WHERE step_id=?")
        .run(stamp, step.id);
    })();
  }
  fail(step: ClaimedStep, error: string, retry = true): void {
    const stamp = now();
    const next =
      retry && step.attemptNumber < step.max_attempts
        ? new Date(Date.now() + 1000).toISOString()
        : null;
    const status = next ? 'PENDING' : 'FAILED';
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'UPDATE workflow_steps SET status=?,error=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND current_attempt_id=? AND lease_owner=?',
        )
        .run(status, error, next, stamp, step.id, step.attemptId, step.lease_owner);
      this.database.sqlite
        .prepare('UPDATE workflow_step_attempts SET status=?,error=?,finished_at=? WHERE id=?')
        .run(status, error, stamp, step.attemptId);
      this.database.sqlite
        .prepare('UPDATE jobs SET status=?,error=? WHERE step_id=?')
        .run(status, error, step.id);
    })();
  }
  recoverExpired(): number {
    const expired = this.database.sqlite
      .prepare("SELECT * FROM workflow_steps WHERE status='RUNNING' AND lease_expires_at<?")
      .all(now()) as StepRow[];
    const tx = this.database.sqlite.transaction(() => {
      for (const step of expired) {
        const status = step.attempts < step.max_attempts ? 'PENDING' : 'FAILED';
        this.database.sqlite
          .prepare(
            'UPDATE workflow_steps SET status=?,error=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?',
          )
          .run(status, 'WorkerLost', now(), step.id);
        if (step.current_attempt_id)
          this.database.sqlite
            .prepare(
              "UPDATE workflow_step_attempts SET status='FAILED',error='WorkerLost',finished_at=? WHERE id=?",
            )
            .run(now(), step.current_attempt_id);
      }
    });
    tx();
    return expired.length;
  }
  requestCancel(stepId: Id): void {
    this.database.sqlite
      .prepare(
        "UPDATE workflow_steps SET cancellation_requested_at=?,status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE status END,updated_at=? WHERE id=?",
      )
      .run(now(), now(), stepId);
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

export class AssetRepository {
  constructor(private readonly database: DatabaseHandle) {}
  current(
    projectId: Id,
    role: string,
  ): { id: Id; path: string; type: string; sha256: string; mediaType: string } | null {
    return this.database.sqlite
      .prepare(
        "SELECT id,path,type,sha256,media_type as mediaType FROM assets WHERE project_id=? AND role=? AND is_current=1 AND status='READY' ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, role) as {
      id: Id;
      path: string;
      type: string;
      sha256: string;
      mediaType: string;
    } | null;
  }
  register(input: {
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
  }): void {
    const stamp = now();
    this.database.sqlite.transaction(() => {
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
    })();
  }
  invalidateRole(projectId: Id, role: string): void {
    this.database.sqlite
      .prepare('UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role=?')
      .run(now(), projectId, role);
  }
}
