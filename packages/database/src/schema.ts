import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  language: text('language').notNull(),
  workflowType: text('workflow_type').notNull().default('AUDIO_STORY'),
  status: text('status').notNull().default('ACTIVE'),
  renderConfig: text('render_config').notNull(),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps,
});

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    revision: integer('revision').notNull().default(1),
    rowVersion: integer('row_version').notNull().default(1),
    storyOrigin: text('story_origin').notNull().default('MANUAL'),
    storyPlanItemId: text('story_plan_item_id'),
    storyGenerationId: text('story_generation_id'),
    continuityStatus: text('continuity_status').notNull().default('CURRENT'),
    sourceStateRevision: integer('source_state_revision'),
    continuityCheckStatus: text('continuity_check_status'),
    ...timestamps,
  },
  (table) => ({
    projectNumber: uniqueIndex('chapters_project_number_idx').on(table.projectId, table.number),
    continuity: index('chapters_continuity_idx').on(
      table.projectId,
      table.continuityStatus,
      table.number,
    ),
  }),
);

export const workflowExecutions = sqliteTable('workflow_executions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('PENDING'),
  cancellationRequestedAt: text('cancellation_requested_at'),
  ...timestamps,
});

export const workflowSteps = sqliteTable(
  'workflow_steps',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    type: text('type').notNull(),
    entityId: text('entity_id').notNull(),
    status: text('status').notNull().default('PENDING'),
    inputFingerprint: text('input_fingerprint').notNull(),
    progress: real('progress').notNull().default(0),
    progressMessage: text('progress_message').notNull().default(''),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: text('next_attempt_at'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: text('lease_expires_at'),
    currentAttemptId: text('current_attempt_id'),
    cancellationRequestedAt: text('cancellation_requested_at'),
    error: text('error'),
    ...timestamps,
  },
  (table) => ({
    executionStep: uniqueIndex('workflow_steps_execution_key_idx').on(
      table.executionId,
      table.stepKey,
    ),
    claim: index('workflow_steps_claim_idx').on(table.status, table.nextAttemptAt, table.createdAt),
  }),
);

export const workflowStepDependencies = sqliteTable('workflow_step_dependencies', {
  stepId: text('step_id')
    .notNull()
    .references(() => workflowSteps.id, { onDelete: 'cascade' }),
  dependsOnStepId: text('depends_on_step_id')
    .notNull()
    .references(() => workflowSteps.id, { onDelete: 'cascade' }),
  required: integer('required').notNull().default(1),
});

export const workflowAttempts = sqliteTable(
  'workflow_step_attempts',
  {
    id: text('id').primaryKey(),
    stepId: text('step_id')
      .notNull()
      .references(() => workflowSteps.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    workerId: text('worker_id').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    heartbeatAt: text('heartbeat_at'),
    finishedAt: text('finished_at'),
    error: text('error'),
    checkpoint: text('checkpoint'),
  },
  (table) => ({
    uniqueAttempt: uniqueIndex('workflow_attempts_step_number_idx').on(
      table.stepId,
      table.attemptNumber,
    ),
  }),
);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  entityId: text('entity_id').notNull(),
  stepId: text('step_id')
    .notNull()
    .references(() => workflowSteps.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('PENDING'),
  progress: real('progress').notNull().default(0),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('READY'),
    path: text('path').notNull().unique(),
    mediaType: text('media_type').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    sourceEntityId: text('source_entity_id'),
    sourceStepId: text('source_step_id'),
    inputFingerprint: text('input_fingerprint'),
    metadata: text('metadata').notNull().default('{}'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    validationError: text('validation_error'),
    ...timestamps,
  },
  (table) => ({
    currentRole: index('assets_current_role_idx').on(table.projectId, table.role, table.isCurrent),
    type: index('assets_project_type_idx').on(table.projectId, table.type),
  }),
);

export const assetDependencies = sqliteTable('asset_dependencies', {
  assetId: text('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  dependsOnAssetId: text('depends_on_asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  sourceHash: text('source_hash').notNull(),
});

export const ttsSegments = sqliteTable(
  'tts_segments',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    index: integer('segment_index').notNull(),
    text: text('text').notNull(),
    textHash: text('text_hash').notNull(),
    status: text('status').notNull().default('PENDING'),
    audioAssetId: text('audio_asset_id').references(() => assets.id),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    fingerprint: text('fingerprint').notNull(),
  },
  (table) => ({
    chapterIndex: uniqueIndex('tts_segments_chapter_index_idx').on(table.chapterId, table.index),
  }),
);

export const workerHeartbeats = sqliteTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  lastSeenAt: text('last_seen_at').notNull(),
  status: text('status').notNull(),
  version: text('version').notNull(),
});

export const renderJobs = sqliteTable('render_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  stepId: text('step_id')
    .notNull()
    .references(() => workflowSteps.id, { onDelete: 'cascade' }),
  timelineAssetId: text('timeline_asset_id').references(() => assets.id),
  outputAssetId: text('output_asset_id').references(() => assets.id),
  expectedDurationMs: integer('expected_duration_ms'),

  actualDurationMs: integer('actual_duration_ms'),
  status: text('status').notNull().default('PENDING'),
  ...timestamps,
});

export const storySettingsRevisions = sqliteTable('story_settings_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  mode: text('mode').notNull(),
  payload: text('payload').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const storyBlueprintRevisions = sqliteTable('story_blueprint_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  settingsRevisionId: text('settings_revision_id')
    .notNull()
    .references(() => storySettingsRevisions.id),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  metadata: text('metadata'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const storyPlanRevisions = sqliteTable('story_plan_revisions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  blueprintRevisionId: text('blueprint_revision_id')
    .notNull()
    .references(() => storyBlueprintRevisions.id),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  metadata: text('metadata'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const storyPlanItems = sqliteTable('story_plan_items', {
  id: text('id').primaryKey(),
  planRevisionId: text('plan_revision_id')
    .notNull()
    .references(() => storyPlanRevisions.id, { onDelete: 'cascade' }),
  stableId: text('stable_id').notNull(),
  chapterNumber: integer('chapter_number').notNull(),
  payload: text('payload').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  createdAt: text('created_at').notNull(),
});

export const storyThreads = sqliteTable('story_threads', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  stableId: text('stable_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const storyThreadRevisions = sqliteTable('story_thread_revisions', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => storyThreads.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  sourceChapterId: text('source_chapter_id').references(() => chapters.id, {
    onDelete: 'set null',
  }),
  payload: text('payload').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const storySummaryRevisions = sqliteTable('story_summary_revisions', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  chapterRevision: integer('chapter_revision').notNull(),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
  events: text('events').notNull().default('[]'),
  threadTransitions: text('thread_transitions').notNull().default('[]'),
  warnings: text('warnings').notNull().default('[]'),
  metadata: text('metadata'),
  inputFingerprint: text('input_fingerprint').notNull(),
  status: text('status').notNull().default('CURRENT'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const storyGenerationRecords = sqliteTable('story_generation_records', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(),
  targetId: text('target_id').notNull(),
  workflowStepId: text('workflow_step_id').references(() => workflowSteps.id, {
    onDelete: 'set null',
  }),
  inputFingerprint: text('input_fingerprint').notNull(),
  metadata: text('metadata').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});
export const storyArcRevisions = sqliteTable(
  'story_arc_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stableId: text('stable_id').notNull(),
    revision: integer('revision').notNull(),
    ordinalIndex: integer('ordinal_index').notNull().default(1),
    startChapter: integer('start_chapter').notNull(),
    endChapter: integer('end_chapter').notNull(),
    title: text('title').notNull(),
    goal: text('goal').notNull(),
    conflict: text('conflict').notNull(),
    importantCharacterIds: text('important_character_ids').notNull().default('[]'),
    importantThreadIds: text('important_thread_ids').notNull().default('[]'),
    plannedOutcome: text('planned_outcome').notNull(),
    status: text('status').notNull().default('PLANNED'),
    sourceBlueprintRevisionId: text('source_blueprint_revision_id')
      .notNull()
      .references(() => storyBlueprintRevisions.id),
    inputFingerprint: text('input_fingerprint'),
    metadata: text('metadata'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    current: uniqueIndex('story_arc_current_idx')
      .on(table.projectId, table.stableId)
      .where(sql`${table.isCurrent} = 1`),
    range: index('story_arc_range_idx').on(
      table.projectId,
      table.startChapter,
      table.endChapter,
      table.isCurrent,
    ),
  }),
);

export const storyPlanWindowRevisions = sqliteTable(
  'story_plan_window_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stableId: text('stable_id').notNull(),
    revision: integer('revision').notNull(),
    arcId: text('arc_id')
      .notNull()
      .references(() => storyArcRevisions.id),
    startChapter: integer('start_chapter').notNull(),
    endChapter: integer('end_chapter').notNull(),
    sourceBlueprintRevisionId: text('source_blueprint_revision_id')
      .notNull()
      .references(() => storyBlueprintRevisions.id),
    priorWindowSummary: text('prior_window_summary'),
    payload: text('payload').notNull(),
    inputFingerprint: text('input_fingerprint'),
    status: text('status').notNull().default('PLANNED'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    current: uniqueIndex('story_plan_window_current_idx')
      .on(table.projectId, table.stableId)
      .where(sql`${table.isCurrent} = 1`),
    range: index('story_plan_window_range_idx').on(
      table.projectId,
      table.startChapter,
      table.endChapter,
      table.isCurrent,
    ),
  }),
);

export const storyPlanWindowItems = sqliteTable(
  'story_plan_window_items',
  {
    id: text('id').primaryKey(),
    windowRevisionId: text('window_revision_id')
      .notNull()
      .references(() => storyPlanWindowRevisions.id, { onDelete: 'cascade' }),
    stableId: text('stable_id').notNull(),
    chapterNumber: integer('chapter_number').notNull(),
    payload: text('payload').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    stable: uniqueIndex('story_plan_window_items_stable_idx').on(
      table.windowRevisionId,
      table.stableId,
    ),
    number: uniqueIndex('story_plan_window_items_number_idx').on(
      table.windowRevisionId,
      table.chapterNumber,
    ),
  }),
);

export const storyStateRevisions = sqliteTable(
  'story_state_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    currentChapter: integer('current_chapter').notNull(),
    sourceChapterId: text('source_chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    sourceChapterRevision: integer('source_chapter_revision'),
    previousRevisionId: text('previous_revision_id'),
    payload: text('payload').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    status: text('status').notNull().default('CURRENT'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    current: uniqueIndex('story_state_current_idx')
      .on(table.projectId)
      .where(sql`${table.isCurrent} = 1`),
    checkpoint: index('story_state_checkpoint_idx').on(
      table.projectId,
      table.currentChapter,
      table.revision,
    ),
  }),
);

export const storyStateDeltas = sqliteTable(
  'story_state_deltas',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceChapterId: text('source_chapter_id').references(() => chapters.id, {
      onDelete: 'set null',
    }),
    sourceChapterRevision: integer('source_chapter_revision'),
    sourceGenerationId: text('source_generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    targetStateRevisionId: text('target_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    payload: text('payload').notNull(),
    validationStatus: text('validation_status').notNull().default('VALID'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    source: index('story_state_delta_source_idx').on(
      table.projectId,
      table.sourceChapterId,
      table.sourceChapterRevision,
    ),
  }),
);

export const storyCharacterStates = sqliteTable(
  'story_character_states',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    characterId: text('character_id').notNull(),
    location: text('location'),
    currentGoal: text('current_goal'),
    powerLevel: text('power_level'),
    injuries: text('injuries').notNull().default('[]'),
    possessions: text('possessions').notNull().default('[]'),
    relationships: text('relationships').notNull().default('[]'),
    knowledge: text('knowledge').notNull().default('[]'),
    lastUpdatedChapter: integer('last_updated_chapter'),
    sourceStateRevisionId: text('source_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    ...timestamps,
  },
  (table) => ({
    character: uniqueIndex('story_character_states_character_idx').on(
      table.projectId,
      table.characterId,
    ),
    updated: index('story_character_state_updated_idx').on(
      table.projectId,
      table.lastUpdatedChapter,
    ),
  }),
);

export const storyImportantFacts = sqliteTable(
  'story_important_facts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stableId: text('stable_id').notNull(),
    text: text('text').notNull(),
    importance: text('importance').notNull(),
    introducedChapter: integer('introduced_chapter').notNull(),
    lastConfirmedChapter: integer('last_confirmed_chapter').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    sourceStateRevisionId: text('source_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    ...timestamps,
  },
  (table) => ({
    stable: uniqueIndex('story_facts_stable_idx').on(table.projectId, table.stableId),
    relevance: index('story_facts_relevance_idx').on(
      table.projectId,
      table.status,
      table.importance,
      table.lastConfirmedChapter,
    ),
  }),
);

export const storyEvents = sqliteTable(
  'story_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stableId: text('stable_id').notNull(),
    chapterNumber: integer('chapter_number').notNull(),
    type: text('type').notNull(),
    description: text('description').notNull(),
    importance: text('importance').notNull(),
    characterIds: text('character_ids').notNull().default('[]'),
    threadIds: text('thread_ids').notNull().default('[]'),
    sourceStateRevisionId: text('source_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    stable: uniqueIndex('story_events_stable_idx').on(table.projectId, table.stableId),
    relevance: index('story_events_relevance_idx').on(
      table.projectId,
      table.chapterNumber,
      table.importance,
    ),
  }),
);

export const storyChapterLineage = sqliteTable(
  'story_chapter_lineage',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    chapterRevision: integer('chapter_revision').notNull(),
    sourceStateRevisionId: text('source_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    sourceGenerationId: text('source_generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    continuityStatus: text('continuity_status').notNull().default('CURRENT'),
    continuityCheckStatus: text('continuity_check_status'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    chapterRevision: uniqueIndex('story_chapter_lineage_revision_idx').on(
      table.chapterId,
      table.chapterRevision,
    ),
    status: index('story_chapter_lineage_status_idx').on(
      table.projectId,
      table.continuityStatus,
      table.chapterRevision,
    ),
  }),
);

export const storyGenerationBatches = sqliteTable(
  'story_generation_batches',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    startChapter: integer('start_chapter').notNull(),
    endChapter: integer('end_chapter').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('PENDING'),
    total: integer('total').notNull(),
    completed: integer('completed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    error: text('error'),
    ...timestamps,
  },
  (table) => ({
    project: index('story_generation_batches_project_idx').on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
  }),
);

export const storyGenerationBatchItems = sqliteTable(
  'story_generation_batch_items',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => storyGenerationBatches.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterNumber: integer('chapter_number').notNull(),
    planItemId: text('plan_item_id').notNull(),
    workflowStepId: text('workflow_step_id')
      .notNull()
      .references(() => workflowSteps.id, {
        onDelete: 'cascade',
      }),
    outcome: text('outcome').notNull().default('PENDING'),
    inputFingerprint: text('input_fingerprint'),
    error: text('error'),
    skipReason: text('skip_reason'),
    ...timestamps,
  },
  (table) => ({
    batchChapter: uniqueIndex('story_batch_items_batch_chapter_idx').on(
      table.batchId,
      table.chapterNumber,
    ),
    projectChapter: index('story_batch_items_project_chapter_idx').on(
      table.projectId,
      table.chapterNumber,
      table.outcome,
    ),
    status: index('story_batch_items_status_idx').on(
      table.batchId,
      table.outcome,
      table.chapterNumber,
    ),
  }),
);

export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    entityId: text('entity_id').notNull(),
    attempt: integer('attempt').notNull(),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    costUsd: real('cost_usd'),
    currency: text('currency'),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    projectCreated: index('ai_usage_project_created_idx').on(table.projectId, table.createdAt),
    entity: index('ai_usage_entity_idx').on(
      table.projectId,
      table.entityId,
      table.operation,
      table.attempt,
    ),
  }),
);

export const storyContinuityChecks = sqliteTable(
  'story_continuity_checks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    chapterRevision: integer('chapter_revision').notNull(),
    sourceStateRevisionId: text('source_state_revision_id').references(
      () => storyStateRevisions.id,
      {
        onDelete: 'set null',
      },
    ),
    status: text('status').notNull(),
    issues: text('issues').notNull().default('[]'),
    metadata: text('metadata'),
    stateDelta: text('state_delta'),
    summary: text('summary'),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    chapter: index('story_continuity_checks_chapter_idx').on(
      table.chapterId,
      table.chapterRevision,
      table.createdAt,
    ),
  }),
);
