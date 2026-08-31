import { randomUUID, createHash } from 'node:crypto';
import {
  AppError,
  aiUsageSchema,
  generationOperationSchema,
  chapterGenerationEnvelopeSchema,
  chapterGenerationV2EnvelopeSchema,
  chapterPlanSchema,
  chapterPlanItemSchema,
  continuityCheckResultSchema,
  generationContextDiagnosticsSchema,
  storyArcPlanSchema,
  storyArcSchema,
  storyEventSchema,
  storyCharacterStateSchema,
  storyImportantEventSchema,
  storyImportantFactSchema,
  storyPlanWindowResultSchema,
  storyPlanWindowSchema,
  storyStateDeltaSchema,
  storyStateSchema,
  chapterSummarySchema,
  generationMetadataSchema,
  storyBlueprintSchema,
  storySettingsSchema,
  storyThreadSchema,
  threadTransitionSchema,
  type AiUsage,
  type ChapterGenerationEnvelope,
  type ChapterGenerationV2Envelope,
  type ChapterPlanItem,
  type ChapterSummary,
  type ContinuityCheckResult,
  type StoryContextDiagnostic,
  type GenerationMetadata,
  type Id,
  type StoryArc,
  type StoryBlueprintDto,
  type StoryGenerationBatch,
  type StoryImportantEvent,
  type StoryImportantFact,
  type StoryPlanDto,
  type StorySettingsDto,
  type StoryPlanWindowResult,
  type StoryPlanWindowSummary,
  type StoryState,
  type StoryStateDelta,
  type StoryEvent,
  type ThreadTransition,
  type StorySummaryDto,
  type StoryThread,
} from '@studio/shared';
import type { DatabaseHandle } from './db.js';
import { StoryBatchRepository } from './story-batch.js';

const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: string): unknown => JSON.parse(value);
function normalizeThread(input: StoryThread, chapterNumber: number | null = null): StoryThread {
  return storyThreadSchema.parse({
    ...input,
    title: input.title ?? input.id,
    type: input.type ?? 'GOAL',
    importance: input.importance ?? 'MEDIUM',
    lastTouchedChapter: input.lastTouchedChapter ?? chapterNumber ?? input.introducedChapter,
    expectedResolutionStart: input.expectedResolutionStart ?? null,
    expectedResolutionEnd: input.expectedResolutionEnd ?? null,
    abandonedChapter:
      input.abandonedChapter ?? (input.status === 'ABANDONED' ? chapterNumber : null),
  });
}

function parseArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
const safeMetadata = (value: GenerationMetadata | null): GenerationMetadata | null =>
  value ? generationMetadataSchema.parse(value) : null;

export type StoryContinuityCheckRecord = {
  id: Id;
  projectId: Id;
  chapterId: Id;
  chapterRevision: number;
  sourceStateRevisionId: Id | null;
  result: ContinuityCheckResult;
  stateDelta: StoryStateDelta | null;
  summary: ChapterSummary | null;
  acceptedAt: string | null;
};
export type StoryRevisionRef = { id: Id; revision: number };

export class StoryRepository {
  constructor(private readonly database: DatabaseHandle) {}
  private persistCanonicalState(
    projectId: Id,
    state: StoryState,
    delta: StoryStateDelta,
    stateRevisionId: Id,
    sourceChapterId: Id | null,
    stamp: string,
  ): void {
    const changedCharacterIds = new Set(delta.characterUpdates.map((update) => update.characterId));
    const characterById = new Map(
      state.characterStates.map((character) => [character.characterId, character]),
    );
    const upsertCharacter = this.database.sqlite.prepare(
      `INSERT INTO story_character_states(
        id,project_id,character_id,location,current_goal,power_level,injuries,possessions,
        relationships,knowledge,last_updated_chapter,source_state_revision_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,character_id) DO UPDATE SET
        location=excluded.location,current_goal=excluded.current_goal,power_level=excluded.power_level,
        injuries=excluded.injuries,possessions=excluded.possessions,relationships=excluded.relationships,
        knowledge=excluded.knowledge,last_updated_chapter=excluded.last_updated_chapter,
        source_state_revision_id=excluded.source_state_revision_id,updated_at=excluded.updated_at`,
    );
    for (const characterId of changedCharacterIds) {
      const character = characterById.get(characterId);
      if (!character) continue;
      upsertCharacter.run(
        randomUUID(),
        projectId,
        character.characterId,
        character.location,
        character.currentGoal,
        character.powerLevel,
        json(character.injuries),
        json(character.possessions),
        json(character.relationships),
        json(character.knowledge),
        character.lastUpdatedChapter,
        stateRevisionId,
        stamp,
        stamp,
      );
    }

    if (sourceChapterId) {
      const changedThreadIds = new Set([
        ...delta.threadUpdates.map((update) => update.threadId),
        ...delta.newThreads.map((thread) => thread.id),
      ]);
      const threads = new Map(state.threads.map((thread) => [thread.id, thread]));
      for (const threadId of changedThreadIds) {
        const thread = threads.get(threadId);
        if (thread) this.upsertThread(thread, sourceChapterId, stamp);
      }
    }

    const upsertFact = this.database.sqlite.prepare(
      `INSERT INTO story_important_facts(
        id,project_id,stable_id,text,importance,introduced_chapter,last_confirmed_chapter,
        status,source_state_revision_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,stable_id) DO UPDATE SET
        text=excluded.text,importance=excluded.importance,introduced_chapter=excluded.introduced_chapter,
        last_confirmed_chapter=excluded.last_confirmed_chapter,status=excluded.status,
        source_state_revision_id=excluded.source_state_revision_id,updated_at=excluded.updated_at`,
    );
    for (const fact of state.importantFacts)
      upsertFact.run(
        randomUUID(),
        projectId,
        fact.id,
        fact.text,
        fact.importance,
        fact.introducedChapter,
        fact.lastConfirmedChapter,
        fact.status,
        stateRevisionId,
        stamp,
        stamp,
      );

    const upsertEvent = this.database.sqlite.prepare(
      `INSERT INTO story_events(
        id,project_id,stable_id,chapter_number,type,description,importance,character_ids,
        thread_ids,source_state_revision_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,stable_id) DO UPDATE SET
        chapter_number=excluded.chapter_number,type=excluded.type,description=excluded.description,
        importance=excluded.importance,character_ids=excluded.character_ids,thread_ids=excluded.thread_ids,
        source_state_revision_id=excluded.source_state_revision_id`,
    );
    for (const event of state.recentEvents)
      upsertEvent.run(
        randomUUID(),
        projectId,
        event.id,
        event.chapterNumber,
        event.type,
        event.description,
        event.importance,
        json(event.characterIds),
        json(event.threadIds),
        stateRevisionId,
        stamp,
      );

    for (const progress of delta.arcProgress) {
      if (!progress.status) continue;
      this.database.sqlite
        .prepare(
          'UPDATE story_arc_revisions SET status=?,updated_at=? WHERE project_id=? AND stable_id=? AND is_current=1',
        )
        .run(progress.status, stamp, projectId, progress.arcId);
    }
  }
  private replaceCanonicalState(
    projectId: Id,
    state: StoryState,
    delta: StoryStateDelta,
    stateRevisionId: Id,
    sourceChapterId: Id,
    stamp: string,
  ): void {
    const characterUpdates = state.characterStates.map((character) => {
      const { lastUpdatedChapter, ...update } = character;
      void lastUpdatedChapter;
      return update;
    });
    const threadUpdates = state.threads.map((thread) => ({
      threadId: thread.id,
      title: thread.title,
      description: thread.description,
      type: thread.type,
      status: thread.status,
      importance: thread.importance,
      characterIds: thread.characterIds,
      expectedResolutionStart: thread.expectedResolutionStart,
      expectedResolutionEnd: thread.expectedResolutionEnd,
    }));
    this.persistCanonicalState(
      projectId,
      state,
      storyStateDeltaSchema.parse({
        ...delta,
        characterUpdates,
        threadUpdates,
        newThreads: [],
      }),
      stateRevisionId,
      sourceChapterId,
      stamp,
    );

    const characterIds = state.characterStates.map((character) => character.characterId);
    if (characterIds.length) {
      const placeholders = characterIds.map(() => '?').join(',');
      this.database.sqlite
        .prepare(
          `DELETE FROM story_character_states WHERE project_id=? AND character_id NOT IN (${placeholders})`,
        )
        .run(projectId, ...characterIds);
    } else {
      this.database.sqlite
        .prepare('DELETE FROM story_character_states WHERE project_id=?')
        .run(projectId);
    }

    const threadIds = state.threads.map((thread) => thread.id);
    if (threadIds.length) {
      const placeholders = threadIds.map(() => '?').join(',');
      this.database.sqlite
        .prepare(
          `UPDATE story_thread_revisions SET is_current=0 WHERE thread_id IN (
             SELECT id FROM story_threads WHERE project_id=? AND stable_id NOT IN (${placeholders})
           )`,
        )
        .run(projectId, ...threadIds);
    } else {
      this.database.sqlite
        .prepare(
          'UPDATE story_thread_revisions SET is_current=0 WHERE thread_id IN (SELECT id FROM story_threads WHERE project_id=?)',
        )
        .run(projectId);
    }

    const factIds = state.importantFacts.map((fact) => fact.id);
    if (factIds.length) {
      const placeholders = factIds.map(() => '?').join(',');
      this.database.sqlite
        .prepare(
          `DELETE FROM story_important_facts WHERE project_id=? AND stable_id NOT IN (${placeholders})`,
        )
        .run(projectId, ...factIds);
    } else {
      this.database.sqlite
        .prepare('DELETE FROM story_important_facts WHERE project_id=?')
        .run(projectId);
    }

    const eventIds = state.recentEvents.map((event) => event.id);
    if (eventIds.length) {
      const placeholders = eventIds.map(() => '?').join(',');
      this.database.sqlite
        .prepare(
          `DELETE FROM story_events WHERE project_id=? AND stable_id NOT IN (${placeholders})`,
        )
        .run(projectId, ...eventIds);
    } else {
      this.database.sqlite.prepare('DELETE FROM story_events WHERE project_id=?').run(projectId);
    }
  }

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

  getPlan(projectId: Id, limit = 200, offset = 0): StoryPlanDto | null {
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
    const parsedPlan = chapterPlanSchema.parse(parseJson(row.payload));
    return {
      id: row.id,
      projectId: row.projectId,
      revision: row.revision,
      blueprintRevision: blueprint?.revision ?? 0,
      plan: {
        items: parsedPlan.items.slice(
          Math.max(0, offset),
          Math.max(0, offset) + Math.max(1, Math.min(200, limit)),
        ),
      },
      metadata: row.metadata ? safeMetadata(parseJson(row.metadata) as GenerationMetadata) : null,
      createdAt: row.createdAt,
    };
  }

  getPlanItem(projectId: Id, stableId: string): { planId: Id; item: ChapterPlanItem } | null {
    const settings = this.getSettings(projectId);
    const isLongStory = (settings?.targetChapterCount ?? 0) > 20;
    if (isLongStory) {
      const windowRow = this.database.sqlite
        .prepare(
          "SELECT w.id as planId,i.payload FROM story_plan_window_revisions w JOIN story_plan_window_items i ON i.window_revision_id=w.id WHERE w.project_id=? AND w.is_current=1 AND w.status IN ('PLANNED','CURRENT') AND i.stable_id=?",
        )
        .get(projectId, stableId) as { planId: Id; payload: string } | undefined;
      return windowRow
        ? {
            planId: windowRow.planId,
            item: chapterPlanItemSchema.parse(parseJson(windowRow.payload)),
          }
        : null;
    }
    const currentPlanRow = this.database.sqlite
      .prepare(
        'SELECT p.id as planId,i.payload FROM story_plan_revisions p JOIN story_plan_items i ON i.plan_revision_id=p.id WHERE p.project_id=? AND p.is_current=1 AND i.stable_id=?',
      )
      .get(projectId, stableId) as { planId: Id; payload: string } | undefined;
    if (currentPlanRow)
      return {
        planId: currentPlanRow.planId,
        item: chapterPlanItemSchema.parse(parseJson(currentPlanRow.payload)),
      };
    const windowRow = this.database.sqlite
      .prepare(
        "SELECT w.id as planId,i.payload FROM story_plan_window_revisions w JOIN story_plan_window_items i ON i.window_revision_id=w.id WHERE w.project_id=? AND w.is_current=1 AND w.status IN ('PLANNED','CURRENT') AND i.stable_id=?",
      )
      .get(projectId, stableId) as { planId: Id; payload: string } | undefined;
    if (!windowRow) return null;
    return {
      planId: windowRow.planId,
      item: chapterPlanItemSchema.parse(parseJson(windowRow.payload)),
    };
  }
  getPlanItemForChapter(
    projectId: Id,
    chapterNumber: number,
  ): { planId: Id; item: ChapterPlanItem } | null {
    const isLongStory = (this.getSettings(projectId)?.targetChapterCount ?? 0) > 20;
    const rows = this.database.sqlite
      .prepare(
        isLongStory
          ? "SELECT w.id as planId,i.payload FROM story_plan_window_revisions w JOIN story_plan_window_items i ON i.window_revision_id=w.id WHERE w.project_id=? AND w.is_current=1 AND w.status IN ('PLANNED','CURRENT') AND i.chapter_number=? LIMIT 1"
          : `SELECT p.id as planId,i.payload FROM story_plan_revisions p
         JOIN story_plan_items i ON i.plan_revision_id=p.id
         WHERE p.project_id=? AND p.is_current=1 AND i.chapter_number=?
         UNION ALL
         SELECT w.id as planId,i.payload FROM story_plan_window_revisions w
         JOIN story_plan_window_items i ON i.window_revision_id=w.id
         WHERE w.project_id=? AND w.is_current=1 AND w.status IN ('PLANNED','CURRENT') AND i.chapter_number=?
         LIMIT 1`,
      )
      .get(
        ...(isLongStory
          ? [projectId, chapterNumber]
          : [projectId, chapterNumber, projectId, chapterNumber]),
      ) as { planId: Id; payload: string } | undefined;
    return rows
      ? { planId: rows.planId, item: chapterPlanItemSchema.parse(parseJson(rows.payload)) }
      : null;
  }

  savePlan(
    projectId: Id,
    blueprintRevisionId: Id,
    planInput: unknown,
    metadata: GenerationMetadata | null,
    inputFingerprint: string,
  ): StoryPlanDto {
    const plan = chapterPlanSchema.parse(planInput);
    const blueprintRow = this.database.sqlite
      .prepare(
        'SELECT payload FROM story_blueprint_revisions WHERE id=? AND project_id=? AND is_current=1',
      )
      .get(blueprintRevisionId, projectId) as { payload: string } | undefined;
    const settings = this.getSettings(projectId);
    if (!settings) throw new AppError('PREREQUISITE_MISSING', 'Story settings are required', 409);
    if (settings.targetChapterCount > 20)
      throw new AppError(
        'INVALID_PLAN',
        'Stories over 20 chapters require arcs and bounded planning windows',
        422,
      );
    if (!blueprintRow || !settings)
      throw new AppError('STALE_INPUT', 'Story plan source revisions are no longer current', 409);
    const blueprint = storyBlueprintSchema.parse(parseJson(blueprintRow.payload));
    const itemIds = new Set(plan.items.map((item) => item.id));
    if (itemIds.size !== plan.items.length)
      throw new AppError('INVALID_PLAN', 'Chapter plan item identifiers must be unique', 422);
    const characterIds = new Set(blueprint.characters.map((character) => character.id));
    if (
      plan.items.some(
        (item) =>
          item.chapterNumber > settings.targetChapterCount ||
          item.characterIds.some((characterId) => !characterIds.has(characterId)),
      )
    )
      throw new AppError(
        'INVALID_PLAN',
        'Chapter plan references an unknown character or target',
        422,
      );
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
        'SELECT id,chapter_id as chapterId,chapter_revision as chapterRevision,revision,payload,events,thread_transitions as threadTransitions,warnings,metadata,created_at as createdAt FROM story_summary_revisions WHERE chapter_id=? AND is_current=1',
      )
      .get(chapterId) as
      | {
          id: Id;
          chapterId: Id;
          chapterRevision: number;
          revision: number;
          payload: string;
          events: string;
          threadTransitions: string;
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
      events: storyEventSchema.array().parse(parseJson(row.events)),
      threadTransitions: threadTransitionSchema.array().parse(parseJson(row.threadTransitions)),
      threads: this.getThreads(chapter?.projectId),
      warnings: JSON.parse(row.warnings) as string[],
      metadata: row.metadata ? safeMetadata(parseJson(row.metadata) as GenerationMetadata) : null,
      createdAt: row.createdAt,
    };
  }

  getSummaries(projectId: Id, limit = 200, offset = 0): StorySummaryDto[] {
    const chapters = this.database.sqlite
      .prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY number LIMIT ? OFFSET ?')
      .all(projectId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as Array<{ id: Id }>;
    return chapters.flatMap((chapter) => {
      const summary = this.getSummary(chapter.id);
      return summary ? [summary] : [];
    });
  }
  getSummaryContext(
    projectId: Id,
    beforeChapter: number,
    limit = 6,
  ): Array<{ chapterNumber: number; revision: number; summary: ChapterSummary }> {
    const rows = this.database.sqlite
      .prepare(
        `SELECT c.number as chapterNumber,s.revision,s.payload
         FROM chapters c
         JOIN story_summary_revisions s ON s.chapter_id=c.id AND s.is_current=1 AND s.status='CURRENT'
         WHERE c.project_id=? AND c.number<?
         ORDER BY c.number DESC
         LIMIT ?`,
      )
      .all(projectId, beforeChapter, Math.max(1, Math.min(20, limit))) as Array<{
      chapterNumber: number;
      revision: number;
      payload: string;
    }>;
    return rows.flatMap((row) => {
      try {
        const summary = chapterSummarySchema.safeParse(parseJson(row.payload));
        return summary.success
          ? [{ chapterNumber: row.chapterNumber, revision: row.revision, summary: summary.data }]
          : [];
      } catch {
        return [];
      }
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
    eventsInput: unknown[] = [],
    threadTransitionsInput: unknown[] = [],
  ): StorySummaryDto {
    const summary = chapterSummarySchema.parse(summaryInput);
    const events = eventsInput.map((event) => storyEventSchema.parse(event)) as StoryEvent[];
    const threadTransitions = threadTransitionsInput.map((transition) =>
      threadTransitionSchema.parse(transition),
    ) as ThreadTransition[];
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
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,events,thread_transitions,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          chapterId,
          chapterRevision,
          current.revision + 1,
          json(summary),
          json(events),
          json(threadTransitions),
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
    const parsed = storyThreadSchema.parse(threadInput);
    const chapter = this.database.sqlite
      .prepare('SELECT number FROM chapters WHERE id=?')
      .get(chapterId) as { number: number } | undefined;
    const thread = normalizeThread(parsed, chapter?.number ?? null);
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
      .prepare('UPDATE story_thread_revisions SET is_current=0 WHERE thread_id=?')
      .run(threadId);
    this.database.sqlite
      .prepare(
        'INSERT INTO story_thread_revisions(id,thread_id,revision,source_chapter_id,payload,is_current,created_at) VALUES(?,?,?,?,?,1,?)',
      )
      .run(randomUUID(), threadId, current.revision + 1, chapterId, json(thread), stamp);
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
  getCompletedChapterV2Commit(
    projectId: Id,
    planItemId: string,
    workflowStepId: Id,
    inputFingerprint?: string,
  ): {
    chapterId: Id;
    chapterRevision: number;
    stateRevisionId: Id;
    deltaId: Id;
    state: StoryState;
  } | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT c.id as chapterId,c.revision as chapterRevision,s.id as stateRevisionId,
          s.payload as statePayload,d.id as deltaId
         FROM story_generation_records g
         JOIN chapters c ON c.story_generation_id=g.id
         JOIN story_state_revisions s
           ON s.source_chapter_id=c.id AND s.source_chapter_revision=c.revision
         JOIN story_state_deltas d
           ON d.source_generation_id=g.id AND d.target_state_revision_id=s.id
         WHERE g.project_id=? AND g.operation='CHAPTER_GENERATION_V2'
           AND g.target_id=? AND g.workflow_step_id=?
           AND (? IS NULL OR g.input_fingerprint=?)
           AND g.status='COMPLETED'
         ORDER BY g.created_at DESC LIMIT 1`,
      )
      .get(
        projectId,
        planItemId,
        workflowStepId,
        inputFingerprint ?? null,
        inputFingerprint ?? null,
      ) as
      | {
          chapterId: Id;
          chapterRevision: number;
          stateRevisionId: Id;
          statePayload: string;
          deltaId: Id;
        }
      | undefined;
    return row
      ? {
          chapterId: row.chapterId,
          chapterRevision: row.chapterRevision,
          stateRevisionId: row.stateRevisionId,
          deltaId: row.deltaId,
          state: storyStateSchema.parse(parseJson(row.statePayload)),
        }
      : null;
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
        'SELECT id,number,revision,story_origin as origin FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
      )
      .get(input.projectId, input.planItemId) as
      { id: Id; number: number; revision: number; origin: string } | undefined;
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
      let chapterNumber: number;
      let chapterRevision: number;
      if (existing) {
        chapterId = existing.id;
        chapterNumber = existing.number;
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
        chapterNumber = max.next;
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
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,events,thread_transitions,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          summaryId,
          chapterId,
          chapterRevision,
          current.revision + 1,
          json(envelope.summary),
          json(envelope.events),
          json(envelope.threadTransitions),
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
      const existingThreads = new Map(
        this.getThreads(input.projectId).map((thread) => [thread.id, thread]),
      );
      for (const transition of envelope.threadTransitions) {
        const existingThread = existingThreads.get(transition.threadId);
        this.upsertThread(
          existingThread
            ? {
                ...existingThread,
                status: transition.status,
                resolvedChapter:
                  transition.status === 'RESOLVED' ? chapterNumber : existingThread.resolvedChapter,
              }
            : {
                id: transition.threadId,
                description: transition.note,
                status: transition.status,
                characterIds: envelope.characterStateChanges
                  .filter((change) => change.characterId)
                  .map((change) => change.characterId),
                introducedChapter: chapterNumber,
                resolvedChapter: transition.status === 'RESOLVED' ? chapterNumber : null,
              },
          chapterId,
          stamp,
        );
      }
      if (existing) {
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET continuity_status='CURRENT',continuity_check_status=NULL WHERE id=?",
          )
          .run(chapterId);
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND number>? AND story_origin='GENERATED'",
          )
          .run(input.projectId, chapterNumber);
        this.database.sqlite
          .prepare(
            "UPDATE story_chapter_lineage SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND chapter_id IN (SELECT id FROM chapters WHERE project_id=? AND number>? AND story_origin='GENERATED')",
          )
          .run(input.projectId, input.projectId, chapterNumber);
        this.database.sqlite
          .prepare(
            "UPDATE story_generation_batches SET status='PAUSED',updated_at=? WHERE project_id=? AND end_chapter>? AND status IN ('PENDING','RUNNING')",
          )
          .run(stamp, input.projectId, chapterNumber);
      }
      return { chapterId, chapterRevision };
    })();
    return result;
  }

  commitGeneratedChapterV2(input: {
    projectId: Id;
    planItemId: string;
    generationId: Id;
    workflowStepId?: Id | null;
    envelope: ChapterGenerationV2Envelope;
    state: StoryState;
    metadata: GenerationMetadata;
    usage?: AiUsage | null;
    inputFingerprint: string;
  }): {
    chapterId: Id;
    chapterRevision: number;
    stateRevisionId: Id;
    deltaId: Id;
    state: StoryState;
  } {
    const envelope = chapterGenerationV2EnvelopeSchema.parse(input.envelope);
    const state = storyStateSchema.parse(input.state);
    const delta = storyStateDeltaSchema.parse(envelope.stateDelta);
    const metadata = generationMetadataSchema.parse(input.metadata);
    const usage = input.usage ? aiUsageSchema.parse(input.usage) : null;
    if (state.projectId !== input.projectId)
      throw new AppError(
        'STRUCTURED_OUTPUT_ERROR',
        'StoryState project does not match the generation project',
        422,
      );
    const planItem = this.getPlanItem(input.projectId, input.planItemId);
    if (!planItem)
      throw new AppError('PREREQUISITE_MISSING', 'A current chapter plan item is required', 409);
    if (planItem.item.id !== input.planItemId)
      throw new AppError('STRUCTURED_OUTPUT_ERROR', 'Generation plan item identity changed', 422);
    if (state.currentChapter !== planItem.item.chapterNumber)
      throw new AppError(
        'CONTINUITY_ERROR',
        'Chapter generation must advance from the current continuity checkpoint',
        409,
      );

    const result = this.database.sqlite.transaction(() => {
      const generation = this.database.sqlite
        .prepare('SELECT status FROM story_generation_records WHERE id=? AND project_id=?')
        .get(input.generationId, input.projectId) as { status: string } | undefined;
      if (!generation)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Generation record is required before chapter commit',
          409,
        );
      if (generation.status === 'COMPLETED') {
        const completedChapter = this.database.sqlite
          .prepare(
            'SELECT id,revision FROM chapters WHERE project_id=? AND story_generation_id=? ORDER BY revision DESC LIMIT 1',
          )
          .get(input.projectId, input.generationId) as { id: Id; revision: number } | undefined;
        const completedState = this.database.sqlite
          .prepare(
            'SELECT id,payload FROM story_state_revisions WHERE project_id=? AND source_chapter_id=? ORDER BY revision DESC LIMIT 1',
          )
          .get(input.projectId, completedChapter?.id ?? null) as
          { id: Id; payload: string } | undefined;
        const completedDelta = this.database.sqlite
          .prepare(
            'SELECT id FROM story_state_deltas WHERE project_id=? AND source_generation_id=? ORDER BY created_at DESC LIMIT 1',
          )
          .get(input.projectId, input.generationId) as { id: Id } | undefined;
        if (completedChapter && completedState && completedDelta)
          return {
            chapterId: completedChapter.id,
            chapterRevision: completedChapter.revision,
            stateRevisionId: completedState.id,
            deltaId: completedDelta.id,
            state: storyStateSchema.parse(parseJson(completedState.payload)),
          };
        throw new AppError(
          'STALE_INPUT',
          'Generation record is already completed without a valid checkpoint',
          409,
        );
      }
      if (
        input.workflowStepId &&
        !this.database.sqlite
          .prepare(
            "SELECT 1 FROM workflow_steps WHERE id=? AND status='RUNNING' AND input_fingerprint=?",
          )
          .get(input.workflowStepId, input.inputFingerprint)
      )
        throw new AppError('STALE_INPUT', 'Story generation input changed before commit', 409);

      const currentState = this.database.sqlite
        .prepare(
          'SELECT id,revision FROM story_state_revisions WHERE project_id=? AND is_current=1',
        )
        .get(input.projectId) as { id: Id; revision: number } | undefined;
      if (!currentState)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Current StoryState checkpoint is required',
          409,
        );
      const baseState = state.previousRevision
        ? (this.database.sqlite
            .prepare(
              'SELECT id,revision,current_chapter as currentChapter FROM story_state_revisions WHERE project_id=? AND revision=?',
            )
            .get(input.projectId, state.previousRevision) as
            { id: Id; revision: number; currentChapter: number } | undefined)
        : undefined;
      const historical = state.previousRevision !== currentState.revision;
      if (!historical && state.revision !== currentState.revision + 1)
        throw new AppError(
          'STALE_INPUT',
          'StoryState checkpoint changed before chapter commit',
          409,
        );
      if (
        historical &&
        (!baseState || baseState.currentChapter !== planItem.item.chapterNumber - 1)
      )
        throw new AppError(
          'CONTINUITY_ERROR',
          'Historical chapter generation requires a valid preceding checkpoint',
          409,
        );

      const existing = this.database.sqlite
        .prepare(
          'SELECT id,number,revision,story_origin as origin FROM chapters WHERE project_id=? AND story_plan_item_id=? ORDER BY revision DESC LIMIT 1',
        )
        .get(input.projectId, input.planItemId) as
        { id: Id; number: number; revision: number; origin: string } | undefined;
      const occupied = this.database.sqlite
        .prepare(
          'SELECT id,story_plan_item_id as planItemId,story_origin as origin FROM chapters WHERE project_id=? AND number=?',
        )
        .get(input.projectId, planItem.item.chapterNumber) as
        { id: Id; planItemId: string | null; origin: string } | undefined;
      if (occupied && occupied.id !== existing?.id) {
        throw new AppError(
          occupied.origin === 'MANUAL' ? 'MANUAL_EDIT_CONFLICT' : 'STALE_INPUT',
          'The planned chapter number is already occupied by another chapter',
          409,
        );
      }
      if (existing?.origin === 'MANUAL')
        throw new AppError(
          'MANUAL_EDIT_CONFLICT',
          'A newer manual chapter revision must be reviewed before regeneration',
          409,
        );

      const stamp = now();
      const chapterId = existing?.id ?? randomUUID();
      const chapterRevision = (existing?.revision ?? 0) + 1;
      if (existing) {
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET title=?,content=?,revision=?,story_origin='GENERATED',story_generation_id=?,continuity_status='CURRENT',source_state_revision=?,continuity_check_status=NULL,updated_at=? WHERE id=?",
          )
          .run(
            envelope.title,
            envelope.content,
            chapterRevision,
            input.generationId,
            currentState.revision + 1,
            stamp,
            chapterId,
          );
      } else {
        this.database.sqlite
          .prepare(
            "INSERT INTO chapters(id,project_id,number,title,content,revision,story_origin,story_plan_item_id,story_generation_id,continuity_status,source_state_revision,continuity_check_status,created_at,updated_at) VALUES(?,?,?,?,?,?,'GENERATED',?,?, 'CURRENT',?,NULL,?,?)",
          )
          .run(
            chapterId,
            input.projectId,
            planItem.item.chapterNumber,
            envelope.title,
            envelope.content,
            chapterRevision,
            input.planItemId,
            input.generationId,
            currentState.revision + 1,
            stamp,
            stamp,
          );
      }

      const persistedState = storyStateSchema.parse({
        ...state,
        revision: currentState.revision + 1,
        currentChapter: planItem.item.chapterNumber,
        sourceChapterId: chapterId,
        sourceChapterRevision: chapterRevision,
        previousRevision: historical ? baseState!.revision : currentState.revision,
        updatedAt: stamp,
      });
      const stateRevisionId = randomUUID();
      this.database.sqlite
        .prepare(
          "UPDATE story_state_revisions SET is_current=0,status='SUPERSEDED',updated_at=? WHERE project_id=? AND is_current=1",
        )
        .run(stamp, input.projectId);
      this.database.sqlite
        .prepare(
          "INSERT INTO story_state_revisions(id,project_id,revision,current_chapter,source_chapter_id,source_chapter_revision,previous_revision_id,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'CURRENT',1,?,?)",
        )
        .run(
          stateRevisionId,
          input.projectId,
          persistedState.revision,
          persistedState.currentChapter,
          chapterId,
          chapterRevision,
          historical ? baseState!.id : currentState.id,
          json(persistedState),
          input.inputFingerprint,
          stamp,
          stamp,
        );

      const summaryEvents = delta.events.slice(0, 100).map((event) => ({
        description: event.description,
        importance: event.importance,
        characterIds: event.characterIds,
      }));
      const transitions = delta.threadUpdates
        .filter((transition) => transition.status !== undefined)
        .slice(0, 100)
        .map((transition) => ({
          threadId: transition.threadId,
          status: transition.status!,
          note: transition.note ?? null,
        }));
      const currentSummary = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0) as revision FROM story_summary_revisions WHERE chapter_id=?',
        )
        .get(chapterId) as { revision: number };
      const summaryId = randomUUID();
      this.database.sqlite
        .prepare(
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,events,thread_transitions,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          summaryId,
          chapterId,
          chapterRevision,
          currentSummary.revision + 1,
          json(envelope.summary),
          json(summaryEvents),
          json(transitions),
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

      const changedCharacterIds = historical
        ? new Set<string>()
        : new Set(delta.characterUpdates.map((update) => update.characterId));
      const upsertCharacter = this.database.sqlite.prepare(
        `INSERT INTO story_character_states(
          id,project_id,character_id,location,current_goal,power_level,injuries,possessions,
          relationships,knowledge,last_updated_chapter,source_state_revision_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,character_id) DO UPDATE SET
          location=excluded.location,current_goal=excluded.current_goal,power_level=excluded.power_level,
          injuries=excluded.injuries,possessions=excluded.possessions,relationships=excluded.relationships,
          knowledge=excluded.knowledge,last_updated_chapter=excluded.last_updated_chapter,
          source_state_revision_id=excluded.source_state_revision_id,updated_at=excluded.updated_at`,
      );
      for (const character of persistedState.characterStates) {
        if (!changedCharacterIds.has(character.characterId)) continue;
        upsertCharacter.run(
          randomUUID(),
          input.projectId,
          character.characterId,
          character.location,
          character.currentGoal,
          character.powerLevel,
          json(character.injuries),
          json(character.possessions),
          json(character.relationships),
          json(character.knowledge),
          character.lastUpdatedChapter,
          stateRevisionId,
          stamp,
          stamp,
        );
      }

      const threads = new Map(persistedState.threads.map((thread) => [thread.id, thread]));
      const changedThreadIds = historical
        ? new Set<string>()
        : new Set([
            ...delta.threadUpdates.map((update) => update.threadId),
            ...delta.newThreads.map((thread) => thread.id),
          ]);
      for (const threadId of changedThreadIds) {
        const thread = threads.get(threadId);
        if (thread) this.upsertThread(thread, chapterId, stamp);
      }

      const upsertFact = this.database.sqlite.prepare(
        `INSERT INTO story_important_facts(
          id,project_id,stable_id,text,importance,introduced_chapter,last_confirmed_chapter,
          status,source_state_revision_id,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,stable_id) DO UPDATE SET
          text=excluded.text,importance=excluded.importance,introduced_chapter=excluded.introduced_chapter,
          last_confirmed_chapter=excluded.last_confirmed_chapter,status=excluded.status,
          source_state_revision_id=excluded.source_state_revision_id,updated_at=excluded.updated_at`,
      );
      for (const fact of delta.facts) {
        upsertFact.run(
          randomUUID(),
          input.projectId,
          fact.id,
          fact.text,
          fact.importance,
          fact.introducedChapter,
          fact.lastConfirmedChapter,
          fact.status,
          stateRevisionId,
          stamp,
          stamp,
        );
      }

      const upsertEvent = this.database.sqlite.prepare(
        `INSERT INTO story_events(
          id,project_id,stable_id,chapter_number,type,description,importance,character_ids,
          thread_ids,source_state_revision_id,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,stable_id) DO UPDATE SET
          chapter_number=excluded.chapter_number,type=excluded.type,description=excluded.description,
          importance=excluded.importance,character_ids=excluded.character_ids,thread_ids=excluded.thread_ids,
          source_state_revision_id=excluded.source_state_revision_id`,
      );
      for (const event of delta.events) {
        upsertEvent.run(
          randomUUID(),
          input.projectId,
          event.id,
          event.chapterNumber,
          event.type,
          event.description,
          event.importance,
          json(event.characterIds),
          json(event.threadIds),
          stateRevisionId,
          stamp,
        );
      }

      for (const progress of delta.arcProgress) {
        if (!progress.status) continue;
        this.database.sqlite
          .prepare(
            'UPDATE story_arc_revisions SET status=?,updated_at=? WHERE project_id=? AND stable_id=? AND is_current=1',
          )
          .run(progress.status, stamp, input.projectId, progress.arcId);
      }
      if (historical)
        this.replaceCanonicalState(
          input.projectId,
          persistedState,
          delta,
          stateRevisionId,
          chapterId,
          stamp,
        );

      const deltaId = randomUUID();
      this.database.sqlite
        .prepare(
          'INSERT INTO story_state_deltas(id,project_id,source_chapter_id,source_chapter_revision,source_generation_id,target_state_revision_id,payload,validation_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          deltaId,
          input.projectId,
          chapterId,
          chapterRevision,
          input.generationId,
          stateRevisionId,
          json(delta),
          'VALID',
          stamp,
        );
      this.database.sqlite
        .prepare(
          'INSERT INTO story_chapter_lineage(id,project_id,chapter_id,chapter_revision,source_state_revision_id,source_generation_id,continuity_status,continuity_check_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          input.projectId,
          chapterId,
          chapterRevision,
          stateRevisionId,
          input.generationId,
          'CURRENT',
          null,
          stamp,
        );
      this.database.sqlite
        .prepare(
          "UPDATE chapters SET source_state_revision=?,continuity_status='CURRENT',continuity_check_status=NULL,updated_at=? WHERE id=?",
        )
        .run(persistedState.revision, stamp, chapterId);
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_records SET status='COMPLETED',metadata=?,error=NULL,completed_at=? WHERE id=?",
        )
        .run(json(metadata), stamp, input.generationId);

      if (usage) {
        this.database.sqlite
          .prepare(
            'INSERT INTO ai_usage(id,project_id,operation,entity_id,attempt,provider,model,input_tokens,output_tokens,duration_ms,cost_usd,currency,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            usage.id,
            usage.projectId,
            usage.operation,
            usage.entityId,
            usage.attempt,
            usage.provider,
            usage.model,
            usage.inputTokens,
            usage.outputTokens,
            usage.durationMs,
            usage.costUsd,
            usage.currency,
            usage.status,
            usage.createdAt,
          );
      }

      if (existing) {
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND number>? AND story_origin='GENERATED'",
          )
          .run(input.projectId, planItem.item.chapterNumber);
        this.database.sqlite
          .prepare(
            "UPDATE story_chapter_lineage SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND chapter_id IN (SELECT id FROM chapters WHERE project_id=? AND number>? AND story_origin='GENERATED')",
          )
          .run(input.projectId, input.projectId, planItem.item.chapterNumber);
        this.database.sqlite
          .prepare(
            "UPDATE story_generation_batches SET status='PAUSED',updated_at=? WHERE project_id=? AND end_chapter>? AND status IN ('PENDING','RUNNING')",
          )
          .run(stamp, input.projectId, planItem.item.chapterNumber);
      }
      return {
        chapterId,
        chapterRevision,
        stateRevisionId,
        deltaId,
        state: persistedState,
      };
    })();
    return result;
  }

  getArcs(projectId: Id): StoryArc[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id,a.stable_id as stableId,a.revision,a.ordinal_index as ordinalIndex,
          a.start_chapter as startChapter,a.end_chapter as endChapter,a.title,a.goal,a.conflict,
          a.important_character_ids as importantCharacterIds,
          a.important_thread_ids as importantThreadIds,a.planned_outcome as plannedOutcome,
          a.status,b.revision as sourceBlueprintRevision,a.input_fingerprint as inputFingerprint
         FROM story_arc_revisions a
         JOIN story_blueprint_revisions b ON b.id=a.source_blueprint_revision_id
         WHERE a.project_id=? AND a.is_current=1 ORDER BY a.ordinal_index,a.start_chapter`,
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      storyArcSchema.parse({
        id: row.stableId,
        ordinalIndex: row.ordinalIndex,
        startChapter: row.startChapter,
        endChapter: row.endChapter,
        title: row.title,
        goal: row.goal,
        conflict: row.conflict,
        importantCharacterIds: parseArray(row.importantCharacterIds as string),
        importantThreadIds: parseArray(row.importantThreadIds as string),
        plannedOutcome: row.plannedOutcome,
        status: row.status,
        sourceBlueprintRevision: row.sourceBlueprintRevision,
        inputFingerprint: row.inputFingerprint,
      }),
    );
  }

  getArc(projectId: Id, stableId: string): StoryArc | null {
    return this.getArcs(projectId).find((arc) => arc.id === stableId) ?? null;
  }

  saveArcs(
    projectId: Id,
    blueprintRevision: number,
    input: unknown,
    metadata: unknown = null,
    inputFingerprint: string | null = null,
  ): StoryArc[] {
    const plan = storyArcPlanSchema.parse(input);
    const blueprint = this.getBlueprint(projectId);
    const settings = this.getSettings(projectId);
    if (!blueprint || !settings || blueprint.revision !== blueprintRevision)
      throw new AppError('STALE_INPUT', 'Blueprint revision is no longer current', 409);
    const characterIds = new Set(blueprint.blueprint.characters.map((character) => character.id));
    const threadIds = new Set(this.getThreads(projectId).map((thread) => thread.id));
    const arcs = [...plan.arcs].sort((left, right) => left.startChapter - right.startChapter);
    let expectedChapter = 1;
    for (const [index, arc] of arcs.entries()) {
      if (
        arc.ordinalIndex !== index + 1 ||
        arc.startChapter !== expectedChapter ||
        arc.importantCharacterIds.some((id) => !characterIds.has(id)) ||
        arc.importantThreadIds.some((id) => !threadIds.has(id))
      )
        throw new AppError('INVALID_ARC_PLAN', 'Arc ranges or references are invalid', 422);
      expectedChapter = arc.endChapter + 1;
    }
    if (expectedChapter - 1 !== settings.targetChapterCount)
      throw new AppError('INVALID_ARC_PLAN', 'Arc ranges must cover the configured target', 422);
    const blueprintRef = this.getBlueprintRevision(projectId, blueprintRevision);
    if (!blueprintRef)
      throw new AppError('PREREQUISITE_MISSING', 'Blueprint revision is missing', 409);
    const stamp = now();
    this.database.sqlite.transaction(() => {
      const priorCurrentArcs = this.database.sqlite
        .prepare(
          'SELECT id,stable_id as stableId FROM story_arc_revisions WHERE project_id=? AND is_current=1',
        )
        .all(projectId) as Array<{ id: Id; stableId: string }>;
      const retainedArcIds = new Set(arcs.map((arc) => arc.id));
      for (const prior of priorCurrentArcs) {
        if (retainedArcIds.has(prior.stableId)) continue;
        this.database.sqlite
          .prepare(
            "UPDATE story_arc_revisions SET is_current=0,status='STALE',updated_at=? WHERE id=? AND is_current=1",
          )
          .run(stamp, prior.id);
      }
      if (priorCurrentArcs.length) {
        const placeholders = priorCurrentArcs.map(() => '?').join(',');
        this.database.sqlite
          .prepare(
            `UPDATE story_plan_window_revisions SET status='STALE',updated_at=? WHERE project_id=? AND is_current=1 AND arc_id IN (${placeholders})`,
          )
          .run(stamp, projectId, ...priorCurrentArcs.map((arc) => arc.id));
      }
      for (const arc of arcs) {
        const current = this.database.sqlite
          .prepare(
            'SELECT COALESCE(MAX(revision),0) as revision FROM story_arc_revisions WHERE project_id=? AND stable_id=?',
          )
          .get(projectId, arc.id) as { revision: number };
        this.database.sqlite
          .prepare(
            'INSERT INTO story_arc_revisions(id,project_id,stable_id,revision,ordinal_index,start_chapter,end_chapter,title,goal,conflict,important_character_ids,important_thread_ids,planned_outcome,status,source_blueprint_revision_id,input_fingerprint,metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
          )
          .run(
            randomUUID(),
            projectId,
            arc.id,
            current.revision + 1,
            arc.ordinalIndex,
            arc.startChapter,
            arc.endChapter,
            arc.title,
            arc.goal,
            arc.conflict,
            json(arc.importantCharacterIds),
            json(arc.importantThreadIds),
            arc.plannedOutcome,
            arc.status,
            blueprintRef.id,
            inputFingerprint,
            metadata ? json(metadata) : null,
            stamp,
            stamp,
          );
        this.database.sqlite
          .prepare(
            'UPDATE story_arc_revisions SET is_current=0,updated_at=? WHERE project_id=? AND stable_id=? AND is_current=1',
          )
          .run(stamp, projectId, arc.id);
        const currentId = this.database.sqlite
          .prepare(
            'SELECT id FROM story_arc_revisions WHERE project_id=? AND stable_id=? AND revision=?',
          )
          .get(projectId, arc.id, current.revision + 1) as { id: Id };
        this.database.sqlite
          .prepare('UPDATE story_arc_revisions SET is_current=1,updated_at=? WHERE id=?')
          .run(stamp, currentId.id);
      }
    })();
    return this.getArcs(projectId);
  }
  saveArc(
    projectId: Id,
    input: unknown,
    metadata: unknown = null,
    inputFingerprint: string | null = null,
  ): StoryArc {
    const arc = storyArcSchema.parse(input);
    const blueprint = this.getBlueprint(projectId);
    const settings = this.getSettings(projectId);
    if (!blueprint || !settings || arc.sourceBlueprintRevision !== blueprint.revision)
      throw new AppError('STALE_INPUT', 'Blueprint revision is no longer current', 409);
    const currentArcs = this.getArcs(projectId);
    if (!currentArcs.some((candidate) => candidate.id === arc.id))
      throw new AppError('NOT_FOUND', 'Arc not found', 404);
    const merged = currentArcs
      .map((candidate) => (candidate.id === arc.id ? arc : candidate))
      .sort((left, right) => left.startChapter - right.startChapter);
    const characterIds = new Set(blueprint.blueprint.characters.map((character) => character.id));
    const threadIds = new Set(this.getThreads(projectId).map((thread) => thread.id));
    let expectedChapter = 1;
    for (const [index, candidate] of merged.entries()) {
      if (
        candidate.ordinalIndex !== index + 1 ||
        candidate.startChapter !== expectedChapter ||
        candidate.importantCharacterIds.some((id) => !characterIds.has(id)) ||
        candidate.importantThreadIds.some((id) => !threadIds.has(id))
      )
        throw new AppError('INVALID_ARC_PLAN', 'Arc ranges or references are invalid', 422);
      expectedChapter = candidate.endChapter + 1;
    }
    if (expectedChapter - 1 !== settings.targetChapterCount)
      throw new AppError('INVALID_ARC_PLAN', 'Arc ranges must cover the configured target', 422);
    const blueprintRef = this.getBlueprintRevision(projectId, blueprint.revision);
    if (!blueprintRef)
      throw new AppError('PREREQUISITE_MISSING', 'Blueprint revision is missing', 409);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_arc_revisions WHERE project_id=? AND stable_id=?',
      )
      .get(projectId, arc.id) as { revision: number };
    const stamp = now();
    const revisionId = randomUUID();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_arc_revisions(id,project_id,stable_id,revision,ordinal_index,start_chapter,end_chapter,title,goal,conflict,important_character_ids,important_thread_ids,planned_outcome,status,source_blueprint_revision_id,input_fingerprint,metadata,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
        )
        .run(
          revisionId,
          projectId,
          arc.id,
          current.revision + 1,
          arc.ordinalIndex,
          arc.startChapter,
          arc.endChapter,
          arc.title,
          arc.goal,
          arc.conflict,
          json(arc.importantCharacterIds),
          json(arc.importantThreadIds),
          arc.plannedOutcome,
          arc.status,
          blueprintRef.id,
          inputFingerprint,
          metadata ? json(metadata) : null,
          stamp,
          stamp,
        );
      this.database.sqlite
        .prepare(
          'UPDATE story_arc_revisions SET is_current=0,updated_at=? WHERE project_id=? AND stable_id=? AND is_current=1',
        )
        .run(stamp, projectId, arc.id);
      this.database.sqlite
        .prepare('UPDATE story_arc_revisions SET is_current=1,updated_at=? WHERE id=?')
        .run(stamp, revisionId);
    })();
    return this.getArc(projectId, arc.id)!;
  }

  markArcDependentsStale(projectId: Id, arcId: string): string[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT DISTINCT i.stable_id as planItemId
         FROM story_plan_window_revisions w
         JOIN story_arc_revisions a ON a.id=w.arc_id
         JOIN story_plan_window_items i ON i.window_revision_id=w.id
         WHERE w.project_id=? AND w.is_current=1 AND a.stable_id=?`,
      )
      .all(projectId, arcId) as Array<{ planItemId: string }>;
    const stamp = now();
    this.database.sqlite
      .prepare(
        `UPDATE story_plan_window_revisions SET status='STALE',updated_at=?
         WHERE project_id=? AND is_current=1 AND arc_id IN (
           SELECT id FROM story_arc_revisions WHERE project_id=? AND stable_id=?
         )`,
      )
      .run(stamp, projectId, projectId, arcId);
    return rows.map((row) => row.planItemId);
  }

  getPlanWindows(projectId: Id): StoryPlanWindowResult[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT stable_id as stableId,revision,start_chapter as startChapter,end_chapter as endChapter,arc_id as arcId,source_blueprint_revision_id as sourceBlueprintRevisionId,prior_window_summary as priorWindowSummary,input_fingerprint as inputFingerprint,status FROM story_plan_window_revisions WHERE project_id=? AND is_current=1 ORDER BY start_chapter',
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const blueprint = this.database.sqlite
        .prepare('SELECT revision FROM story_blueprint_revisions WHERE id=?')
        .get(row.sourceBlueprintRevisionId) as { revision: number } | undefined;
      const arc = this.database.sqlite
        .prepare('SELECT stable_id as stableId FROM story_arc_revisions WHERE id=?')
        .get(row.arcId) as { stableId: string } | undefined;
      const window = storyPlanWindowSchema.parse({
        id: row.stableId,
        startChapter: row.startChapter,
        endChapter: row.endChapter,
        arcId: arc?.stableId ?? '',
        sourceBlueprintRevision: blueprint?.revision ?? 0,
        priorWindowSummary: row.priorWindowSummary,
        inputFingerprint: row.inputFingerprint,
        status: row.status,
      });
      const itemRows = this.database.sqlite
        .prepare(
          'SELECT payload FROM story_plan_window_items WHERE window_revision_id=(SELECT id FROM story_plan_window_revisions WHERE project_id=? AND stable_id=? AND is_current=1) ORDER BY chapter_number',
        )
        .all(projectId, window.id) as Array<{ payload: string }>;
      const items = itemRows.map((item) => chapterPlanItemSchema.parse(parseJson(item.payload)));
      return storyPlanWindowResultSchema.parse({ window, items });
    });
  }
  getPlanWindowSummaries(projectId: Id, limit = 100, offset = 0): StoryPlanWindowSummary[] {
    const rows = this.database.sqlite
      .prepare(
        `SELECT w.stable_id as stableId,w.revision,w.start_chapter as startChapter,
          w.end_chapter as endChapter,w.arc_id as arcId,
          w.source_blueprint_revision_id as sourceBlueprintRevisionId,
          w.prior_window_summary as priorWindowSummary,w.input_fingerprint as inputFingerprint,
          w.status,
          (SELECT COUNT(*) FROM story_plan_window_items i WHERE i.window_revision_id=w.id) as itemCount
         FROM story_plan_window_revisions w
         WHERE w.project_id=? AND w.is_current=1
         ORDER BY w.start_chapter
         LIMIT ? OFFSET ?`,
      )
      .all(projectId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => {
      const blueprint = this.database.sqlite
        .prepare('SELECT revision FROM story_blueprint_revisions WHERE id=?')
        .get(row.sourceBlueprintRevisionId) as { revision: number } | undefined;
      const arc = this.database.sqlite
        .prepare('SELECT stable_id as stableId FROM story_arc_revisions WHERE id=?')
        .get(row.arcId) as { stableId: string } | undefined;
      return {
        window: storyPlanWindowSchema.parse({
          id: row.stableId,
          startChapter: row.startChapter,
          endChapter: row.endChapter,
          arcId: arc?.stableId ?? '',
          sourceBlueprintRevision: blueprint?.revision ?? 0,
          priorWindowSummary: row.priorWindowSummary,
          inputFingerprint: row.inputFingerprint,
          status: row.status,
        }),
        itemCount: Number(row.itemCount),
      };
    });
  }

  getPlanWindow(projectId: Id, stableId: string): StoryPlanWindowResult | null {
    return this.getPlanWindows(projectId).find((window) => window.window.id === stableId) ?? null;
  }

  savePlanWindow(
    projectId: Id,
    input: unknown,
    inputFingerprint: string | null = null,
  ): StoryPlanWindowResult {
    const result = storyPlanWindowResultSchema.parse(input);
    if (result.items.length !== result.window.endChapter - result.window.startChapter + 1)
      throw new AppError(
        'INVALID_PLAN_WINDOW',
        'Plan window items must cover the whole range',
        422,
      );
    const expected = result.items
      .map((item) => item.chapterNumber)
      .sort((left, right) => left - right);
    for (let index = 0; index < expected.length; index += 1)
      if (expected[index] !== result.window.startChapter + index)
        throw new AppError(
          'INVALID_PLAN_WINDOW',
          'Plan window chapter numbers must be contiguous',
          422,
        );
    const blueprintRef = this.getBlueprintRevision(
      projectId,
      result.window.sourceBlueprintRevision,
    );
    const arc = this.getArc(projectId, result.window.arcId);
    const currentBlueprint = this.getBlueprint(projectId);
    if (
      !blueprintRef ||
      !arc ||
      !currentBlueprint ||
      currentBlueprint.revision !== result.window.sourceBlueprintRevision ||
      arc.sourceBlueprintRevision !== result.window.sourceBlueprintRevision
    )
      throw new AppError('STALE_INPUT', 'Plan window source revisions are no longer current', 409);
    const settings = this.getSettings(projectId);
    const characterIds = new Set(
      currentBlueprint?.blueprint.characters.map((character) => character.id) ?? [],
    );
    const itemIds = new Set(result.items.map((item) => item.id));
    if (
      !settings ||
      itemIds.size !== result.items.length ||
      result.items.some(
        (item) =>
          item.chapterNumber > settings.targetChapterCount ||
          item.characterIds.some((characterId) => !characterIds.has(characterId)),
      )
    )
      throw new AppError('INVALID_PLAN_WINDOW', 'Plan window references are invalid', 422);
    if (result.window.startChapter < arc.startChapter || result.window.endChapter > arc.endChapter)
      throw new AppError('INVALID_PLAN_WINDOW', 'Plan window must stay within its arc', 422);
    const current = this.database.sqlite
      .prepare(
        'SELECT COALESCE(MAX(revision),0) as revision FROM story_plan_window_revisions WHERE project_id=? AND stable_id=?',
      )
      .get(projectId, result.window.id) as { revision: number };
    const windowId = randomUUID();
    const stamp = now();
    const arcRow = this.database.sqlite
      .prepare(
        'SELECT id FROM story_arc_revisions WHERE project_id=? AND stable_id=? AND is_current=1',
      )
      .get(projectId, result.window.arcId) as { id: Id } | undefined;
    if (!arcRow) throw new AppError('PREREQUISITE_MISSING', 'Current arc revision is missing', 409);
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_plan_window_revisions(id,project_id,stable_id,revision,arc_id,start_chapter,end_chapter,source_blueprint_revision_id,prior_window_summary,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
        )
        .run(
          windowId,
          projectId,
          result.window.id,
          current.revision + 1,
          arcRow.id,
          result.window.startChapter,
          result.window.endChapter,
          blueprintRef.id,
          result.window.priorWindowSummary,
          json(result),
          inputFingerprint,
          result.window.status,
          stamp,
          stamp,
        );
      const insert = this.database.sqlite.prepare(
        'INSERT INTO story_plan_window_items(id,window_revision_id,stable_id,chapter_number,payload,input_fingerprint,created_at) VALUES(?,?,?,?,?,?,?)',
      );
      for (const item of result.items)
        insert.run(
          randomUUID(),
          windowId,
          item.id,
          item.chapterNumber,
          json(item),
          inputFingerprint ?? this.fingerprint(item),
          stamp,
        );
      this.database.sqlite
        .prepare(
          'UPDATE story_plan_window_revisions SET is_current=0,updated_at=? WHERE project_id=? AND stable_id=? AND is_current=1',
        )
        .run(stamp, projectId, result.window.id);
      this.database.sqlite
        .prepare('UPDATE story_plan_window_revisions SET is_current=1,updated_at=? WHERE id=?')
        .run(stamp, windowId);
    })();
    return this.getPlanWindow(projectId, result.window.id)!;
  }

  getStoryState(projectId: Id): StoryState {
    const row = this.database.sqlite
      .prepare('SELECT payload FROM story_state_revisions WHERE project_id=? AND is_current=1')
      .get(projectId) as { payload: string } | undefined;
    if (row) return storyStateSchema.parse(parseJson(row.payload));
    const blueprint = this.getBlueprint(projectId);
    const state = storyStateSchema.parse({
      projectId,
      revision: 1,
      currentChapter: 0,
      rollingProgressSummary: '',
      currentArcId: null,
      currentPhase: 'PRELUDE',
      characterStates:
        blueprint?.blueprint.characters.map((character) =>
          storyCharacterStateSchema.parse({ characterId: character.id }),
        ) ?? [],
      threads: this.getThreads(projectId).map((thread) => normalizeThread(thread)),
      importantFacts: [],
      recentEvents: [],
      gapMarkers: [],
      sourceChapterId: null,
      sourceChapterRevision: null,
      previousRevision: null,
      updatedAt: now(),
    });
    const stamp = now();
    this.database.sqlite
      .prepare(
        'INSERT OR IGNORE INTO story_state_revisions(id,project_id,revision,current_chapter,source_chapter_id,source_chapter_revision,previous_revision_id,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?, ?,1,?,?)',
      )
      .run(
        randomUUID(),
        projectId,
        state.revision,
        state.currentChapter,
        null,
        null,
        null,
        json(state),
        this.fingerprint(state),
        'CURRENT',
        stamp,
        stamp,
      );
    const persisted = this.database.sqlite
      .prepare('SELECT payload FROM story_state_revisions WHERE project_id=? AND is_current=1')
      .get(projectId) as { payload: string } | undefined;
    return persisted ? storyStateSchema.parse(parseJson(persisted.payload)) : state;
  }

  getStoryStateRevision(projectId: Id, revision: number): StoryState | null {
    const row = this.database.sqlite
      .prepare('SELECT payload FROM story_state_revisions WHERE project_id=? AND revision=?')
      .get(projectId, revision) as { payload: string } | undefined;
    return row ? storyStateSchema.parse(parseJson(row.payload)) : null;
  }
  getStoryStateRevisionRef(projectId: Id, revision: number): { id: Id; revision: number } | null {
    const row = this.database.sqlite
      .prepare('SELECT id,revision FROM story_state_revisions WHERE project_id=? AND revision=?')
      .get(projectId, revision) as { id: Id; revision: number } | undefined;
    return row ?? null;
  }
  getStoryStateAtChapter(projectId: Id, chapterNumber: number): StoryState | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT payload FROM story_state_revisions WHERE project_id=? AND current_chapter=? ORDER BY revision DESC LIMIT 1',
      )
      .get(projectId, chapterNumber) as { payload: string } | undefined;
    return row ? storyStateSchema.parse(parseJson(row.payload)) : null;
  }
  getStoryStateRevisionById(
    projectId: Id,
    revisionId: Id,
  ): { id: Id; revision: number; state: StoryState } | null {
    const row = this.database.sqlite
      .prepare('SELECT id,revision,payload FROM story_state_revisions WHERE project_id=? AND id=?')
      .get(projectId, revisionId) as { id: Id; revision: number; payload: string } | undefined;
    return row
      ? {
          id: row.id,
          revision: row.revision,
          state: storyStateSchema.parse(parseJson(row.payload)),
        }
      : null;
  }

  getCurrentStoryStateRevisionRef(projectId: Id): { id: Id; revision: number } | null {
    const row = this.database.sqlite
      .prepare('SELECT id,revision FROM story_state_revisions WHERE project_id=? AND is_current=1')
      .get(projectId) as { id: Id; revision: number } | undefined;
    return row ?? null;
  }

  listStoryStateRevisionRecords(
    projectId: Id,
    limit = 200,
  ): Array<{ id: Id; revision: number; state: StoryState }> {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,revision,payload FROM story_state_revisions WHERE project_id=? ORDER BY revision ASC LIMIT ?',
      )
      .all(projectId, Math.max(1, Math.min(500, limit))) as Array<{
      id: Id;
      revision: number;
      payload: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      state: storyStateSchema.parse(parseJson(row.payload)),
    }));
  }

  listStoryStateRevisions(projectId: Id, limit = 50, offset = 0): StoryState[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT payload FROM story_state_revisions WHERE project_id=? ORDER BY revision DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, Math.max(1, Math.min(200, limit)), Math.max(0, offset)) as Array<{
      payload: string;
    }>;
    return rows.map((row) => storyStateSchema.parse(parseJson(row.payload)));
  }

  saveStoryState(stateInput: unknown, inputFingerprint: string): StoryState {
    const state = storyStateSchema.parse(stateInput);
    const current = this.database.sqlite
      .prepare('SELECT id,revision FROM story_state_revisions WHERE project_id=? AND is_current=1')
      .get(state.projectId) as { id: Id; revision: number } | undefined;
    const revision = current ? Math.max(state.revision, current.revision + 1) : state.revision;
    const stateWithRevision = storyStateSchema.parse({
      ...state,
      revision,
      previousRevision: current?.revision ?? state.previousRevision,
      updatedAt: now(),
    });
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE story_state_revisions SET is_current=0,status='SUPERSEDED',updated_at=? WHERE project_id=? AND is_current=1",
        )
        .run(stamp, state.projectId);
      this.database.sqlite
        .prepare(
          'INSERT INTO story_state_revisions(id,project_id,revision,current_chapter,source_chapter_id,source_chapter_revision,previous_revision_id,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?, ?,1,?,?)',
        )
        .run(
          id,
          stateWithRevision.projectId,
          stateWithRevision.revision,
          stateWithRevision.currentChapter,
          stateWithRevision.sourceChapterId,
          stateWithRevision.sourceChapterRevision,
          current?.id ?? null,
          json(stateWithRevision),
          inputFingerprint,
          'CURRENT',
          stamp,
          stamp,
        );
    })();
    return stateWithRevision;
  }

  saveStateDelta(input: {
    projectId: Id;
    sourceChapterId: Id | null;
    sourceChapterRevision: number | null;
    sourceGenerationId: Id | null;
    targetStateRevisionId: Id | null;
    delta: unknown;
    validationStatus?: 'VALID' | 'PENDING_REVIEW' | 'INVALID';
  }): Id {
    const delta = storyStateDeltaSchema.parse(input.delta);
    const id = randomUUID();
    this.database.sqlite
      .prepare(
        'INSERT INTO story_state_deltas(id,project_id,source_chapter_id,source_chapter_revision,source_generation_id,target_state_revision_id,payload,validation_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.projectId,
        input.sourceChapterId,
        input.sourceChapterRevision,
        input.sourceGenerationId,
        input.targetStateRevisionId,
        json(delta),
        input.validationStatus ?? 'VALID',
        now(),
      );
    return id;
  }

  getStateDeltaForChapter(
    chapterId: Id,
    chapterRevision?: number,
  ): {
    id: Id;
    chapterRevision: number;
    delta: StoryStateDelta;
    sourceStateRevisionId: Id | null;
    validationStatus: string;
  } | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT d.id,d.source_chapter_revision as chapterRevision,d.payload,
          d.target_state_revision_id as sourceStateRevisionId,d.validation_status as validationStatus
         FROM story_state_deltas d
         WHERE d.source_chapter_id=? AND (? IS NULL OR d.source_chapter_revision=?)
         ORDER BY d.created_at DESC LIMIT 1`,
      )
      .get(chapterId, chapterRevision ?? null, chapterRevision ?? null) as
      | {
          id: Id;
          chapterRevision: number;
          payload: string;
          sourceStateRevisionId: Id | null;
          validationStatus: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          chapterRevision: row.chapterRevision,
          delta: storyStateDeltaSchema.parse(parseJson(row.payload)),
          sourceStateRevisionId: row.sourceStateRevisionId,
          validationStatus: row.validationStatus,
        }
      : null;
  }

  getCharacterStates(projectId: Id): StoryState['characterStates'] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT character_id as characterId,location,current_goal as currentGoal,power_level as powerLevel,injuries,possessions,relationships,knowledge,last_updated_chapter as lastUpdatedChapter FROM story_character_states WHERE project_id=? ORDER BY character_id',
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      storyCharacterStateSchema.parse({
        characterId: row.characterId,
        location: row.location,
        currentGoal: row.currentGoal,
        powerLevel: row.powerLevel,
        injuries: parseArray(row.injuries as string),
        possessions: parseArray(row.possessions as string),
        relationships: parseArray(row.relationships as string),
        knowledge: parseArray(row.knowledge as string),
        lastUpdatedChapter: row.lastUpdatedChapter,
      }),
    );
  }

  getImportantFacts(projectId: Id): StoryImportantFact[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT stable_id as id,text,importance,introduced_chapter as introducedChapter,last_confirmed_chapter as lastConfirmedChapter,status FROM story_important_facts WHERE project_id=? ORDER BY last_confirmed_chapter DESC,stable_id',
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((row) => storyImportantFactSchema.parse(row));
  }

  getImportantEvents(projectId: Id, limit = 100): StoryImportantEvent[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT stable_id as id,chapter_number as chapterNumber,type,description,importance,character_ids as characterIds,thread_ids as threadIds FROM story_events WHERE project_id=? ORDER BY chapter_number DESC,stable_id LIMIT ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      storyImportantEventSchema.parse({
        ...row,
        characterIds: parseArray(row.characterIds as string),
        threadIds: parseArray(row.threadIds as string),
      }),
    );
  }

  getChapterLineage(
    chapterId: Id,
    chapterRevision?: number,
  ): {
    chapterRevision: number;
    sourceStateRevisionId: Id | null;
    sourceGenerationId: Id | null;
    continuityStatus: string;
    continuityCheckStatus: string | null;
  } | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT chapter_revision as chapterRevision,source_state_revision_id as sourceStateRevisionId,source_generation_id as sourceGenerationId,continuity_status as continuityStatus,continuity_check_status as continuityCheckStatus FROM story_chapter_lineage WHERE chapter_id=? AND (? IS NULL OR chapter_revision=?) ORDER BY chapter_revision DESC LIMIT 1',
      )
      .get(chapterId, chapterRevision ?? null, chapterRevision ?? null) as
      | {
          chapterRevision: number;
          sourceStateRevisionId: Id | null;
          sourceGenerationId: Id | null;
          continuityStatus: string;
          continuityCheckStatus: string | null;
        }
      | undefined;
    return row ?? null;
  }

  markContinuityStale(
    projectId: Id,
    afterChapter: number,
    reason = 'Upstream story state changed',
  ): number {
    const stamp = now();
    return this.database.sqlite.transaction(() => {
      const result = this.database.sqlite
        .prepare(
          "UPDATE chapters SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL,updated_at=? WHERE project_id=? AND number>? AND story_origin='GENERATED' AND continuity_status!='CONTINUITY_STALE'",
        )
        .run(stamp, projectId, afterChapter);
      this.database.sqlite
        .prepare(
          "UPDATE story_chapter_lineage SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND chapter_id IN (SELECT id FROM chapters WHERE project_id=? AND number>?)",
        )
        .run(projectId, projectId, afterChapter);
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batches SET status='PAUSED',error=?,updated_at=? WHERE project_id=? AND status IN ('PENDING','RUNNING') AND end_chapter>?",
        )
        .run(reason.slice(0, 2_000), stamp, projectId, afterChapter);
      return result.changes;
    })();
  }

  markManualContinuityReview(projectId: Id, chapterNumber: number): number {
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "UPDATE chapters SET continuity_status=CASE WHEN number=? THEN 'NOT_ANALYZED' ELSE 'CONTINUITY_STALE' END,continuity_check_status=NULL,updated_at=? WHERE project_id=? AND number>=? AND story_origin IN ('MANUAL','GENERATED')",
        )
        .run(chapterNumber, stamp, projectId, chapterNumber);
      this.database.sqlite
        .prepare(
          "UPDATE story_chapter_lineage SET continuity_status='CONTINUITY_STALE' WHERE project_id=? AND chapter_id IN (SELECT id FROM chapters WHERE project_id=? AND number>?)",
        )
        .run(projectId, projectId, chapterNumber);
      this.database.sqlite
        .prepare(
          "UPDATE story_generation_batches SET status='PAUSED',error=?,updated_at=? WHERE project_id=? AND status IN ('PENDING','RUNNING') AND end_chapter>=?",
        )
        .run('Manual chapter edit requires continuity review', stamp, projectId, chapterNumber);
    })();
    const result = this.database.sqlite
      .prepare(
        "SELECT COUNT(*) as count FROM chapters WHERE project_id=? AND continuity_status IN ('CONTINUITY_STALE','NOT_ANALYZED')",
      )
      .get(projectId) as { count: number };
    return result.count;
  }

  saveContinuityCheck(input: {
    projectId: Id;
    chapterId: Id;
    chapterRevision: number;
    sourceStateRevisionId: Id | null;
    result: unknown;
    stateDelta?: unknown;
    summary?: unknown;
    metadata: GenerationMetadata | null;
  }): Id {
    const result = continuityCheckResultSchema.parse(input.result);
    const stateDelta =
      input.stateDelta === undefined ? null : storyStateDeltaSchema.parse(input.stateDelta);
    const summary = input.summary === undefined ? null : chapterSummarySchema.parse(input.summary);
    const derivedStatus = stateDelta
      ? null
      : result.status === 'FAIL'
        ? 'CONTINUITY_STALE'
        : 'CURRENT';
    const id = randomUUID();
    const stamp = now();
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'INSERT INTO story_continuity_checks(id,project_id,chapter_id,chapter_revision,source_state_revision_id,status,issues,metadata,state_delta,summary,accepted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          input.projectId,
          input.chapterId,
          input.chapterRevision,
          input.sourceStateRevisionId,
          result.status,
          json(result.issues),
          input.metadata ? json(input.metadata) : null,
          stateDelta ? json(stateDelta) : null,
          summary ? json(summary) : null,
          null,
          stamp,
        );
      this.database.sqlite
        .prepare(
          'UPDATE chapters SET continuity_check_status=?,continuity_status=COALESCE(?,continuity_status),updated_at=? WHERE id=? AND revision=?',
        )
        .run(result.status, derivedStatus, stamp, input.chapterId, input.chapterRevision);
      this.database.sqlite
        .prepare(
          'UPDATE story_chapter_lineage SET continuity_check_status=? WHERE chapter_id=? AND chapter_revision=?',
        )
        .run(result.status, input.chapterId, input.chapterRevision);
    })();
    return id;
  }

  getContinuityChecks(projectId: Id, limit = 50, offset = 0): StoryContinuityCheckRecord[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,chapter_id as chapterId,chapter_revision as chapterRevision,source_state_revision_id as sourceStateRevisionId,status,issues,state_delta as stateDelta,summary,accepted_at as acceptedAt FROM story_continuity_checks WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => ({
      id: row.id as Id,
      projectId,
      chapterId: row.chapterId as Id,
      chapterRevision: row.chapterRevision as number,
      sourceStateRevisionId: (row.sourceStateRevisionId as Id | null) ?? null,
      result: continuityCheckResultSchema.parse({
        status: row.status,
        issues: parseArray(row.issues as string),
      }),
      stateDelta: row.stateDelta
        ? storyStateDeltaSchema.parse(parseJson(row.stateDelta as string))
        : null,
      summary: row.summary ? chapterSummarySchema.parse(parseJson(row.summary as string)) : null,
      acceptedAt: (row.acceptedAt as string | null) ?? null,
    }));
  }

  saveUsage(input: Omit<AiUsage, 'id' | 'createdAt'>): AiUsage {
    const usage = aiUsageSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: now(),
    });
    this.database.sqlite
      .prepare(
        'INSERT INTO ai_usage(id,project_id,operation,entity_id,attempt,provider,model,input_tokens,output_tokens,duration_ms,cost_usd,currency,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        usage.id,
        usage.projectId,
        usage.operation,
        usage.entityId,
        usage.attempt,
        usage.provider,
        usage.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.durationMs,
        usage.costUsd,
        usage.currency,
        usage.status,
        usage.createdAt,
      );
    return usage;
  }

  getContinuityCheck(id: Id): StoryContinuityCheckRecord | null {
    const row = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,chapter_id as chapterId,chapter_revision as chapterRevision,source_state_revision_id as sourceStateRevisionId,status,issues,state_delta as stateDelta,summary,accepted_at as acceptedAt FROM story_continuity_checks WHERE id=?',
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as Id,
      projectId: row.projectId as Id,
      chapterId: row.chapterId as Id,
      chapterRevision: row.chapterRevision as number,
      sourceStateRevisionId: (row.sourceStateRevisionId as Id | null) ?? null,
      result: continuityCheckResultSchema.parse({
        status: row.status,
        issues: parseArray(row.issues as string),
      }),
      stateDelta: row.stateDelta
        ? storyStateDeltaSchema.parse(parseJson(row.stateDelta as string))
        : null,
      summary: row.summary ? chapterSummarySchema.parse(parseJson(row.summary as string)) : null,
      acceptedAt: (row.acceptedAt as string | null) ?? null,
    };
  }

  markContinuityCheckAccepted(id: Id): void {
    this.database.sqlite
      .prepare(
        'UPDATE story_continuity_checks SET accepted_at=? WHERE id=? AND accepted_at IS NULL',
      )
      .run(now(), id);
  }
  commitAcceptedManualAnalysis(input: {
    projectId: Id;
    checkId: Id;
    chapterId: Id;
    chapterRevision: number;
    sourceStateRevisionId: Id | null;
    state: StoryState;
    delta: StoryStateDelta;
    metadata: GenerationMetadata | null;
    inputFingerprint: string;
  }): {
    stateRevisionId: Id;
    deltaId: Id;
    summaryId: Id;
    state: StoryState;
  } {
    const state = storyStateSchema.parse(input.state);
    const delta = storyStateDeltaSchema.parse(input.delta);
    const check = this.getContinuityCheck(input.checkId);
    if (
      !check ||
      check.projectId !== input.projectId ||
      check.chapterId !== input.chapterId ||
      check.chapterRevision !== input.chapterRevision
    )
      throw new AppError('NOT_FOUND', 'Continuity analysis was not found', 404);
    if (!check.stateDelta || !check.summary || check.acceptedAt)
      throw new AppError('INVALID_CONTINUITY', 'Continuity analysis is not awaiting review', 409);
    const summary = check.summary;
    if (JSON.stringify(check.stateDelta) !== JSON.stringify(delta))
      throw new AppError('STALE_INPUT', 'Continuity analysis changed before acceptance', 409);

    const result = this.database.sqlite.transaction(() => {
      const chapter = this.database.sqlite
        .prepare('SELECT project_id as projectId,number,revision FROM chapters WHERE id=?')
        .get(input.chapterId) as { projectId: Id; number: number; revision: number } | undefined;
      if (
        !chapter ||
        chapter.projectId !== input.projectId ||
        chapter.revision !== input.chapterRevision
      )
        throw new AppError(
          'STALE_INPUT',
          'Manual chapter changed before continuity acceptance',
          409,
        );
      const current = this.database.sqlite
        .prepare(
          'SELECT id,revision,current_chapter as currentChapter FROM story_state_revisions WHERE project_id=? AND is_current=1',
        )
        .get(input.projectId) as { id: Id; revision: number; currentChapter: number } | undefined;
      if (!current)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Current StoryState checkpoint is required',
          409,
        );
      const baseState = state.previousRevision
        ? (this.database.sqlite
            .prepare(
              'SELECT id,revision,current_chapter as currentChapter FROM story_state_revisions WHERE project_id=? AND revision=?',
            )
            .get(input.projectId, state.previousRevision) as
            { id: Id; revision: number; currentChapter: number } | undefined)
        : undefined;
      if (!current)
        throw new AppError(
          'PREREQUISITE_MISSING',
          'Current StoryState checkpoint is required',
          409,
        );
      const historical = state.previousRevision !== current.revision;
      if (
        input.sourceStateRevisionId &&
        (!baseState || baseState.id !== input.sourceStateRevisionId)
      )
        throw new AppError('STALE_INPUT', 'StoryState changed before continuity acceptance', 409);
      if (historical && (!baseState || baseState.currentChapter !== chapter.number - 1))
        throw new AppError(
          'CONTINUITY_ERROR',
          'Manual analysis requires a valid preceding checkpoint',
          409,
        );
      if (
        !historical &&
        (state.revision !== current.revision + 1 || chapter.number !== current.currentChapter + 1)
      )
        throw new AppError(
          'CONTINUITY_ERROR',
          'Manual analysis chapter must follow the current checkpoint',
          409,
        );

      const stamp = now();
      const persistedState = storyStateSchema.parse({
        ...state,
        revision: current.revision + 1,
        currentChapter: chapter.number,
        sourceChapterId: input.chapterId,
        sourceChapterRevision: input.chapterRevision,
        previousRevision: historical ? baseState!.revision : current.revision,
        updatedAt: stamp,
      });
      const stateRevisionId = randomUUID();
      this.database.sqlite
        .prepare(
          "UPDATE story_state_revisions SET is_current=0,status='SUPERSEDED',updated_at=? WHERE project_id=? AND is_current=1",
        )
        .run(stamp, input.projectId);
      this.database.sqlite
        .prepare(
          "INSERT INTO story_state_revisions(id,project_id,revision,current_chapter,source_chapter_id,source_chapter_revision,previous_revision_id,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'CURRENT',1,?,?)",
        )
        .run(
          stateRevisionId,
          input.projectId,
          persistedState.revision,
          persistedState.currentChapter,
          input.chapterId,
          input.chapterRevision,
          historical ? baseState!.id : current.id,
          json(persistedState),
          input.inputFingerprint,
          stamp,
          stamp,
        );

      const currentSummary = this.database.sqlite
        .prepare(
          'SELECT COALESCE(MAX(revision),0) as revision FROM story_summary_revisions WHERE chapter_id=?',
        )
        .get(input.chapterId) as { revision: number };
      const summaryId = randomUUID();
      const continuityWarnings = check.result.issues.map((issue) => issue.message).slice(0, 50);
      const summaryEvents = delta.events.slice(0, 100).map((event) => ({
        description: event.description,
        importance: event.importance,
        characterIds: event.characterIds,
      }));
      const threadTransitions = delta.threadUpdates
        .filter((update) => update.status !== undefined)
        .slice(0, 100)
        .map((update) => ({
          threadId: update.threadId,
          status: update.status!,
          note: update.note ?? '',
        }));
      this.database.sqlite
        .prepare(
          'INSERT INTO story_summary_revisions(id,chapter_id,chapter_revision,revision,payload,events,thread_transitions,warnings,metadata,input_fingerprint,status,is_current,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          summaryId,
          input.chapterId,
          input.chapterRevision,
          currentSummary.revision + 1,
          json(summary),
          json(summaryEvents),
          json(threadTransitions),
          json(continuityWarnings),
          input.metadata ? json(input.metadata) : null,
          input.inputFingerprint,
          'CURRENT',
          0,
          stamp,
        );
      this.database.sqlite
        .prepare(
          "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
        )
        .run(input.chapterId);
      this.database.sqlite
        .prepare('UPDATE story_summary_revisions SET is_current=1 WHERE id=?')
        .run(summaryId);

      const deltaId = randomUUID();
      this.database.sqlite
        .prepare(
          'INSERT INTO story_state_deltas(id,project_id,source_chapter_id,source_chapter_revision,source_generation_id,target_state_revision_id,payload,validation_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          deltaId,
          input.projectId,
          input.chapterId,
          input.chapterRevision,
          null,
          stateRevisionId,
          json(delta),
          'VALID',
          stamp,
        );
      if (historical)
        this.replaceCanonicalState(
          input.projectId,
          persistedState,
          delta,
          stateRevisionId,
          input.chapterId,
          stamp,
        );
      else
        this.persistCanonicalState(
          input.projectId,
          persistedState,
          delta,
          stateRevisionId,
          input.chapterId,
          stamp,
        );
      this.database.sqlite
        .prepare(
          'INSERT INTO story_chapter_lineage(id,project_id,chapter_id,chapter_revision,source_state_revision_id,source_generation_id,continuity_status,continuity_check_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          input.projectId,
          input.chapterId,
          input.chapterRevision,
          stateRevisionId,
          null,
          check.result.status === 'FAIL' ? 'CONTINUITY_STALE' : 'CURRENT',
          check.result.status,
          stamp,
        );
      const accepted = this.database.sqlite
        .prepare(
          'UPDATE story_continuity_checks SET accepted_at=? WHERE id=? AND accepted_at IS NULL',
        )
        .run(stamp, input.checkId);
      if (accepted.changes !== 1)
        throw new AppError('STALE_INPUT', 'Continuity analysis was accepted already', 409);
      this.database.sqlite
        .prepare(
          'UPDATE chapters SET continuity_status=?,continuity_check_status=?,source_state_revision=?,updated_at=? WHERE id=? AND revision=?',
        )
        .run(
          check.result.status === 'FAIL' ? 'CONTINUITY_STALE' : 'CURRENT',
          check.result.status,
          persistedState.revision,
          stamp,
          input.chapterId,
          input.chapterRevision,
        );
      this.database.sqlite
        .prepare(
          "UPDATE chapters SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND number>? AND story_origin='GENERATED'",
        )
        .run(input.projectId, chapter.number);
      this.database.sqlite
        .prepare(
          "UPDATE story_chapter_lineage SET continuity_status='CONTINUITY_STALE',continuity_check_status=NULL WHERE project_id=? AND chapter_id IN (SELECT id FROM chapters WHERE project_id=? AND number>? AND story_origin='GENERATED')",
        )
        .run(input.projectId, input.projectId, chapter.number);
      return { stateRevisionId, deltaId, summaryId, state: persistedState };
    })();
    return result;
  }
  commitRebuiltStoryState(input: {
    projectId: Id;
    baseStateRevisionId: Id;
    baseStateRevision: number;
    baseState: StoryState;
    expectedCurrentStateRevisionId: Id;
    expectedCurrentStateRevision: number;
    states: Array<{
      state: StoryState;
      chapterId: Id;
      chapterRevision: number;
      delta: StoryStateDelta;
      deltaId: Id | null;
    }>;
    inputFingerprint: string;
  }): { state: StoryState; stateRevisionIds: Id[] } {
    const baseState = storyStateSchema.parse(input.baseState);
    if (baseState.projectId !== input.projectId || baseState.revision !== input.baseStateRevision)
      throw new AppError('CONTINUITY_ERROR', 'Continuity rebuild checkpoint is invalid', 422);
    const states = input.states.map((item) => ({
      ...item,
      state: storyStateSchema.parse(item.state),
      delta: storyStateDeltaSchema.parse(item.delta),
    }));
    const baseRevisionRow = this.database.sqlite
      .prepare(
        'SELECT payload FROM story_state_revisions WHERE id=? AND project_id=? AND revision=?',
      )
      .get(input.baseStateRevisionId, input.projectId, input.baseStateRevision) as
      { payload: string } | undefined;
    if (
      !baseRevisionRow ||
      storyStateSchema.parse(parseJson(baseRevisionRow.payload)).projectId !== input.projectId
    )
      throw new AppError('CONTINUITY_ERROR', 'Continuity rebuild base checkpoint is missing', 422);
    const chapterIds = new Set<Id>();
    let expectedChapter = baseState.currentChapter + 1;
    let expectedPreviousRevision = baseState.revision;
    for (const item of states) {
      if (
        item.state.projectId !== input.projectId ||
        item.state.currentChapter !== expectedChapter ||
        item.state.previousRevision !== expectedPreviousRevision ||
        item.state.revision !== expectedPreviousRevision + 1 ||
        chapterIds.has(item.chapterId)
      )
        throw new AppError(
          'CONTINUITY_ERROR',
          'Continuity rebuild checkpoints are not contiguous',
          422,
        );
      const chapter = this.database.sqlite
        .prepare('SELECT number,revision FROM chapters WHERE id=? AND project_id=?')
        .get(item.chapterId, input.projectId) as { number: number; revision: number } | undefined;
      if (
        !chapter ||
        chapter.number !== item.state.currentChapter ||
        chapter.revision !== item.chapterRevision
      )
        throw new AppError(
          'CONTINUITY_ERROR',
          'Continuity rebuild chapter lineage is invalid',
          422,
        );
      if (item.deltaId) {
        const delta = this.database.sqlite
          .prepare(
            'SELECT 1 FROM story_state_deltas WHERE id=? AND project_id=? AND source_chapter_id=? AND source_chapter_revision=?',
          )
          .get(item.deltaId, input.projectId, item.chapterId, item.chapterRevision);
        if (!delta)
          throw new AppError(
            'CONTINUITY_ERROR',
            'Continuity rebuild delta lineage is invalid',
            422,
          );
      }
      chapterIds.add(item.chapterId);
      expectedChapter += 1;
      expectedPreviousRevision = item.state.revision;
    }
    const result = this.database.sqlite.transaction(() => {
      const current = this.database.sqlite
        .prepare(
          'SELECT id,revision FROM story_state_revisions WHERE project_id=? AND is_current=1',
        )
        .get(input.projectId) as { id: Id; revision: number } | undefined;
      if (
        !current ||
        current.id !== input.expectedCurrentStateRevisionId ||
        current.revision !== input.expectedCurrentStateRevision
      )
        throw new AppError('STALE_INPUT', 'StoryState changed before continuity rebuild', 409);

      const stamp = now();
      this.database.sqlite
        .prepare(
          "UPDATE story_state_revisions SET is_current=0,status='SUPERSEDED',updated_at=? WHERE id=? AND is_current=1",
        )
        .run(stamp, current.id);
      let nextRevision =
        (
          this.database.sqlite
            .prepare(
              'SELECT COALESCE(MAX(revision),0) as revision FROM story_state_revisions WHERE project_id=?',
            )
            .get(input.projectId) as { revision: number }
        ).revision + 1;
      let previousId = input.baseStateRevisionId;
      let previousRevision = input.baseStateRevision;
      let finalState: StoryState | null = null;
      const stateRevisionIds: Id[] = [];

      const insertRevision = (
        state: StoryState,
        sourceChapterId: Id | null,
        sourceChapterRevision: number | null,
      ): Id => {
        const stateRevisionId = randomUUID();
        const persistedState = storyStateSchema.parse({
          ...state,
          projectId: input.projectId,
          revision: nextRevision,
          sourceChapterId,
          sourceChapterRevision,
          previousRevision,
          updatedAt: stamp,
        });
        this.database.sqlite
          .prepare(
            "INSERT INTO story_state_revisions(id,project_id,revision,current_chapter,source_chapter_id,source_chapter_revision,previous_revision_id,payload,input_fingerprint,status,is_current,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'SUPERSEDED',0,?,?)",
          )
          .run(
            stateRevisionId,
            input.projectId,
            persistedState.revision,
            persistedState.currentChapter,
            sourceChapterId,
            sourceChapterRevision,
            previousId,
            json(persistedState),
            input.inputFingerprint,
            stamp,
            stamp,
          );
        previousId = stateRevisionId;
        previousRevision = persistedState.revision;
        nextRevision += 1;
        finalState = persistedState;
        stateRevisionIds.push(stateRevisionId);
        return stateRevisionId;
      };

      if (!states.length)
        insertRevision(baseState, baseState.sourceChapterId, baseState.sourceChapterRevision);
      for (const item of states) {
        const stateRevisionId = insertRevision(item.state, item.chapterId, item.chapterRevision);
        if (item.deltaId) {
          this.database.sqlite
            .prepare(
              "UPDATE story_state_deltas SET target_state_revision_id=?,validation_status='VALID' WHERE id=? AND project_id=?",
            )
            .run(stateRevisionId, item.deltaId, input.projectId);
        } else {
          this.database.sqlite
            .prepare(
              'INSERT INTO story_state_deltas(id,project_id,source_chapter_id,source_chapter_revision,source_generation_id,target_state_revision_id,payload,validation_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .run(
              randomUUID(),
              input.projectId,
              item.chapterId,
              item.chapterRevision,
              null,
              stateRevisionId,
              json(item.delta),
              'VALID',
              stamp,
            );
        }
        const lineage = this.database.sqlite
          .prepare('SELECT id FROM story_chapter_lineage WHERE chapter_id=? AND chapter_revision=?')
          .get(item.chapterId, item.chapterRevision) as { id: Id } | undefined;
        if (lineage) {
          this.database.sqlite
            .prepare(
              "UPDATE story_chapter_lineage SET source_state_revision_id=?,continuity_status='CURRENT',continuity_check_status=NULL WHERE chapter_id=? AND chapter_revision=?",
            )
            .run(stateRevisionId, item.chapterId, item.chapterRevision);
        } else {
          this.database.sqlite
            .prepare(
              'INSERT INTO story_chapter_lineage(id,project_id,chapter_id,chapter_revision,source_state_revision_id,source_generation_id,continuity_status,continuity_check_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .run(
              randomUUID(),
              input.projectId,
              item.chapterId,
              item.chapterRevision,
              stateRevisionId,
              null,
              'CURRENT',
              null,
              stamp,
            );
        }
        this.database.sqlite
          .prepare(
            "UPDATE chapters SET source_state_revision=?,continuity_status='CURRENT',continuity_check_status=NULL,updated_at=? WHERE id=? AND revision=?",
          )
          .run(finalState!.revision, stamp, item.chapterId, item.chapterRevision);
        this.replaceCanonicalState(
          input.projectId,
          finalState!,
          item.delta,
          stateRevisionId,
          item.chapterId,
          stamp,
        );
      }
      const finalId = stateRevisionIds.at(-1);
      if (!finalState || !finalId)
        throw new AppError('CONTINUITY_ERROR', 'Continuity rebuild produced no checkpoint', 422);
      this.database.sqlite
        .prepare(
          "UPDATE story_state_revisions SET status='CURRENT',is_current=1,updated_at=? WHERE id=?",
        )
        .run(stamp, finalId);
      return { state: finalState, stateRevisionIds };
    })();
    return result;
  }
  recordGapMarker(projectId: Id, chapterNumber: number, reason: string): StoryState {
    const current = this.getStoryState(projectId);
    const existing = current.gapMarkers.find((marker) => marker.chapterNumber === chapterNumber);
    if (existing?.reason === reason) return current;
    return this.saveStoryState(
      {
        ...current,
        gapMarkers: [
          ...current.gapMarkers.filter((marker) => marker.chapterNumber !== chapterNumber),
          { chapterNumber, reason: reason.slice(0, 500) },
        ].sort((left, right) => left.chapterNumber - right.chapterNumber),
      },
      this.fingerprint({ operation: 'GAP_MARKER', projectId, chapterNumber, reason }),
    );
  }

  compactStoryStateSummary(
    projectId: Id,
    rollingProgressSummary: string,
    inputFingerprint: string,
  ): StoryState {
    const current = this.getStoryState(projectId);
    return this.saveStoryState(
      storyStateSchema.parse({
        ...current,
        rollingProgressSummary,
        updatedAt: now(),
      }),
      inputFingerprint,
    );
  }

  getUsage(projectId: Id, limit = 50, offset = 0): AiUsage[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,operation,entity_id as entityId,attempt,provider,model,input_tokens as inputTokens,output_tokens as outputTokens,duration_ms as durationMs,cost_usd as costUsd,currency,status,created_at as createdAt FROM ai_usage WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => aiUsageSchema.parse(row));
  }
  getContextDiagnostics(projectId: Id, limit = 20, offset = 0): StoryContextDiagnostic[] {
    const rows = this.database.sqlite
      .prepare(
        'SELECT id,project_id as projectId,operation,target_id as targetId,status,metadata,created_at as createdAt FROM story_generation_records WHERE project_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(projectId, Math.max(1, Math.min(100, limit)), Math.max(0, offset)) as Array<
      Record<string, unknown>
    >;
    return rows.flatMap((row) => {
      const operation = generationOperationSchema.safeParse(row.operation);
      if (!operation.success) return [];
      let metadata: GenerationMetadata | null = null;
      if (typeof row.metadata === 'string') {
        try {
          metadata = generationMetadataSchema.parse(parseJson(row.metadata));
        } catch {
          metadata = null;
        }
      }
      const diagnostics = metadata?.contextDiagnostics
        ? (generationContextDiagnosticsSchema.safeParse(metadata.contextDiagnostics).data ?? null)
        : null;
      return [
        {
          id: row.id as string,
          projectId: row.projectId as string,
          operation: operation.data,
          targetId: row.targetId as string,
          status: row.status as string,
          contextDiagnostics: diagnostics,
          sourceRevisions: metadata?.sourceRevisions ?? diagnostics?.sourceRevisions ?? [],
          createdAt: row.createdAt as string,
        },
      ];
    });
  }

  getUsageSummary(projectId: Id): {
    operations: number;
    knownInputTokens: number;
    knownOutputTokens: number;
    knownCostUsd: number;
    unavailableCount: number;
  } {
    const row = this.database.sqlite
      .prepare(
        'SELECT COUNT(*) as operations,COALESCE(SUM(input_tokens),0) as knownInputTokens,COALESCE(SUM(output_tokens),0) as knownOutputTokens,COALESCE(SUM(cost_usd),0) as knownCostUsd,SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL OR cost_usd IS NULL THEN 1 ELSE 0 END) as unavailableCount FROM ai_usage WHERE project_id=?',
      )
      .get(projectId) as {
      operations: number;
      knownInputTokens: number;
      knownOutputTokens: number;
      knownCostUsd: number;
      unavailableCount: number;
    };
    return row;
  }

  getLongStoryCounts(projectId: Id): {
    targetChapterCount: number;
    arcCount: number;
    plannedChapterCount: number;
    generatedChapterCount: number;
    continuityWarningCount: number;
    staleChapterCount: number;
    currentBlockingChapter: number | null;
  } {
    const settings = this.getSettings(projectId);
    const arcs = this.database.sqlite
      .prepare(
        'SELECT COUNT(*) as count FROM story_arc_revisions WHERE project_id=? AND is_current=1',
      )
      .get(projectId) as { count: number };
    const planned = this.database.sqlite
      .prepare(
        `SELECT COUNT(*) as count FROM (
           SELECT i.chapter_number
           FROM story_plan_revisions p
           JOIN story_plan_items i ON i.plan_revision_id=p.id
           WHERE p.project_id=? AND p.is_current=1
           UNION
           SELECT i.chapter_number
           FROM story_plan_window_revisions w
           JOIN story_plan_window_items i ON i.window_revision_id=w.id
           WHERE w.project_id=? AND w.is_current=1 AND w.status IN ('PLANNED','CURRENT')
         )`,
      )
      .get(projectId, projectId) as { count: number };
    const chapters = this.database.sqlite
      .prepare(
        "SELECT SUM(CASE WHEN story_origin='GENERATED' THEN 1 ELSE 0 END) as generated,SUM(CASE WHEN continuity_check_status='WARN' THEN 1 ELSE 0 END) as warnings,SUM(CASE WHEN continuity_status='CONTINUITY_STALE' THEN 1 ELSE 0 END) as stale FROM chapters WHERE project_id=?",
      )
      .get(projectId) as {
      generated: number | null;
      warnings: number | null;
      stale: number | null;
    };
    const blocking = this.database.sqlite
      .prepare(
        "SELECT chapter_number as chapterNumber FROM story_generation_batch_items WHERE project_id=? AND outcome IN ('FAILED','PENDING','RUNNING') ORDER BY chapter_number LIMIT 1",
      )
      .get(projectId) as { chapterNumber: number } | undefined;
    return {
      targetChapterCount: settings?.targetChapterCount ?? 0,
      arcCount: arcs.count,
      generatedChapterCount: chapters.generated ?? 0,
      plannedChapterCount: planned.count,
      continuityWarningCount: chapters.warnings ?? 0,
      staleChapterCount: chapters.stale ?? 0,
      currentBlockingChapter: blocking?.chapterNumber ?? null,
    };
  }

  private invalidateWorkflowRows(
    entityIds: Id[],
    types: string[],
    error: string,
    excludeStepId?: Id,
    excludeStepIds: Id[] = [],
  ): number {
    if (!entityIds.length || !types.length) return 0;
    const entities = entityIds.map(() => '?').join(',');
    const placeholders = types.map(() => '?').join(',');
    const stamp = now();
    const excluded = new Set([excludeStepId, ...excludeStepIds]);
    const steps = (
      this.database.sqlite
        .prepare(
          `SELECT id,current_attempt_id FROM workflow_steps WHERE entity_id IN (${entities}) AND type IN (${placeholders}) AND status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
        )
        .all(...entityIds, ...types) as Array<{ id: Id; current_attempt_id: Id | null }>
    ).filter((step) => !excluded.has(step.id));
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

  private invalidateWorkflowRowsForProject(
    projectId: Id,
    types: string[],
    error: string,
    excludeStepId?: Id,
    excludeStepIds: Id[] = [],
  ): number {
    if (!types.length) return 0;
    const placeholders = types.map(() => '?').join(',');
    const stamp = now();
    const excluded = new Set([excludeStepId, ...excludeStepIds]);
    const steps = (
      this.database.sqlite
        .prepare(
          `SELECT s.id,s.current_attempt_id FROM workflow_steps s
           JOIN workflow_executions e ON e.id=s.execution_id
           WHERE e.project_id=? AND s.type IN (${placeholders})
             AND NOT (
               s.type='GENERATE_CHAPTER' AND EXISTS (
                 SELECT 1 FROM chapters c WHERE c.id=s.entity_id AND c.story_origin='MANUAL'
               )
             )
             AND s.status IN ('PENDING','RUNNING','COMPLETED','FAILED')`,
        )
        .all(projectId, ...types) as Array<{ id: Id; current_attempt_id: Id | null }>
    ).filter((step) => !excluded.has(step.id));
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

  private invalidateWorkflowRowsForProjectEntity(
    projectId: Id,
    type: string,
    entityId: string,
    error: string,
    excludeStepId?: Id,
    excludeStepIds: Id[] = [],
  ): number {
    const stamp = now();
    const excluded = new Set([excludeStepId, ...excludeStepIds]);
    const steps = (
      this.database.sqlite
        .prepare(
          "SELECT s.id,s.current_attempt_id FROM workflow_steps s JOIN workflow_executions e ON e.id=s.execution_id WHERE e.project_id=? AND s.type=? AND s.entity_id=? AND s.status IN ('PENDING','RUNNING','COMPLETED','FAILED')",
        )
        .all(projectId, type, entityId) as Array<{ id: Id; current_attempt_id: Id | null }>
    ).filter((step) => !excluded.has(step.id));
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
    excludeStepId?: Id;
    excludeStepIds?: Id[];
    preserveCurrentSummary?: boolean;
  }): number {
    const storyTypes = {
      blueprint: ['GENERATE_STORY_BLUEPRINT'],
      plan: ['GENERATE_CHAPTER_PLANS', 'GENERATE_STORY_ARCS', 'GENERATE_CHAPTER_PLAN_WINDOW'],
      chapter: [
        'GENERATE_CHAPTER',
        'GENERATE_CHAPTER_V2',
        'ANALYZE_STORY_STATE',
        'CHECK_CONTINUITY',
      ],
      summary: ['GENERATE_CHAPTER_SUMMARY'],
    };
    const globalStoryChange =
      scope.kind === 'SETTINGS' || scope.kind === 'BLUEPRINT' || scope.kind === 'PLAN';
    const chapterRows = this.database.sqlite
      .prepare(
        scope.kind === 'PLAN_ITEM'
          ? 'SELECT id FROM chapters WHERE project_id=? AND story_plan_item_id=?'
          : globalStoryChange
            ? "SELECT id FROM chapters WHERE project_id=? AND story_origin='GENERATED' AND story_plan_item_id IS NOT NULL"
            : 'SELECT id FROM chapters WHERE project_id=?',
      )
      .all(
        ...(scope.kind === 'PLAN_ITEM'
          ? [scope.projectId, scope.stableId ?? '']
          : [scope.projectId]),
      ) as Array<{ id: Id }>;
    const chapterIds = scope.chapterId
      ? chapterRows.some((row) => row.id === scope.chapterId)
        ? [scope.chapterId]
        : []
      : chapterRows.map((row) => row.id);
    const invalidateMedia =
      scope.kind === 'SETTINGS' ||
      scope.kind === 'BLUEPRINT' ||
      scope.kind === 'PLAN' ||
      scope.kind === 'PLAN_ITEM' ||
      scope.kind === 'CHAPTER';
    const error = `Story ${scope.kind.toLowerCase()} changed`;
    return this.database.sqlite.transaction(() => {
      let invalidated = 0;
      const markCurrentPlanningRowsStale = (includeArcs: boolean) => {
        if (includeArcs)
          this.database.sqlite
            .prepare(
              "UPDATE story_arc_revisions SET status='STALE',updated_at=? WHERE project_id=? AND is_current=1",
            )
            .run(now(), scope.projectId);
        this.database.sqlite
          .prepare(
            "UPDATE story_plan_window_revisions SET status='STALE',updated_at=? WHERE project_id=? AND is_current=1",
          )
          .run(now(), scope.projectId);
      };
      if (scope.kind === 'SETTINGS') {
        invalidated += this.invalidateWorkflowRowsForProject(
          scope.projectId,
          [...storyTypes.blueprint, ...storyTypes.plan, ...storyTypes.chapter],
          error,
          scope.excludeStepId,
          scope.excludeStepIds,
        );
        this.database.sqlite
          .prepare('UPDATE story_blueprint_revisions SET is_current=0 WHERE project_id=?')
          .run(scope.projectId);
        this.database.sqlite
          .prepare('UPDATE story_plan_revisions SET is_current=0 WHERE project_id=?')
          .run(scope.projectId);
        markCurrentPlanningRowsStale(true);
      }
      if (scope.kind === 'BLUEPRINT') {
        invalidated += this.invalidateWorkflowRowsForProject(
          scope.projectId,
          [...storyTypes.plan, 'GENERATE_CHAPTER_V2'],
          error,
          scope.excludeStepId,
          scope.excludeStepIds,
        );
        this.database.sqlite
          .prepare('UPDATE story_plan_revisions SET is_current=0 WHERE project_id=?')
          .run(scope.projectId);
        markCurrentPlanningRowsStale(true);
      }
      if (scope.kind === 'PLAN') {
        invalidated += this.invalidateWorkflowRowsForProject(
          scope.projectId,
          [...storyTypes.plan, 'GENERATE_CHAPTER_V2'],
          error,
          scope.excludeStepId,
          scope.excludeStepIds,
        );
        markCurrentPlanningRowsStale(false);
      }
      if (globalStoryChange || scope.kind === 'PLAN_ITEM' || scope.kind === 'CHAPTER') {
        invalidated += this.invalidateWorkflowRows(
          chapterIds,
          [...storyTypes.chapter, ...storyTypes.summary],
          error,
          scope.excludeStepId,
          scope.excludeStepIds,
        );
        if (globalStoryChange) {
          invalidated += this.invalidateWorkflowRowsForProject(
            scope.projectId,
            ['GENERATE_CHAPTER_V2'],
            error,
            scope.excludeStepId,
            scope.excludeStepIds,
          );
        } else if (scope.kind === 'PLAN_ITEM' && scope.stableId) {
          invalidated += this.invalidateWorkflowRowsForProjectEntity(
            scope.projectId,
            'GENERATE_CHAPTER_V2',
            scope.stableId,
            error,
            scope.excludeStepId,
            scope.excludeStepIds,
          );
        } else if (scope.kind === 'CHAPTER' && scope.chapterId) {
          const planItem = this.database.sqlite
            .prepare('SELECT story_plan_item_id as planItemId FROM chapters WHERE id=?')
            .get(scope.chapterId) as { planItemId: string | null } | undefined;
          if (planItem?.planItemId)
            invalidated += this.invalidateWorkflowRowsForProjectEntity(
              scope.projectId,
              'GENERATE_CHAPTER_V2',
              planItem.planItemId,
              error,
              scope.excludeStepId,
              scope.excludeStepIds,
            );
        }
        for (const chapterId of chapterIds) {
          if (!scope.preserveCurrentSummary) {
            this.database.sqlite
              .prepare(
                "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
              )
              .run(chapterId);
          }
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
          invalidated += this.invalidateWorkflowRows(
            [scope.projectId],
            ['RENDER'],
            error,
            scope.excludeStepId,
            scope.excludeStepIds,
          );
          this.database.sqlite
            .prepare(
              "UPDATE assets SET is_current=0,updated_at=? WHERE project_id=? AND role='project:render'",
            )
            .run(now(), scope.projectId);
        }
      }
      if (scope.kind === 'SUMMARY' && scope.chapterId) {
        invalidated += this.invalidateWorkflowRows(
          [scope.chapterId],
          storyTypes.summary,
          error,
          scope.excludeStepId,
          scope.excludeStepIds,
        );
        this.database.sqlite
          .prepare(
            "UPDATE story_summary_revisions SET is_current=0,status='STALE' WHERE chapter_id=?",
          )
          .run(scope.chapterId);
      }
      if (
        scope.kind === 'SETTINGS' ||
        scope.kind === 'BLUEPRINT' ||
        scope.kind === 'PLAN' ||
        scope.kind === 'PLAN_ITEM'
      ) {
        this.database.sqlite
          .prepare(
            "UPDATE story_generation_batches SET status='PAUSED',error=?,updated_at=? WHERE project_id=? AND status IN ('PENDING','RUNNING')",
          )
          .run(error, now(), scope.projectId);
      }
      return invalidated;
    })();
  }

  fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  snapshot(
    projectId: Id,
    options: {
      planLimit?: number;
      planOffset?: number;
      summaryLimit?: number;
      summaryOffset?: number;
      windowLimit?: number;
      windowOffset?: number;
    },
  ): {
    settings: StorySettingsDto | null;
    blueprint: StoryBlueprintDto | null;
    plan: StoryPlanDto | null;
    summaries: StorySummaryDto[];
    threads: StoryThread[];
    arcs: StoryArc[];
    planWindows: StoryPlanWindowSummary[];
    state: StoryState;
    longStoryCounts: {
      targetChapterCount: number;
      arcCount: number;
      plannedChapterCount: number;
      generatedChapterCount: number;
      continuityWarningCount: number;
      staleChapterCount: number;
      currentBlockingChapter: number | null;
    };
    batches: StoryGenerationBatch[];
    usageSummary: {
      operations: number;
      knownInputTokens: number;
      knownOutputTokens: number;
      knownCostUsd: number;
      unavailableCount: number;
    };
    recentUsage: AiUsage[];
    contextDiagnostics: StoryContextDiagnostic[];
    continuityChecks: StoryContinuityCheckRecord[];
  } {
    const batches = new StoryBatchRepository(this.database).list(projectId);
    return {
      settings: this.getSettings(projectId),
      blueprint: this.getBlueprint(projectId),
      plan: this.getPlan(projectId, options.planLimit ?? 20, options.planOffset ?? 0),
      arcs: this.getArcs(projectId),
      threads: this.getThreads(projectId),
      summaries: this.getSummaries(
        projectId,
        options.summaryLimit ?? 50,
        options.summaryOffset ?? 0,
      ),
      planWindows: this.getPlanWindowSummaries(
        projectId,
        options.windowLimit ?? 100,
        options.windowOffset ?? 0,
      ),
      state: this.getStoryState(projectId),
      longStoryCounts: this.getLongStoryCounts(projectId),
      batches,
      usageSummary: this.getUsageSummary(projectId),
      contextDiagnostics: this.getContextDiagnostics(projectId, 20),
      recentUsage: this.getUsage(projectId, 20),
      continuityChecks: this.getContinuityChecks(projectId, 50),
    };
  }
}
