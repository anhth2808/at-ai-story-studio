import { randomUUID, createHash } from 'node:crypto';
import {
  AppError,
  chapterGenerationEnvelopeSchema,
  chapterPlanSchema,
  chapterPlanItemSchema,
  chapterSummarySchema,
  generationMetadataSchema,
  storyBlueprintSchema,
  storySettingsSchema,
  storyThreadSchema,
  type ChapterGenerationEnvelope,
  type ChapterPlanItem,
  type GenerationMetadata,
  type Id,
  type StoryBlueprintDto,
  type StoryPlanDto,
  type StorySettingsDto,
  type StorySummaryDto,
  type StoryThread,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: string): unknown => JSON.parse(value);
const safeMetadata = (value: GenerationMetadata | null): GenerationMetadata | null =>
  value ? generationMetadataSchema.parse(value) : null;

export type StoryRevisionRef = { id: Id; revision: number };

export class StoryRepository {
  constructor(private readonly database: DatabaseHandle) {}

  getSettings(projectId: Id): StorySettingsDto | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,revision,payload,created_at as createdAt,updated_at as updatedAt FROM story_settings_revisions WHERE project_id=? AND is_current=1',
      )
      .get(projectId) as
      | {
          id: Id;
          projectId: Id;
          revision: number;
          payload: string;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      revision: row.revision,
      ...storySettingsSchema.parse(parseJson(row.payload)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getSettingsRevision(projectId: Id, revision: number): StoryRevisionRef | null {
    return (
      (this.database.sqlite
        .prepare(
          'SELECT id,revision FROM story_settings_revisions WHERE project_id=? AND revision=?',
        )
        .get(projectId, revision) as StoryRevisionRef | undefined) ?? null
    );
  }

  saveSettings(projectId: Id, input: unknown): StorySettingsDto {
    const settings = storySettingsSchema.parse(input);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_settings_revisions WHERE project_id=?',
      )
      .get(projectId) as { revision: number };
    const id = randomUUID();
    const stamp = now();
    const fingerprint = this.fingerprint({ projectId, settings });
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_settings_revisions(id,project_id,revision,mode,payload,input_fingerprint,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)',
        )
        .run(
          id,
          projectId,
          current.revision + 1,
          settings.mode,
          json(settings),
          fingerprint,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare('UPDATE story_settings_revisions SET is_current=0,updated_at=? WHERE project_id=?')
        .run(stamp, projectId);
      this.database.sqlite
        .prepare('UPDATE story_settings_revisions SET is_current=1,updated_at=? WHERE id=?')
        .run(stamp, id);
    })();
    return this.getSettings(projectId)!;
  }

  getBlueprint(projectId: Id): StoryBlueprintDto | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,revision,settings_revision_id as settingsRevision,payload,metadata,created_at as createdAt FROM story_blueprint_revisions WHERE project_id=? AND is_current=1',
      )
      .get(projectId) as
      | {
          id: Id;
          projectId: Id;
          revision: number;
          settingsRevision: Id;
          payload: string;
          metadata: string | null;
          createdAt: string;
        }
      | undefined;
    if (!row) return null;
    const settings = this.database.sqlite
      .prepare('SELECT revision FROM story_settings_revisions WHERE id=?')
      .get(row.settingsRevision) as { revision: number } | undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      revision: row.revision,
      settingsRevision: settings?.revision ?? 0,
      blueprint: storyBlueprintSchema.parse(parseJson(row.payload)),
      metadata: row.metadata ? safeMetadata(parseJson(row.metadata) as GenerationMetadata) : null,
      createdAt: row.createdAt,
    };
  }

  getBlueprintRevision(projectId: Id, revision: number): StoryRevisionRef | null {
    return (
      (this.database.sqlite
        .prepare(
          'SELECT id,revision FROM story_blueprint_revisions WHERE project_id=? AND revision=?',
        )
        .get(projectId, revision) as StoryRevisionRef | undefined) ?? null
    );
  }

  saveBlueprint(
    projectId: Id,
    settingsRevisionId: Id,
    blueprintInput: unknown,
    metadata: GenerationMetadata | null,
    inputFingerprint: string,
  ): StoryBlueprintDto {
    const blueprint = storyBlueprintSchema.parse(blueprintInput);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_blueprint_revisions WHERE project_id=?',
      )
      .get(projectId) as { revision: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_blueprint_revisions(id,project_id,settings_revision_id,revision,payload,input_fingerprint,metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)',
        )
        .run(
          id,
          projectId,
          settingsRevisionId,
          current.revision + 1,
          json(blueprint),
          inputFingerprint,
          metadata ? json(metadata) : null,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare(
          'UPDATE story_blueprint_revisions SET is_current=0,updated_at=? WHERE project_id=?',
        )
        .run(stamp, projectId);
      this.database.sqlite
        .prepare('UPDATE story_blueprint_revisions SET is_current=1,updated_at=? WHERE id=?')
        .run(stamp, id);
    })();
    return this.getBlueprint(projectId)!;
  }

  getPlan(projectId: Id): StoryPlanDto | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,revision,blueprint_revision_id as blueprintRevision,payload,metadata,created_at as createdAt FROM story_plan_revisions WHERE project_id=? AND is_current=1',
      )
      .get(projectId) as
      | {
          id: Id;
          projectId: Id;
          revision: number;
          blueprintRevision: Id;
          payload: string;
          metadata: string | null;
          createdAt: string;
        }
      | undefined;
    if (!row) return null;
    const blueprint = this.database.sqlite
      .prepare('SELECT revision FROM story_blueprint_revisions WHERE id=?')
      .get(row.blueprintRevision) as { revision: number } | undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      revision: row.revision,
      blueprintRevision: blueprint?.revision ?? 0,
      plan: chapterPlanSchema.parse(parseJson(row.payload)),
      metadata: row.metadata ? safeMetadata(parseJson(row.metadata) as GenerationMetadata) : null,
      createdAt: row.createdAt,
    };
  }

  getPlanItem(projectId: Id, stableId: string): { planId: Id; item: ChapterPlanItem } | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT p.id as planId,i.payload FROM story_plan_revisions p JOIN story_plan_items i ON i.plan_revision_id=p.id WHERE p.project_id=? AND p.is_current=1 AND i.stable_id=?',
      )
      .get(projectId, stableId) as { planId: Id; payload: string } | undefined;
    if (!row) return null;
    return { planId: row.planId, item: chapterPlanItemSchema.parse(parseJson(row.payload)) };
  }

  savePlan(
    projectId: Id,
    blueprintRevisionId: Id,
    planInput: unknown,
    metadata: GenerationMetadata | null,
    inputFingerprint: string,
  ): StoryPlanDto {
    const plan = chapterPlanSchema.parse(planInput);
    const uniqueNumbers = new Set(plan.items.map((item) => item.chapterNumber));
    if (uniqueNumbers.size !== plan.items.length)
      throw new AppError('INVALID_PLAN', 'Chapter numbers must be unique');
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_plan_revisions WHERE project_id=?',
      )
      .get(projectId) as { revision: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_plan_revisions(id,project_id,blueprint_revision_id,revision,payload,input_fingerprint,metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)',
        )
        .run(
          id,
          projectId,
          blueprintRevisionId,
          current.revision + 1,
          json(plan),
          inputFingerprint,
          metadata ? json(metadata) : null,
          stamp,
          stamp,
        );
      for (const item of plan.items)
        this.database.sqlite
          .prepare(
            'INSERT INTO story_plan_items(id,plan_revision_id,stable_id,chapter_number,payload,input_fingerprint,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(randomUUID(), id, item.id, item.chapterNumber, json(item), inputFingerprint, stamp);
      this.database.sqlite
        .prepare('UPDATE story_plan_revisions SET is_current=0,updated_at=? WHERE project_id=?')
        .run(stamp, projectId);
      this.database.sqlite
        .prepare('UPDATE story_plan_revisions SET is_current=1,updated_at=? WHERE id=?')
        .run(stamp, id);
    })();
    return this.getPlan(projectId)!;
  }

  getSummary(chapterId: Id): StorySummaryDto | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,chapter_id as chapterId,chapter_revision as chapterRevision,revision,payload,warnings,metadata,created_at as createdAt FROM story_summary_revisions WHERE chapter_id=? AND is_current=1',
      )
      .get(chapterId) as
      | {
          id: Id;
          chapterId: Id;
          chapterRevision: number;
          revision: number;
          payload: string;
          warnings: string;
          metadata: string | null;
          createdAt: string;
        }
      | undefined;
    if (!row) return null;
    const chapter = this.database.sqlite
      .prepare('SELECT project_id as projectId FROM chapters WHERE id=?')
      .get(chapterId) as { projectId: Id } | undefined;
    return {
      id: row.id,
      chapterId: row.chapterId,
      chapterRevision: row.chapterRevision,
      revision: row.revision,
      summary: chapterSummarySchema.parse(parseJson(row.payload)),
      threads: this.getThreads(chapter?.projectId),
      warnings: JSON.parse(row.warnings) as string[],
      metadata: row.metadata ? safeMetadata(parseJson(row.metadata) as GenerationMetadata) : null,
      createdAt: row.createdAt,
    };
  }

  getSummaries(projectId: Id): StorySummaryDto[] {
    const chapters = this.database.sqlite
      .prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY number')
      .all(projectId) as Array<{ id: Id }>;
    return chapters.flatMap((chapter) => {
      const summary = this.getSummary(chapter.id);
      return summary ? [summary] : [];
    });
  }

  saveSummary(
    chapterId: Id,
    chapterRevision: number,
    summaryInput: unknown,
    warnings: string[],
    metadata: GenerationMetadata | null,
    inputFingerprint: string,
    threads: StoryThread[] = [],
  ): StorySummaryDto {
    const summary = chapterSummarySchema.parse(summaryInput);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_summary_revisions WHERE chapter_id=?',
      )
      .get(chapterId) as { revision: number };
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          chapterId,
          chapterRevision,
          current.revision + 1,
          json(summary),
          json(warnings.slice(0, 50)),
          metadata ? json(metadata) : null,
          inputFingerprint,
          'CURRENT',
          0,
          stamp,
        );
      this.database.sqlite
        .prepare('UPDATE story_summary_revisions SET is_current=0 WHERE chapter_id=?')
        .run(chapterId);
      this.database.sqlite
        .prepare('UPDATE story_summary_revisions SET is_current=1 WHERE id=?')
        .run(id);
      for (const thread of threads) this.upsertThread(thread, chapterId, stamp);
    })();
    return this.getSummary(chapterId)!;
  }

  markSummaryStale(chapterId: Id): void {
    this.database.sqlite
      .prepare("UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?")
      .run(chapterId);
  }

  getThreads(projectId?: Id): StoryThread[] {
    const rows = this.database.sqlite
      .prepare(
        projectId
          ? 'SELECT r.payload FROM story_thread_revisions r JOIN story_threads t ON t.id=r.thread_id WHERE t.project_id=? AND r.is_current=1 ORDER BY t.stable_id'
          : 'SELECT r.payload FROM story_thread_revisions r JOIN story_threads t ON t.id=r.thread_id WHERE r.is_current=1 ORDER BY t.stable_id',
      )
      .all(...(projectId ? [projectId] : [])) as Array<{ payload: string }>;
    return rows.flatMap((row) => {
      const parsed = storyThreadSchema.safeParse(parseJson(row.payload));
      return parsed.success ? [parsed.data] : [];
    });
  }

  upsertThread(threadInput: unknown, chapterId: Id | null, stamp = now()): void {
    if (!chapterId) throw new AppError('INVALID_THREAD', 'A thread must belong to a chapter');
    const thread = storyThreadSchema.parse(threadInput);
    const existing = this.database.sqlite
      .prepare(
        'SELECT id FROM story_threads WHERE project_id=(SELECT project_id FROM chapters WHERE id=?) AND stable_id=?',
      )
      .get(chapterId, thread.id) as { id: Id } | undefined;
    const threadId = existing?.id ?? randomUUID();
    if (!existing)
      this.database.sqlite
        .prepare(
          'INSERT INTO story_threads(id,project_id,stable_id,created_at) SELECT ?,project_id,?,? FROM chapters WHERE id=?',
        )
        .run(threadId, thread.id, stamp, chapterId);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_thread_revisions WHERE thread_id=?',
      )
      .get(threadId) as { revision: number };
    this.database.sqlite
      .prepare(
        'INSERT INTO story_thread_revisions(id,thread_id,revision,source_chapter_id,payload,is_current,created_at) VALUES(?,?,?,?,?,1,?)',
      )
      .run(randomUUID(), threadId, current.revision + 1, chapterId, json(thread), stamp);
    this.database.sqlite
      .prepare('UPDATE story_thread_revisions SET is_current=0 WHERE thread_id=? AND revision<?')
      .run(threadId, current.revision + 1);
  }

  createGenerationRecord(
    projectId: Id,
    operation: string,
    targetId: string,
    workflowStepId: Id | null,
    inputFingerprint: string,
    metadata: unknown,
    status: string,
  ): Id {
    const id = randomUUID();
    this.database.sqlite
      .prepare(
        'INSERT INTO story_generation_records(id,project_id,operation,target_id,workflow_step_id,input_fingerprint,metadata,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        projectId,
        operation,
        targetId,
        workflowStepId,
        inputFingerprint,
        json(metadata),
        status,
        now(),
      );
    return id;
  }

  updateGenerationRecord(
    id: Id,
    status: string,
    metadata: unknown,
    error: string | null = null,
  ): void {
    this.database.sqlite
      .prepare(
        'UPDATE story_generation_records SET status=?,metadata=?,error=?,completed_at=? WHERE id=?',
      )
      .run(status, json(metadata), error?.slice(0, 2_000) ?? null, now(), id);
  }
  commitGeneratedChapter(input: {
    projectId: Id;
    planItemId: string;
    generationId: Id;
    workflowStepId?: Id | null;
    envelope: ChapterGenerationEnvelope;
    metadata: GenerationMetadata;
    inputFingerprint: string;
  }): { chapterId: Id; chapterRevision: number } {
    const envelope = chapterGenerationEnvelopeSchema.parse(input.envelope);
    const metadata = generationMetadataSchema.parse(input.metadata);
    const planItem = this.getPlanItem(input.projectId, input.planItemId);
    if (!planItem)
      throw new AppError('PREREQUISITE_MISSING', 'Current chapter plan item is required', 409);
    const existing = this.database.sqlite
      .prepare(
        'SELECT id,revision,story_origin as origin FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(input.projectId, input.planItemId) as
      { id: Id; revision: number; origin: string } | undefined;
    if (existing?.origin === 'MANUAL')
      throw new AppError(
        'MANUAL_EDIT_CONFLICT',
        'A newer manual chapter revision must be reviewed before regeneration',
        409,
      );
    const stamp = now();
    const result = this.database.sqlite.transaction(() => {
      if (
        input.workflowStepId &&
        !this.database.sqlite
          .prepare(
            "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND input_fingerprint=?",
          )
          .get(input.workflowStepId, input.inputFingerprint)
      )
        throw new AppError('STALE_INPUT', 'Story generation input changed before commit', 409);
      let chapterId: Id;
      let chapterRevision: number;
      if (existing) {
        chapterId = existing.id;
        chapterRevision = existing.revision + 1;
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET title=?,content=?,revision=?,story_origin='GENERATED',story_generation_id=?,updated_at=? WHERE id=?",
          )
          .run(
            envelope.title,
            envelope.content,
            chapterRevision,
            input.generationId,
            stamp,
            chapterId,
          );
      } else {
        chapterId = randomUUID();
        chapterRevision = 1;
        const max = this.database.sqlite
          .prepare('SELECT COALESCE(MAX(number),0)+1 as next FROM chapters WHERE project_id=?')
          .get(input.projectId) as { next: number };
        this.database.sqlite
          .prepare(
            "INSERT INTO chapters(id,project_id,number,title,content,revision,story_origin,story_plan_item_id,story_generation_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'GENERATED',?,?,?,?)",
          )
          .run(
            chapterId,
            input.projectId,
            max.next,
            envelope.title,
            envelope.content,
            chapterRevision,
            input.planItemId,
            input.generationId,
            stamp,
            stamp,
          );
      }
      const current = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0) as revision FROM story_summary_revisions WHERE chapter_id=?',
        )
        .get(chapterId) as { revision: number };
      const summaryId = randomUUID();
      this.database.sqlite
        .prepare(
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          summaryId,
          chapterId,
          chapterRevision,
          current.revision + 1,
          json(envelope.summary),
          json(envelope.continuityWarnings.slice(0, 50)),
          json(metadata),
          input.inputFingerprint,
          'CURRENT',
          0,
          stamp,
        );
      this.database.sqlite
        .prepare(
          "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
        )
        .run(chapterId);
      this.database.sqlite
        .prepare('UPDATE story_summary_revisions SET is_current=1 WHERE id=?')
        .run(summaryId);
      return { chapterId, chapterRevision };
    })();
    return result;
  }

  private invalidateWorkflowRows(entityIds: Id[], types: string[], error: string): number {
    if (!entityIds.length || !types.length) return 0;
    const entities = entityIds.map(() => '?').join(',');
    const placeholders = types.map(() => '?').join(',');
    const stamp = now();
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
      if (step.current_attempt_id)
        this.database.sqlite
          .prepare(
            "UPDATE workflow_step_attempts SET status='FAILED',error=?,finished_at=? WHERE id=? AND status='RUNNING'",
          )
          .run(error, stamp, step.current_attempt_id);
      this.database.sqlite
        .prepare(
          "UPDATE jobs SET status='INVALIDATED',error=?,completed_at=NULL WHERE step_id=? AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')",
        )
        .run(error, step.id);
    }
    return steps.length;
  }

  invalidateScope(scope: {
    projectId: Id;
    kind: 'SETTINGS' | 'BLUEPRINT' | 'PLAN' | 'PLAN_ITEM' | 'CHAPTER' | 'SUMMARY';
    chapterId?: Id;
    stableId?: string;
  }): number {
    const storyTypes = {
      blueprint: ['GENERATE_STORY_BLUEPRINT'],
      plan: ['GENERATE_CHAPTER_PLANS'],
      chapter: ['GENERATE_CHAPTER'],
      summary: ['GENERATE_CHAPTER_SUMMARY'],
    };
    const chapterRows = this.database.sqlite
      .prepare(
        scope.kind === 'PLAN_ITEM'
          ? 'SELECT id FROM chapters WHERE project_id=? AND story_plan_item_id=?'
          : 'SELECT id FROM chapters WHERE project_id=?',
      )
      .all(
        ...(scope.kind === 'PLAN_ITEM'
          ? [scope.projectId, scope.stableId ?? '']
          : [scope.projectId]),
      ) as Array<{
      id: Id;
    }>;
    const chapterIds = scope.chapterId
      ? chapterRows.some((row) => row.id === scope.chapterId)
        ? [scope.chapterId]
        : []
      : chapterRows.map((row) => row.id);
    const chapterStoryTypes = [...storyTypes.chapter, ...storyTypes.summary];
    const invalidateMedia = scope.kind === 'PLAN_ITEM' || scope.kind === 'CHAPTER';
    const error = `Story ${scope.kind.toLowerCase()} changed`;
    return this.database.sqlite.transaction(() => {
      let invalidated = 0;
      if (scope.kind === 'SETTINGS') {
        invalidated += this.invalidateWorkflowRows(
          [scope.projectId],
          [...storyTypes.blueprint, ...storyTypes.plan],
          error,
        );
      }
      if (scope.kind === 'BLUEPRINT') {
        invalidated += this.invalidateWorkflowRows([scope.projectId], [...storyTypes.plan], error);
      }
      if (scope.kind === 'PLAN') {
        invalidated += this.invalidateWorkflowRows([scope.projectId], storyTypes.plan, error);
      }
      if (scope.kind === 'PLAN_ITEM' || scope.kind === 'CHAPTER') {
        invalidated += this.invalidateWorkflowRows(chapterIds, chapterStoryTypes, error);
        for (const chapterId of chapterIds) {
          this.database.sqlite
            .prepare(
              "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
            )
            .run(chapterId);
          if (invalidateMedia) {
            this.database.sqlite
              .prepare(
                'UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND (role IN (?,?) OR source_entity_id=? )',
              )
              .run(
                now(),
                scope.projectId,
                `chapter:${chapterId}:audio`,
                `chapter:${chapterId}:subtitle`,
                chapterId,
              );
            this.database.sqlite
              .prepare(
                "UPDATE tts_segments SET status='INVALIDATED',audio_asset_id=NULL,duration_ms=NULL,error=? WHERE chapter_id=?",
              )
              .run(error, chapterId);
          }
        }
        if (invalidateMedia) {
          invalidated += this.invalidateWorkflowRows([scope.projectId], ['RENDER'], error);
          this.database.sqlite
            .prepare(
              "UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role='project:render'",
            )
            .run(now(), scope.projectId);
        }
      }
      if (scope.kind === 'SUMMARY' && scope.chapterId) {
        invalidated += this.invalidateWorkflowRows([scope.chapterId], storyTypes.summary, error);
        this.database.sqlite
          .prepare(
            "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
          )
          .run(scope.chapterId);
      }
      return invalidated;
    })();
  }

  snapshot(projectId: Id): {
    settings: StorySettingsDto | null;
    blueprint: StoryBlueprintDto | null;
    plan: StoryPlanDto | null;
    summaries: StorySummaryDto[];
    threads: StoryThread[];
  } {
    return {
      settings: this.getSettings(projectId),
      blueprint: this.getBlueprint(projectId),
      plan: this.getPlan(projectId),
      summaries: this.getSummaries(projectId),
      threads: this.getThreads(projectId),
    };
  }

  fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
