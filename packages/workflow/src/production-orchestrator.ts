import { randomUUID } from 'node:crypto';
import {
  AppError,
  productionAdvancePayloadSchema,
  productionPlanClassificationSchema,
  type Id,
  type ProductionPlanClassification,
  type ProductionPreflightResult,
  type ProductionPlanResult,
  type ProductionScope,
  type ProductionStageKey,
  type RenderPlan,
  type RenderRequest,
} from '@studio/shared';
import {
  ProductionInterventionRepository,
  ProductionProfileRepository,
  ProductionRunRepository,
  ProductionStageRepository,
  WorkflowRepository,
  productionActiveRunStatuses,
  productionStageOrder,
  type ClaimedStep,
  type ProductionInterventionRecord,
  type ProductionRunRecord,
  type ProductionStageRecord,
} from '@studio/database';
import {
  ProductionPlanner,
  ProductionPreflightService,
  type ProductionPlanningContext,
} from './production-planning.js';

const now = (): string => new Date().toISOString();
const COORDINATOR_TYPE = 'ADVANCE_PRODUCTION_RUN';
const ACTIVE_COORDINATOR_STATUSES = ['PENDING', 'RUNNING'] as const;

type CoordinatorStatus = (typeof ACTIVE_COORDINATOR_STATUSES)[number];

export type ProductionScheduledWork = {
  stepId: Id;
  unitKey: string;
  entityId?: Id | null;
  classification?: ProductionPlanClassification;
  inputFingerprint: string;
  summary?: Record<string, unknown>;
};

export type ProductionStageInspection = {
  decision: ProductionPlanClassification;
  message: string;
  current?: boolean;
  warnings?: string[];
  fallbacks?: string[];
  blockers?: string[];
  progress?: { current: number; total: number };
  summary?: Record<string, unknown>;
};

export type ProductionStageAdapter = {
  inspect: (
    run: ProductionRunRecord,
    stage: ProductionStageRecord,
  ) => ProductionStageInspection | Promise<ProductionStageInspection>;
  schedule?: (
    run: ProductionRunRecord,
    stage: ProductionStageRecord,
    limit: number,
  ) => ProductionScheduledWork[] | Promise<ProductionScheduledWork[]>;
};

export type ProductionOrchestratorAdapters = Partial<
  Record<ProductionStageKey, ProductionStageAdapter>
>;
export type ProductionOrchestratorOptions = {
  coordinatorBatchSize?: number;
  maxActiveUnits?: number;
  timeline?: { getRenderPlan(projectId: Id, request: RenderRequest): RenderPlan };
};

export type ProductionAdvanceRequest = {
  stepId: Id;
  jobId: Id;
  reused: boolean;
};

export type ProductionStatus = {
  run: ProductionRunRecord;
  stages: ProductionStageRecord[];
  interventions: ProductionInterventionRecord[];
};

function stageInterventionType(
  stage: ProductionStageKey,
): Parameters<ProductionInterventionRepository['upsertOpen']>[0]['type'] {
  if (stage === 'STORY') return 'STORY_APPROVAL_REQUIRED';
  if (stage === 'SCENE_IMAGES') return 'IMAGE_REVIEW_REQUIRED';
  if (stage === 'VISUAL_PROFILES') return 'REFERENCE_REQUIRED';
  if (stage === 'AI_MOTION') return 'PROVIDER_CONFIGURATION_REQUIRED';
  if (stage === 'RENDER' || stage === 'TIMELINE') return 'RENDER_ASSET_MISSING';
  return 'QUALITY_REVIEW_REQUIRED';
}

export class ProductionOrchestrator {
  readonly profiles: ProductionProfileRepository;
  readonly runs: ProductionRunRepository;
  readonly stages: ProductionStageRepository;
  readonly interventions: ProductionInterventionRepository;
  readonly workflow: WorkflowRepository;
  readonly preflight: ProductionPreflightService;
  readonly planner: ProductionPlanner;
  private readonly coordinatorBatchSize: number;
  private readonly maxActiveUnits: number;

  constructor(
    private readonly context: ProductionPlanningContext,
    private readonly adapters: ProductionOrchestratorAdapters = {},
    preflight?: ProductionPreflightService,
    options: ProductionOrchestratorOptions = {},
  ) {
    this.profiles = preflight?.profiles ?? new ProductionProfileRepository(context.database);
    this.runs = preflight?.runs ?? new ProductionRunRepository(context.database, this.profiles);
    this.stages = new ProductionStageRepository(context.database);
    this.interventions = new ProductionInterventionRepository(context.database);
    this.preflight = preflight ?? new ProductionPreflightService(context);
    this.planner = new ProductionPlanner(context, {
      preflight: this.preflight,
      timeline: options.timeline,
    });
    this.workflow = new WorkflowRepository(context.database);
    this.coordinatorBatchSize = Math.max(
      1,
      Math.min(100, Math.trunc(options.coordinatorBatchSize ?? 100)),
    );
    this.maxActiveUnits = Math.max(1, Math.min(1_000, Math.trunc(options.maxActiveUnits ?? 100)));
  }
  createRun(projectId: Id, scope: ProductionScope, profileId?: Id): ProductionRunRecord {
    return this.runs.create(projectId, profileId, scope);
  }

  async plan(projectId: Id, scope: ProductionScope, profileId?: Id): Promise<ProductionPlanResult> {
    return await this.planner.plan(projectId, scope, profileId);
  }

  async check(
    projectId: Id,
    scope: ProductionScope,
    profileId?: Id,
  ): Promise<ProductionPreflightResult> {
    return await this.preflight.check(projectId, scope, profileId);
  }

  status(runId: Id): ProductionStatus {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    return {
      run,
      stages: this.stages.list(runId),
      interventions: this.interventions.list(runId),
    };
  }

  private coordinator(
    run: ProductionRunRecord,
  ): { stepId: Id; jobId: Id; status: CoordinatorStatus } | null {
    const row = this.context.database.sqlite
      .prepare(
        `SELECT ws.id as stepId,j.id as jobId,ws.status
         FROM workflow_steps ws JOIN jobs j ON j.step_id=ws.id
         WHERE ws.execution_id=? AND ws.type=? AND ws.status IN ('PENDING','RUNNING')
         ORDER BY ws.created_at DESC LIMIT 1`,
      )
      .get(run.workflowExecutionId, COORDINATOR_TYPE) as
      { stepId: Id; jobId: Id; status: CoordinatorStatus } | undefined;
    return row ?? null;
  }

  requestAdvance(runId: Id, reason = 'MANUAL'): ProductionAdvanceRequest {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (['CANCELLED', 'COMPLETED'].includes(run.status))
      throw new AppError('PRODUCTION_TERMINAL', 'Production run is already terminal', 409);
    const active = this.coordinator(run);
    if (active) return { stepId: active.stepId, jobId: active.jobId, reused: true };
    const tx = this.context.database.sqlite.transaction(() => {
      const current = this.runs.get(runId);
      if (!current) throw new AppError('NOT_FOUND', 'Production run not found', 404);
      if (['CANCELLED', 'COMPLETED'].includes(current.status))
        throw new AppError('PRODUCTION_TERMINAL', 'Production run is already terminal', 409);
      const activeInside = this.coordinator(current);
      if (activeInside)
        return { stepId: activeInside.stepId, jobId: activeInside.jobId, reused: true };
      const sequence =
        Number(
          (
            this.context.database.sqlite
              .prepare('SELECT coordinator_sequence FROM production_runs WHERE id=?')
              .get(runId) as { coordinator_sequence: number }
          ).coordinator_sequence,
        ) + 1;
      const stamp = now();
      const stepId = randomUUID();
      const jobId = randomUUID();
      this.context.database.sqlite
        .prepare(
          'UPDATE production_runs SET coordinator_sequence=?,row_version=row_version+1,updated_at=? WHERE id=?',
        )
        .run(sequence, stamp, runId);
      this.context.database.sqlite
        .prepare(
          `INSERT INTO workflow_steps(
            id,execution_id,step_key,type,entity_id,status,input_fingerprint,payload,max_attempts,created_at,updated_at
          ) VALUES(?,?,?,?,?,'PENDING',?,?,?,?,?)`,
        )
        .run(
          stepId,
          current.workflowExecutionId,
          `production:advance:${runId}:${sequence}`,
          COORDINATOR_TYPE,
          runId,
          `production:${runId}:${sequence}`,
          JSON.stringify({ runId, reason: reason.slice(0, 120) }),
          5,
          stamp,
          stamp,
        );
      this.context.database.sqlite
        .prepare('INSERT INTO jobs(id,type,entity_id,step_id,created_at) VALUES(?,?,?,?,?)')
        .run(jobId, COORDINATOR_TYPE, runId, stepId, stamp);
      return { stepId, jobId, reused: false };
    });
    return tx();
  }

  async startRun(
    runId: Id,
    expectedRowVersion?: number,
  ): Promise<{
    status: ProductionStatus;
    preflight: ProductionPreflightResult;
    advance: ProductionAdvanceRequest;
  }> {
    let run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    const preflight = await this.preflight.check(run.projectId, run.scope, run.profileId);
    if (preflight.status === 'BLOCKED')
      throw new AppError(
        'PRODUCTION_PREFLIGHT_BLOCKED',
        'Production preflight is blocked',
        409,
        false,
        JSON.stringify(preflight.issues),
      );
    if (run.status === 'DRAFT' || run.status === 'FAILED') {
      run = this.runs.setReady(runId, expectedRowVersion ?? run.rowVersion);
      expectedRowVersion = run.rowVersion;
    }
    const started = this.runs.start(runId, expectedRowVersion);
    const advance = this.requestAdvance(started.id, 'START');
    return { status: this.status(started.id), preflight, advance };
  }

  pauseRun(runId: Id, expectedRowVersion?: number): ProductionStatus {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    this.runs.transition(runId, 'PAUSED', expectedRowVersion);
    return this.status(runId);
  }

  resumeRun(runId: Id, expectedRowVersion?: number): ProductionAdvanceRequest {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (run.status === 'WAITING_FOR_USER')
      this.runs.transition(runId, 'RUNNING', expectedRowVersion);
    else this.runs.start(runId, expectedRowVersion);
    return this.requestAdvance(runId, 'RESUME');
  }

  cancelRun(runId: Id, expectedRowVersion?: number): ProductionStatus {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    this.runs.requestCancel(runId, expectedRowVersion);
    const steps = this.context.database.sqlite
      .prepare(
        `SELECT workflow_step_id as stepId FROM production_stage_work sw
         JOIN production_stages ps ON ps.id=sw.stage_id WHERE ps.run_id=?
         UNION SELECT id as stepId FROM workflow_steps WHERE execution_id=? AND type=? AND status IN ('PENDING','RUNNING')`,
      )
      .all(runId, run.workflowExecutionId, COORDINATOR_TYPE) as Array<{ stepId: Id }>;
    for (const step of steps) this.workflow.requestCancel(step.stepId);
    return this.status(runId);
  }

  retryStage(runId: Id, stageKey: ProductionStageKey, unitKey?: string): ProductionAdvanceRequest {
    const run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (['CANCELLED', 'COMPLETED'].includes(run.status))
      throw new AppError('PRODUCTION_TERMINAL', 'Production run is already terminal', 409);
    const stage = this.stages.getByRunAndKey(runId, stageKey);
    if (!stage) throw new AppError('NOT_FOUND', 'Production stage not found', 404);
    const work = this.context.database.sqlite
      .prepare(
        `SELECT workflow_step_id as stepId,unit_key as unitKey FROM production_stage_work
         WHERE stage_id=? AND (?='' OR unit_key=?) AND status IN ('FAILED','INVALIDATED','CANCELLED') LIMIT 100`,
      )
      .all(stage.id, unitKey ?? '', unitKey ?? '') as Array<{ stepId: Id; unitKey: string }>;
    for (const item of work) {
      this.workflow.retryStep(item.stepId);
      this.stages.updateWorkStatus(stage.id, item.unitKey, 'PENDING');
    }
    this.stages.update(stage.id, { status: 'PENDING', error: null });
    this.runs.updateProgress(runId, run.progress, {
      ...run.metrics,
      retryCount: Number(run.metrics.retryCount ?? 0) + 1,
      lastRetryStage: stageKey,
      lastRetryUnitKey: unitKey ?? null,
    });
    this.interventions.upsertOpen({
      runId,
      stageId: stage.id,
      type: 'QUALITY_REVIEW_REQUIRED',
      severity: 'INFO',
      message: `Retry requested for ${stageKey}${unitKey ? ` unit ${unitKey}` : ''}`,
      dedupeKey: `retry:${stageKey}:${unitKey ?? 'stage'}`,
      actions: ['Monitor the retried production unit'],
    });
    const current = this.runs.get(runId)!;
    if (current.status === 'FAILED') this.runs.setReady(runId, current.rowVersion);
    if (current.status === 'READY') this.runs.start(runId);
    else if (current.status === 'WAITING_FOR_USER') this.runs.transition(runId, 'RUNNING');
    return this.requestAdvance(runId, 'RETRY_STAGE');
  }

  private synchronizeWork(stage: ProductionStageRecord): ProductionStageRecord {
    const rows = this.context.database.sqlite
      .prepare(
        `SELECT sw.unit_key as unitKey,sw.classification,ws.status as workflowStatus
         FROM production_stage_work sw JOIN workflow_steps ws ON ws.id=sw.workflow_step_id
         WHERE sw.stage_id=? LIMIT 1_000`,
      )
      .all(stage.id) as Array<{
      unitKey: string;
      classification: ProductionPlanClassification;
      workflowStatus: string;
    }>;
    const counts = { reusableCount: 0, generatedCount: 0, reviewCount: 0, blockedCount: 0 };
    let hasRunning = false;
    let hasPending = false;
    let hasFailed = false;
    let hasCancelled = false;
    for (const row of rows) {
      const next = row.workflowStatus;
      if (next === 'COMPLETED') this.stages.updateWorkStatus(stage.id, row.unitKey, 'COMPLETED');
      else if (next === 'FAILED' || next === 'INVALIDATED') {
        hasFailed = true;
        this.stages.updateWorkStatus(stage.id, row.unitKey, next);
      } else if (next === 'RUNNING') {
        hasRunning = true;
        this.stages.updateWorkStatus(stage.id, row.unitKey, 'RUNNING');
      } else if (next === 'CANCELLED') {
        hasCancelled = true;
        this.stages.updateWorkStatus(stage.id, row.unitKey, 'CANCELLED');
      } else {
        hasPending = true;
        this.stages.updateWorkStatus(stage.id, row.unitKey, 'PENDING');
      }
      if (row.classification === 'REUSE') counts.reusableCount += 1;
      if (row.classification === 'BUILD' && next === 'COMPLETED') counts.generatedCount += 1;
      if (row.classification === 'REVIEW') counts.reviewCount += 1;
      if (row.classification === 'BLOCKED') counts.blockedCount += 1;
    }
    const status = hasFailed
      ? 'FAILED'
      : hasRunning || (stage.status === 'RUNNING' && hasPending)
        ? 'RUNNING'
        : hasPending
          ? 'PENDING'
          : hasCancelled
            ? 'STALE'
            : rows.length
              ? 'COMPLETED'
              : stage.status;
    return this.stages.update(stage.id, {
      status,
      reusableCount: counts.reusableCount,
      generatedCount: counts.generatedCount,
      reviewCount: counts.reviewCount,
      blockedCount: counts.blockedCount,
      progress: {
        current: rows.filter((row) => row.workflowStatus === 'COMPLETED').length,
        total: rows.length,
      },
      error: hasFailed
        ? {
            code: 'STAGE_WORK_FAILED',
            message: 'A linked production unit failed',
            retryable: true,
            category: 'PRODUCTION',
          }
        : null,
      completedAt: status === 'COMPLETED' ? (stage.completedAt ?? now()) : null,
    });
  }

  private applyAiFallbacks(
    run: ProductionRunRecord,
    stage: ProductionStageRecord,
  ): ProductionStageRecord {
    if (
      stage.key !== 'AI_MOTION' ||
      !this.profiles.get(run.profileId)?.settings.allowKenBurnsFallback
    )
      return stage;
    const failed = this.context.database.sqlite
      .prepare(
        `SELECT sw.unit_key as unitKey,ws.error
         FROM production_stage_work sw
         JOIN workflow_steps ws ON ws.id=sw.workflow_step_id
         WHERE sw.stage_id=? AND sw.status='FAILED'`,
      )
      .all(stage.id) as Array<{ unitKey: string; error: string | null }>;
    const fallbackable = failed.filter((item) => {
      if (!item.error) return true;
      try {
        const parsed = JSON.parse(item.error) as { code?: unknown };
        return ![
          'CONFIGURATION_ERROR',
          'MODEL_MISSING',
          'WORKFLOW_INVALID',
          'STALE_INPUT',
        ].includes(typeof parsed.code === 'string' ? parsed.code : '');
      } catch {
        return true;
      }
    });
    if (!fallbackable.length) return stage;
    for (const item of fallbackable)
      this.stages.updateWorkStatus(stage.id, item.unitKey, 'COMPLETED');
    const fallbacks = fallbackable.map((item) => `${item.unitKey}:KEN_BURNS:provider_failure`);
    return this.stages.update(stage.id, {
      status: 'PENDING',
      error: null,
      fallbacks: [...stage.fallbacks, ...fallbacks].slice(-100),
      warnings: [
        ...stage.warnings,
        'Some AI motion units used the configured Ken Burns fallback',
      ].slice(-100),
    });
  }

  private refreshRunMetrics(runId: Id): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const stages = this.stages.list(runId);
    const progress = stages.reduce(
      (total, stage) => ({
        current: total.current + stage.progress.current,
        total: total.total + stage.progress.total,
      }),
      { current: 0, total: 0 },
    );
    const metrics = {
      ...run.metrics,
      reusedCount: stages.reduce((total, stage) => total + stage.reusableCount, 0),
      generatedCount: stages.reduce((total, stage) => total + stage.generatedCount, 0),
      reviewCount: stages.reduce((total, stage) => total + stage.reviewCount, 0),
      blockedCount: stages.reduce((total, stage) => total + stage.blockedCount, 0),
      fallbackCount: stages.reduce((total, stage) => total + stage.fallbacks.length, 0),
      completedStageCount: stages.filter(
        (stage) => stage.status === 'COMPLETED' || stage.status === 'SKIPPED',
      ).length,
    };
    this.runs.updateProgress(runId, progress, metrics);
  }

  async advanceProductionRun(runId: Id): Promise<ProductionStatus> {
    let run = this.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND', 'Production run not found', 404);
    if (!['RUNNING', 'WAITING_FOR_USER'].includes(run.status)) return this.status(runId);
    if (run.status === 'WAITING_FOR_USER') return this.status(runId);
    for (const stageKey of productionStageOrder) {
      const stage = this.stages.getByRunAndKey(runId, stageKey);
      if (!stage) continue;
      let reconciled = this.synchronizeWork(stage);
      this.refreshRunMetrics(runId);
      if (['COMPLETED', 'SKIPPED'].includes(reconciled.status)) continue;
      if (reconciled.status === 'FAILED') reconciled = this.applyAiFallbacks(run, reconciled);
      if (reconciled.status === 'FAILED') {
        this.runs.transition(runId, 'FAILED', undefined, reconciled.error);
        return this.status(runId);
      }
      const adapter = this.adapters[stage.key];
      if (!adapter) {
        const error = {
          code: 'STAGE_ADAPTER_MISSING',
          message: `No adapter is configured for ${stage.key}`,
          retryable: false,
          category: 'PRODUCTION',
        } as const;
        this.stages.update(stage.id, { status: 'WAITING', blockers: [error.message], error });
        this.interventions.upsertOpen({
          runId,
          stageId: stage.id,
          type: stageInterventionType(stage.key),
          severity: 'BLOCKING',
          message: error.message,
          dedupeKey: `adapter:${stage.key}`,
          actions: ['Configure the canonical stage adapter'],
        });
        this.runs.transition(runId, 'WAITING_FOR_USER');
        return this.status(runId);
      }
      const inspection = await adapter.inspect(run, reconciled);
      const blockers = inspection.blockers ?? [];
      const warnings = inspection.warnings ?? [];
      const fallbacks = inspection.fallbacks ?? [];
      const inspectedProgress =
        inspection.progress ??
        (inspection.current || inspection.decision === 'REUSE'
          ? { current: 1, total: 1 }
          : reconciled.progress);
      const projection = {
        status: reconciled.status,
        progress: inspectedProgress,
        summary: inspection.summary ?? reconciled.summary,
        warnings,
        fallbacks,
        blockers,
        reusableCount: reconciled.reusableCount,
        generatedCount: reconciled.generatedCount,
        reviewCount: reconciled.reviewCount,
        blockedCount: reconciled.blockedCount,
      };
      if (inspection.decision === 'BLOCKED' || blockers.length) {
        this.stages.update(stage.id, { ...projection, status: 'WAITING' });
        this.refreshRunMetrics(runId);
        this.interventions.upsertOpen({
          runId,
          stageId: stage.id,
          type: stageInterventionType(stage.key),
          severity: 'BLOCKING',
          message: inspection.message,
          dedupeKey: `blocked:${stage.key}`,
          actions: ['Resolve the blocking production input'],
        });
        this.runs.transition(runId, 'WAITING_FOR_USER');
        return this.status(runId);
      }
      if (inspection.decision === 'REVIEW') {
        this.stages.update(stage.id, { ...projection, status: 'WAITING' });
        this.refreshRunMetrics(runId);
        this.interventions.upsertOpen({
          runId,
          stageId: stage.id,
          type: stageInterventionType(stage.key),
          severity: 'BLOCKING',
          message: inspection.message,
          dedupeKey: `review:${stage.key}`,
          actions: ['Review the current output', 'Resolve this intervention to continue'],
        });
        this.runs.transition(runId, 'WAITING_FOR_USER');
        return this.status(runId);
      }
      if (inspection.current || inspection.decision === 'REUSE') {
        this.stages.update(stage.id, { ...projection, status: 'COMPLETED', completedAt: now() });
        this.refreshRunMetrics(runId);
        continue;
      }
      if (reconciled.status === 'RUNNING') {
        this.runs.setCurrentStage(runId, stage.key);
        return this.status(runId);
      }
      if (!adapter.schedule) {
        this.stages.update(stage.id, {
          ...projection,
          status: 'WAITING',
          blockers: [`${stage.key} requires scheduling`],
        });
        this.refreshRunMetrics(runId);
        this.runs.transition(runId, 'WAITING_FOR_USER');
        return this.status(runId);
      }
      const profile = this.profiles.get(run.profileId);
      const settings = profile?.settings;
      const activeUnits = Number(
        (
          this.context.database.sqlite
            .prepare(
              `SELECT COUNT(*) as count FROM production_stage_work sw
               JOIN production_stages ps ON ps.id=sw.stage_id
               WHERE ps.run_id=? AND sw.status IN ('PENDING','RUNNING')`,
            )
            .get(runId) as { count: number }
        ).count,
      );
      const availableUnits = this.maxActiveUnits - activeUnits;
      if (availableUnits <= 0) {
        this.runs.setCurrentStage(runId, stage.key);
        return this.status(runId);
      }
      const configuredLimit =
        stage.key === 'SCENE_IMAGES'
          ? (settings?.imageBatchSize ?? 8)
          : (settings?.chapterBatchSize ?? 5);
      const limit = Math.max(
        1,
        Math.min(this.coordinatorBatchSize, availableUnits, configuredLimit),
      );
      const scheduled = await adapter.schedule(run, stage, limit);
      if (!scheduled.length) {
        const after = await adapter.inspect(run, stage);
        if (after.current || after.decision === 'REUSE') {
          this.stages.update(stage.id, { ...projection, status: 'COMPLETED', completedAt: now() });
          this.refreshRunMetrics(runId);
          continue;
        }
        this.stages.update(stage.id, {
          ...projection,
          status: 'WAITING',
          blockers: [after.message],
        });
        this.refreshRunMetrics(runId);
        this.interventions.upsertOpen({
          runId,
          stageId: stage.id,
          type: stageInterventionType(stage.key),
          severity: 'BLOCKING',
          message: after.message,
          dedupeKey: `empty:${stage.key}`,
          actions: ['Review the stage inputs'],
        });
        this.runs.transition(runId, 'WAITING_FOR_USER');
        return this.status(runId);
      }
      for (const work of scheduled.slice(0, 100)) {
        productionPlanClassificationSchema.parse(work.classification ?? 'BUILD');
        this.stages.linkWork({
          stageId: stage.id,
          workflowStepId: work.stepId,
          unitKey: work.unitKey,
          entityId: work.entityId ?? null,
          classification: work.classification ?? 'BUILD',
          inputFingerprint: work.inputFingerprint,
          summary: work.summary,
        });
      }
      this.stages.update(stage.id, {
        ...projection,
        status: 'RUNNING',
        startedAt: stage.startedAt ?? now(),
        progress: { current: 0, total: scheduled.length },
        completedAt: null,
      });
      this.refreshRunMetrics(runId);
      this.runs.setCurrentStage(runId, stage.key);
      return this.status(runId);
    }
    run = this.runs.get(runId)!;
    this.runs.transition(runId, 'COMPLETED', run.rowVersion);
    return this.status(runId);
  }

  async executeAdvanceStep(step: ClaimedStep, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new AppError('CANCELLED', 'Production advance was cancelled', 409);
    const payload = productionAdvancePayloadSchema.parse(JSON.parse(step.payload || '{}'));
    if (payload.runId !== step.entity_id)
      throw new AppError('STALE_INPUT', 'Production coordinator payload is stale', 409);
    await this.advanceProductionRun(payload.runId);
  }

  async onWorkflowStepSettled(stepId: Id): Promise<void> {
    const row = this.context.database.sqlite
      .prepare('SELECT type,entity_id as entityId,status FROM workflow_steps WHERE id=?')
      .get(stepId) as { type: string; entityId: Id; status: string } | undefined;
    if (!row) return;
    const linked = this.context.database.sqlite
      .prepare(
        `SELECT ps.run_id as runId,ps.id as stageId,sw.unit_key as unitKey
         FROM production_stage_work sw JOIN production_stages ps ON ps.id=sw.stage_id WHERE sw.workflow_step_id=?`,
      )
      .get(stepId) as { runId: Id; stageId: Id; unitKey: string } | undefined;
    if (linked) {
      const status = ACTIVE_COORDINATOR_STATUSES.includes(row.status as CoordinatorStatus)
        ? 'RUNNING'
        : row.status === 'COMPLETED'
          ? 'COMPLETED'
          : row.status === 'CANCELLED'
            ? 'CANCELLED'
            : 'FAILED';
      this.stages.updateWorkStatus(linked.stageId, linked.unitKey, status);
      const run = this.runs.get(linked.runId);
      if (run && run.status === 'RUNNING')
        this.requestAdvance(linked.runId, 'WORKFLOW_STEP_SETTLED');
      return;
    }
    if (row.type !== COORDINATOR_TYPE) return;
    const run = this.runs.get(row.entityId);
    if (!run) return;
    if (row.status === 'FAILED' || row.status === 'INVALIDATED') {
      if (run.status === 'RUNNING')
        this.runs.transition(run.id, 'FAILED', undefined, {
          code: 'PRODUCTION_COORDINATOR_FAILED',
          message: 'Production coordinator step failed',
          retryable: true,
          category: 'PRODUCTION',
        });
    } else if (row.status === 'COMPLETED' && run.status === 'RUNNING') {
      this.requestAdvance(run.id, 'COORDINATOR_SETTLED');
    }
  }

  async reconcileActiveRuns(): Promise<void> {
    const rows = this.context.database.sqlite
      .prepare(
        `SELECT id FROM production_runs WHERE status IN (${productionActiveRunStatuses.map(() => '?').join(',')}) ORDER BY updated_at LIMIT 100`,
      )
      .all(...productionActiveRunStatuses) as Array<{ id: Id }>;
    for (const row of rows) {
      const run = this.runs.get(row.id);
      if (!run || run.status !== 'RUNNING') continue;
      this.stages.list(run.id).forEach((stage) => this.synchronizeWork(stage));
      this.requestAdvance(run.id, 'RECOVERY');
    }
  }
}
