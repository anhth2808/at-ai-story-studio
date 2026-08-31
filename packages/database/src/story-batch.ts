import { randomUUID } from 'node:crypto';
import {
  AppError,
  storyGenerationBatchItemSchema,
  storyGenerationBatchSchema,
  type Id,
  type StoryGenerationBatch,
  type StoryGenerationBatchItem,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
import { WorkflowRepository } from './repositories.js';

const now = (): string => new Date().toISOString();
const safe = (value: string | null | undefined, max = 2_000): string | null =>
  value ? value.slice(0, max) : null;

type BatchItemSeed = {
  chapterNumber: number;
  planItemId: string;
  workflowStepId: Id;
};

type BatchRow = {
  id: Id;
  projectId: Id;
  startChapter: number;
  endChapter: number;
  mode: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type BatchItemRow = {
  id: Id;
  batchId: Id;
  projectId: Id;
  chapterNumber: number;
  planItemId: string;
  workflowStepId: Id;
  outcome: string;
  inputFingerprint: string | null;
  error: string | null;
  skipReason: string | null;
  createdAt: string;
  updatedAt: string;
};

const batchDto = (row: BatchRow): StoryGenerationBatch =>
  storyGenerationBatchSchema.parse({ ...row });
const itemDto = (row: BatchItemRow): StoryGenerationBatchItem =>
  storyGenerationBatchItemSchema.parse({ ...row });

export class StoryBatchRepository {
  private readonly workflow: WorkflowRepository;

  constructor(private readonly database: DatabaseHandle) {
    this.workflow = new WorkflowRepository(database);
  }

  get(id: Id): StoryGenerationBatch | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,start_chapter as startChapter,end_chapter as endChapter,mode,status,total,completed,failed,skipped,error,created_at as createdAt,updated_at as updatedAt FROM story_generation_batches WHERE id=?',
      )
      .get(id) as BatchRow | undefined;
    return row ? batchDto(row) : null;
  }

  list(projectId: Id, limit = 20, offset = 0): StoryGenerationBatch[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,start_chapter as startChapter,end_chapter as endChapter,mode,status,total,completed,failed,skipped,error,created_at as createdAt,updated_at as updatedAt FROM story_generation_batches WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as BatchRow[];
    return rows.map(batchDto);
  }

  items(batchId: Id, limit = 200, offset = 0): StoryGenerationBatchItem[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,batch_id as batchId,project_id as projectId,chapter_number as chapterNumber,plan_item_id as planItemId,workflow_step_id as workflowStepId,outcome,input_fingerprint as inputFingerprint,error,skip_reason as skipReason,created_at as createdAt,updated_at as updatedAt FROM story_generation_batch_items WHERE batch_id=? ORDER BY chapter_number LIMIT ? OFFSET ?',
      )
      .all(batchId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as BatchItemRow[];
    return rows.map(itemDto);
  }

  itemForStep(workflowStepId: Id): StoryGenerationBatchItem | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,batch_id as batchId,project_id as projectId,chapter_number as chapterNumber,plan_item_id as planItemId,workflow_step_id as workflowStepId,outcome,input_fingerprint as inputFingerprint,error,skip_reason as skipReason,created_at as createdAt,updated_at as updatedAt FROM story_generation_batch_items WHERE workflow_step_id=?',
      )
      .get(workflowStepId) as BatchItemRow | undefined;
    return row ? itemDto(row) : null;
  }

  item(batchId: Id, chapterNumber: number): StoryGenerationBatchItem | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,batch_id as batchId,project_id as projectId,chapter_number as chapterNumber,plan_item_id as planItemId,workflow_step_id as workflowStepId,outcome,input_fingerprint as inputFingerprint,error,skip_reason as skipReason,created_at as createdAt,updated_at as updatedAt FROM story_generation_batch_items WHERE batch_id=? AND chapter_number=?',
      )
      .get(batchId, chapterNumber) as BatchItemRow | undefined;
    return row ? itemDto(row) : null;
  }

  activeChapter(projectId: Id, chapterNumber: number): StoryGenerationBatchItem | null {
    const row = this.database.sqlite
      .prepare(
        "SELECT id,batch_id as batchId,project_id as projectId,chapter_number as chapterNumber,plan_item_id as planItemId,workflow_step_id as workflowStepId,outcome,input_fingerprint as inputFingerprint,error,skip_reason as skipReason,created_at as createdAt,updated_at as updatedAt FROM story_generation_batch_items WHERE project_id=? AND chapter_number=? AND outcome IN ('PENDING','RUNNING') ORDER BY created_at DESC LIMIT 1",
      )
      .get(projectId, chapterNumber) as BatchItemRow | undefined;
    return row ? itemDto(row) : null;
  }

  hasActiveRange(projectId: Id, startChapter: number, endChapter: number): boolean {
    const row = this.database.sqlite
      .prepare(
        "SELECT 1 FROM story_generation_batches WHERE project_id=? AND status IN ('PENDING','RUNNING','PAUSED') AND start_chapter<=? AND end_chapter>=? LIMIT 1",
      )
      .get(projectId, endChapter, startChapter);
    return Boolean(row);
  }

  create(input: {
    projectId: Id;
    startChapter: number;
    endChapter: number;
    mode: string;
    items: BatchItemSeed[];
  }): StoryGenerationBatch {
    if (
      input.startChapter > input.endChapter ||
      input.items.length !== input.endChapter - input.startChapter + 1
    )
      throw new AppError('INVALID_BATCH', 'Batch range and items must be contiguous', 400);
    const chapterNumbers = new Set(input.items.map((item) => item.chapterNumber));
    if (chapterNumbers.size !== input.items.length)
      throw new AppError('INVALID_BATCH', 'Batch chapter numbers must be unique', 400);
    for (
      let chapterNumber = input.startChapter;
      chapterNumber <= input.endChapter;
      chapterNumber += 1
    )
      if (!chapterNumbers.has(chapterNumber))
        throw new AppError(
          'INVALID_BATCH',
          'Batch chapter numbers must cover the requested range',
          400,
        );
    if (this.hasActiveRange(input.projectId, input.startChapter, input.endChapter))
      throw new AppError('BATCH_CONFLICT', 'An active batch overlaps this chapter range', 409);
    const activeChapter = input.items.find((item) =>
      this.activeChapter(input.projectId, item.chapterNumber),
    );
    if (activeChapter)
      throw new AppError(
        'BATCH_CONFLICT',
        `Chapter ${activeChapter.chapterNumber} already has active work`,
        409,
      );
    const id = randomUUID();
    const stamp = now();
    try {
      this.database.sqlite.transaction(() => {
        this.database.sqlite
          .prepare(
            'INSERT INTO story_generation_batches(id,project_id,start_chapter,end_chapter,mode,status,total,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            input.projectId,
            input.startChapter,
            input.endChapter,
            input.mode,
            'PENDING',
            input.items.length,
            stamp,
            stamp,
          );
        const insert = this.database.sqlite.prepare(
          'INSERT INTO story_generation_batch_items(id,batch_id,project_id,chapter_number,plan_item_id,workflow_step_id,outcome,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        );
        for (const item of input.items)
          insert.run(
            randomUUID(),
            id,
            input.projectId,
            item.chapterNumber,
            item.planItemId,
            item.workflowStepId,
            'PENDING',
            stamp,
            stamp,
          );
      })();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('story_generation_batch_active_chapter_idx')
      )
        throw new AppError('BATCH_CONFLICT', 'A chapter already has active batch work', 409);
      throw error;
    }
    return this.get(id)!;
  }

  setInputFingerprint(workflowStepId: Id, fingerprint: string): void {
    this.database.sqlite
      .prepare(
        'UPDATE story_generation_batch_items SET input_fingerprint=?,updated_at=? WHERE workflow_step_id=?',
      )
      .run(fingerprint, now(), workflowStepId);
  }
  markRunning(workflowStepId: Id): StoryGenerationBatchItem | null {
    const item = this.itemForStep(workflowStepId);
    if (!item || item.outcome !== 'PENDING') return item;
    this.database.sqlite
      .prepare(
        "UPDATE story_generation_batch_items SET outcome='RUNNING',updated_at=? WHERE workflow_step_id=? AND outcome='PENDING'",
      )
      .run(now(), workflowStepId);
    this.reconcile(item.batchId);
    return this.itemForStep(workflowStepId);
  }

  setOutcome(
    workflowStepId: Id,
    outcome: StoryGenerationBatchItem['outcome'],
    error: string | null = null,
    skipReason: string | null = null,
  ): StoryGenerationBatchItem | null {
    const item = this.itemForStep(workflowStepId);
    if (!item) return null;
    if (item.outcome === 'COMPLETED' || item.outcome === 'SKIPPED' || item.outcome === 'CANCELLED')
      return item;
    this.database.sqlite
      .prepare(
        'UPDATE story_generation_batch_items SET outcome=?,error=?,skip_reason=?,updated_at=? WHERE workflow_step_id=?',
      )
      .run(outcome, safe(error), safe(skipReason, 500), now(), workflowStepId);
    this.reconcile(item.batchId);
    return this.itemForStep(workflowStepId);
  }

  reconcile(batchId: Id): StoryGenerationBatch | null {
    const batch = this.get(batchId);
    if (!batch) return null;
    const counts = this.database.sqlite
      .prepare(
        "SELECT SUM(CASE WHEN outcome='COMPLETED' THEN 1 ELSE 0 END) as completed,SUM(CASE WHEN outcome='FAILED' THEN 1 ELSE 0 END) as failed,SUM(CASE WHEN outcome='SKIPPED' THEN 1 ELSE 0 END) as skipped,SUM(CASE WHEN outcome='RUNNING' THEN 1 ELSE 0 END) as running,SUM(CASE WHEN outcome IN ('PENDING','RUNNING') THEN 1 ELSE 0 END) as active,MAX(CASE WHEN outcome='FAILED' THEN error ELSE NULL END) as error FROM story_generation_batch_items WHERE batch_id=?",
      )
      .get(batchId) as {
      completed: number | null;
      failed: number | null;
      skipped: number | null;
      running: number | null;
      active: number | null;
      error: string | null;
    };
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    const skipped = counts.skipped ?? 0;
    const running = counts.running ?? 0;
    const active = counts.active ?? 0;
    const status =
      batch.status === 'CANCELLED'
        ? 'CANCELLED'
        : failed > 0 || (batch.status === 'PAUSED' && active > 0)
          ? 'PAUSED'
          : active === 0
            ? 'COMPLETED'
            : running > 0 || completed + skipped > 0
              ? 'RUNNING'
              : 'PENDING';
    this.database.sqlite
      .prepare(
        'UPDATE story_generation_batches SET status=?,completed=?,failed=?,skipped=?,error=?,updated_at=? WHERE id=?',
      )
      .run(status, completed, failed, skipped, safe(counts.error), now(), batchId);
    return this.get(batchId);
  }

  retry(batchId: Id, chapterNumber: number): StoryGenerationBatchItem {
    const item = this.item(batchId, chapterNumber);
    if (!item) throw new AppError('NOT_FOUND', 'Batch item not found', 404);
    if (item.outcome !== 'FAILED')
      throw new AppError('INVALID_BATCH_ITEM', 'Only a failed chapter can be retried', 409);
    this.workflow.retryStep(item.workflowStepId);
    this.database.sqlite
      .prepare(
        "UPDATE story_generation_batch_items SET outcome='PENDING',error=NULL,skip_reason=NULL,updated_at=? WHERE id=?",
      )
      .run(now(), item.id);
    this.database.sqlite
      .prepare(
        "UPDATE story_generation_batches SET status='RUNNING',error=NULL,updated_at=? WHERE id=?",
      )
      .run(now(), batchId);
    return this.item(batchId, chapterNumber)!;
  }

  skip(batchId: Id, chapterNumber: number, reason: string): StoryGenerationBatchItem {
    const item = this.item(batchId, chapterNumber);
    if (!item) throw new AppError('NOT_FOUND', 'Batch item not found', 404);
    if (item.outcome !== 'FAILED')
      throw new AppError('INVALID_BATCH_ITEM', 'Only a failed chapter can be skipped', 409);
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batch_items SET outcome='SKIPPED',skip_reason=?,updated_at=? WHERE id=?",
        )
        .run(safe(reason, 500), stamp, item.id);
      this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='CANCELLED',error=?,cancellation_requested_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('FAILED','PENDING')",
        )
        .run(safe(reason, 500), stamp, stamp, item.workflowStepId);
      const next = this.database.sqlite
        .prepare(
          'SELECT workflow_step_id as workflowStepId FROM story_generation_batch_items WHERE batch_id=? AND chapter_number=?',
        )
        .get(batchId, chapterNumber + 1) as { workflowStepId: Id } | undefined;
      if (next)
        this.database.sqlite
          .prepare(
            'UPDATE workflow_step_dependencies SET required=0 WHERE step_id=? AND depends_on_step_id=?',
          )
          .run(next.workflowStepId, item.workflowStepId);
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batches SET status='RUNNING',error=NULL,updated_at=? WHERE id=? AND status='PAUSED'",
        )
        .run(stamp, batchId);
    })();
    this.reconcile(batchId);
    const updated = this.item(batchId, chapterNumber);
    if (!updated) throw new AppError('NOT_FOUND', 'Batch item disappeared', 500);
    return updated;
  }

  cancel(batchId: Id): StoryGenerationBatch {
    const batch = this.get(batchId);
    if (!batch) throw new AppError('NOT_FOUND', 'Batch not found', 404);
    if (batch.status === 'COMPLETED' || batch.status === 'CANCELLED') return batch;
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batches SET status='CANCELLED',error='Cancelled by user',updated_at=? WHERE id=?",
        )
        .run(stamp, batchId);
      const running = this.database.sqlite
        .prepare(
          "SELECT workflow_step_id as workflowStepId FROM story_generation_batch_items WHERE batch_id=? AND outcome='RUNNING'",
        )
        .all(batchId) as Array<{ workflowStepId: Id }>;
      for (const item of running)
        this.database.sqlite
          .prepare(
            "UPDATE workflow_steps SET cancellation_requested_at=?,updated_at=? WHERE id=? AND status='RUNNING'",
          )
          .run(stamp, stamp, item.workflowStepId);
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batch_items SET outcome='CANCELLED',error='Cancelled by user',updated_at=? WHERE batch_id=? AND outcome='PENDING'",
        )
        .run(stamp, batchId);
      this.database.sqlite
        .prepare(
          "UPDATE workflow_steps SET status='CANCELLED',error='Cancelled by user',updated_at=? WHERE id IN (SELECT workflow_step_id FROM story_generation_batch_items WHERE batch_id=? AND outcome='CANCELLED') AND status='PENDING'",
        )
        .run(stamp, batchId);
    })();
    return this.get(batchId)!;
  }

  reconcileWorkflowStep(workflowStepId: Id): StoryGenerationBatch | null {
    const item = this.itemForStep(workflowStepId);
    if (!item) return null;
    const step = this.workflow.getStep(workflowStepId);
    if (!step) return null;
    if (step.status === 'COMPLETED') this.setOutcome(workflowStepId, 'COMPLETED');
    else if (step.status === 'FAILED') this.setOutcome(workflowStepId, 'FAILED', step.error);
    else if (step.status === 'CANCELLED') this.setOutcome(workflowStepId, 'CANCELLED', step.error);
    else if (step.status === 'PENDING' && item.outcome === 'RUNNING')
      this.setOutcome(workflowStepId, 'PENDING');
    return this.get(item.batchId);
  }

  reconcileRecoveredSteps(): number {
    const rows = this.database.sqlite
      .prepare(
        `SELECT bi.workflow_step_id as workflowStepId
         FROM story_generation_batch_items bi
         JOIN workflow_steps s ON s.id=bi.workflow_step_id
         WHERE (bi.outcome='RUNNING' AND s.status='PENDING')
            OR (bi.outcome IN ('PENDING','RUNNING') AND s.status IN ('COMPLETED','FAILED','CANCELLED'))`,
      )
      .all() as Array<{ workflowStepId: Id }>;
    for (const row of rows) this.reconcileWorkflowStep(row.workflowStepId);
    return rows.length;
  }
}
