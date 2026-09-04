import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  productionStageOrder,
  WorkflowRepository,
} from '@studio/database';
import type { DatabaseHandle } from '@studio/database';
import type { FfmpegTools } from '@studio/media';
import type { Id, ProductionStageKey } from '@studio/shared';
import { ProductionOrchestrator, type ProductionOrchestratorAdapters } from './index.js';
import type { ProductionPlanningContext } from './production-planning.js';
const projectId = '11111111-1111-4111-8111-111111111111';

function setup(): DatabaseHandle {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const stamp = '2026-01-01T00:00:00.000Z';
  database.sqlite
    .prepare(
      'INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES(?,?,?,?,?,?)',
    )
    .run(projectId, 'Orchestrator test', 'vi-VN', '{}', stamp, stamp);
  for (let number = 1; number <= 3; number += 1) {
    database.sqlite
      .prepare(
        'INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        projectId,
        number,
        `Chapter ${number}`,
        `Text ${number}`,
        'ACTIVE',
        1,
        1,
        stamp,
        stamp,
      );
  }
  return database;
}

function context(
  database: DatabaseHandle,
  healthCalls: { count: number },
): ProductionPlanningContext {
  return {
    database,
    workspace: {
      root: tmpdir(),
      database: join(tmpdir(), 'studio.db'),
      projects: tmpdir(),
      staging: tmpdir(),
    },
    media: {
      health: async () => {
        healthCalls.count += 1;
        return { ffmpeg: true, ffprobe: true, message: 'ready' };
      },
    } as unknown as FfmpegTools,
  };
}

function adapters(
  database: DatabaseHandle,
  scheduled: ProductionStageKey[],
): ProductionOrchestratorAdapters {
  const workflow = new WorkflowRepository(database);
  return Object.fromEntries(
    productionStageOrder.map((key) => [
      key,
      {
        inspect: () => ({ decision: 'BUILD' as const, message: `Build ${key}` }),
        schedule: (run: { projectId: Id }, _stage: { id: Id }, limit: number) => {
          scheduled.push(key);
          const executionId = workflow.createExecution(run.projectId, `TEST_${key}`);
          const stepId = workflow.createStep(
            executionId,
            `test:${key}:${scheduled.length}`,
            `TEST_${key}`,
            run.projectId,
            `test:${key}:${scheduled.length}`,
          );
          workflow.createJob(`TEST_${key}`, run.projectId, stepId);
          return [
            {
              stepId,
              unitKey: `${key}:0`,
              entityId: run.projectId,
              classification: 'BUILD' as const,
              inputFingerprint: `test:${key}`,
              summary: { limit },
            },
          ];
        },
      },
    ]),
  ) as ProductionOrchestratorAdapters;
}

function completeLinkedStep(database: DatabaseHandle, runId: Id, key: ProductionStageKey): void {
  const row = database.sqlite
    .prepare(
      `SELECT sw.workflow_step_id as stepId FROM production_stage_work sw
       JOIN production_stages ps ON ps.id=sw.stage_id
       WHERE ps.run_id=? AND ps.stage_key=? LIMIT 1`,
    )
    .get(runId, key) as { stepId: Id } | undefined;
  if (!row) throw new Error(`Missing linked ${key} step`);
  new WorkflowRepository(database).markCompleted(row.stepId);
}

describe('production orchestrator', () => {
  it('deduplicates active coordinator steps and advances monotonically', () => {
    const database = setup();
    const healthCalls = { count: 0 };
    const orchestrator = new ProductionOrchestrator(context(database, healthCalls));
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.runs.setReady(run.id);
    orchestrator.runs.start(run.id);
    const first = orchestrator.requestAdvance(run.id);
    const duplicate = orchestrator.requestAdvance(run.id);
    expect(duplicate).toEqual({ ...first, reused: true });
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) as count FROM workflow_steps WHERE type='ADVANCE_PRODUCTION_RUN' AND status='PENDING'",
        )
        .get(),
    ).toEqual({ count: 1 });
    new WorkflowRepository(database).markCompleted(first.stepId);
    const second = orchestrator.requestAdvance(run.id, 'RECOVERY');
    expect(second.stepId).not.toBe(first.stepId);
    expect(
      database.sqlite
        .prepare('SELECT MAX(coordinator_sequence) as sequence FROM production_runs WHERE id=?')
        .get(run.id),
    ).toEqual({ sequence: 2 });
    expect(healthCalls.count).toBe(0);
    database.sqlite.close();
  });

  it('schedules one bounded stage in declared order and reuses settled work', async () => {
    const database = setup();
    const scheduled: ProductionStageKey[] = [];
    const orchestrator = new ProductionOrchestrator(
      context(database, { count: 0 }),
      adapters(database, scheduled),
      undefined,
      { coordinatorBatchSize: 1, maxActiveUnits: 1 },
    );
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.runs.setReady(run.id);
    orchestrator.runs.start(run.id);
    await orchestrator.advanceProductionRun(run.id);
    expect(scheduled).toEqual(['STORY']);
    expect(orchestrator.status(run.id).stages[0]!.status).toBe('RUNNING');
    await orchestrator.advanceProductionRun(run.id);
    expect(scheduled).toEqual(['STORY']);
    completeLinkedStep(database, run.id, 'STORY');
    await orchestrator.advanceProductionRun(run.id);
    expect(scheduled).toEqual(['STORY', 'CHAPTERS']);
    expect(orchestrator.status(run.id).stages[0]!.status).toBe('COMPLETED');
    expect(orchestrator.status(run.id).stages[0]!.completedAt).toEqual(expect.any(String));
    database.sqlite.close();
  });

  it('pauses before scheduling, resumes the same run, and cancels linked work', async () => {
    const database = setup();
    const scheduled: ProductionStageKey[] = [];
    const orchestrator = new ProductionOrchestrator(
      context(database, { count: 0 }),
      adapters(database, scheduled),
    );
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.runs.setReady(run.id);
    orchestrator.runs.start(run.id);
    await orchestrator.advanceProductionRun(run.id);
    orchestrator.pauseRun(run.id);
    await orchestrator.advanceProductionRun(run.id);
    expect(scheduled).toEqual(['STORY']);
    orchestrator.resumeRun(run.id);
    expect(orchestrator.status(run.id).run.id).toBe(run.id);
    orchestrator.cancelRun(run.id);
    expect(orchestrator.status(run.id).run.status).toBe('CANCELLED');
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) as count FROM workflow_steps WHERE status='CANCELLED'")
        .get(),
    ).toEqual({ count: 2 });
    database.sqlite.close();
  });

  it('recovers an expired coordinator lease without duplicating it', async () => {
    const database = setup();
    const orchestrator = new ProductionOrchestrator(
      context(database, { count: 0 }),
      adapters(database, []),
    );
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.runs.setReady(run.id);
    orchestrator.runs.start(run.id);
    const request = orchestrator.requestAdvance(run.id);
    const claimed = new WorkflowRepository(database).claim('worker-one', 1);
    expect(claimed?.id).toBe(request.stepId);
    database.sqlite
      .prepare("UPDATE workflow_steps SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .run(request.stepId);
    expect(new WorkflowRepository(database).recoverExpired()).toBe(1);
    await orchestrator.reconcileActiveRuns();
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) as count FROM workflow_steps WHERE type='ADVANCE_PRODUCTION_RUN' AND status='PENDING'",
        )
        .get(),
    ).toEqual({ count: 1 });
    database.sqlite.close();
  });

  it('retries one failed unit and records bounded retry state', async () => {
    const database = setup();
    const orchestrator = new ProductionOrchestrator(
      context(database, { count: 0 }),
      adapters(database, []),
      undefined,
      { coordinatorBatchSize: 1, maxActiveUnits: 1 },
    );
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.runs.setReady(run.id);
    orchestrator.runs.start(run.id);
    await orchestrator.advanceProductionRun(run.id);
    const linked = database.sqlite
      .prepare(
        `SELECT sw.workflow_step_id as stepId,sw.unit_key as unitKey,ps.id as stageId
         FROM production_stage_work sw JOIN production_stages ps ON ps.id=sw.stage_id
         WHERE ps.run_id=? AND ps.stage_key='STORY' LIMIT 1`,
      )
      .get(run.id) as { stepId: Id; unitKey: string; stageId: Id };
    database.sqlite
      .prepare("UPDATE workflow_steps SET status='FAILED' WHERE id=?")
      .run(linked.stepId);
    orchestrator.stages.updateWorkStatus(linked.stageId, linked.unitKey, 'FAILED');

    const advance = orchestrator.retryStage(run.id, 'STORY', linked.unitKey);
    const status = orchestrator.status(run.id);
    expect(advance.reused).toBe(false);
    expect(status.run.metrics.retryCount).toBe(1);
    expect(status.stages[0]!.status).toBe('PENDING');
    expect(status.interventions.some((item) => item.type === 'QUALITY_REVIEW_REQUIRED')).toBe(true);
    expect(
      database.sqlite.prepare('SELECT status FROM workflow_steps WHERE id=?').get(linked.stepId),
    ).toEqual({ status: 'PENDING' });
    database.sqlite.close();
  });
  it('rejects retry commands after terminal cancellation', () => {
    const database = setup();
    const orchestrator = new ProductionOrchestrator(context(database, { count: 0 }));
    const run = orchestrator.createRun(projectId, { type: 'FULL_PROJECT' });
    orchestrator.cancelRun(run.id);
    expect(() => orchestrator.retryStage(run.id, 'STORY')).toThrow(/terminal/);
    expect(orchestrator.status(run.id).run.status).toBe('CANCELLED');
    database.sqlite.close();
  });
});
