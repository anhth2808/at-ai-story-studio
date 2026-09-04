import { sql } from 'drizzle-orm';
import {
  integer,
  index,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    payload: text('payload').notNull().default('{}'),
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

export const assetDependencies = sqliteTable(
  'asset_dependencies',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    dependsOnAssetId: text('depends_on_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    sourceHash: text('source_hash').notNull(),
  },
  (table) => ({
    uniqueDependency: uniqueIndex('asset_dependencies_unique_idx').on(
      table.assetId,
      table.dependsOnAssetId,
      table.role,
    ),
    dependsOn: index('asset_dependencies_depends_on_idx').on(table.dependsOnAssetId, table.assetId),
  }),
);

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
    chapterRevision: integer('chapter_revision'),
    sourceStartOffset: integer('source_start_offset'),
    sourceEndOffset: integer('source_end_offset'),
    sourceText: text('source_text'),
    status: text('status').notNull().default('PENDING'),
    audioAssetId: text('audio_asset_id').references(() => assets.id),
    durationMs: integer('duration_ms'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    fingerprint: text('fingerprint').notNull(),
  },
  (table) => ({
    chapterIndex: uniqueIndex('tts_segments_chapter_index_idx').on(table.chapterId, table.index),
    chapterRevision: index('tts_segments_chapter_revision_idx').on(
      table.chapterId,
      table.chapterRevision,
      table.index,
    ),
  }),
);

export const sceneTimingRevisions = sqliteTable(
  'scene_timing_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    chapterRevision: integer('chapter_revision').notNull(),
    audioAssetId: text('audio_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    revision: integer('revision').notNull(),
    durationMs: integer('duration_ms').notNull(),
    minimumSceneDurationMs: integer('minimum_scene_duration_ms').notNull(),
    items: text('items').notNull(),
    warnings: text('warnings').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    status: text('status').notNull().default('COMPLETED'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('scene_timing_chapter_revision_idx').on(table.chapterId, table.revision),
    current: uniqueIndex('scene_timing_current_idx')
      .on(table.chapterId)
      .where(sql`${table.isCurrent} = 1`),
    project: index('scene_timing_project_idx').on(
      table.projectId,
      table.chapterId,
      table.isCurrent,
      table.revision,
    ),
  }),
);

export const motionPlanRevisions = sqliteTable(
  'motion_plan_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    timingRevisionId: text('timing_revision_id').references(() => sceneTimingRevisions.id, {
      onDelete: 'set null',
    }),
    revision: integer('revision').notNull(),
    motionType: text('motion_type').notNull(),
    startScale: real('start_scale').notNull(),
    endScale: real('end_scale').notNull(),
    startPositionX: real('start_position_x').notNull(),
    startPositionY: real('start_position_y').notNull(),
    endPositionX: real('end_position_x').notNull(),
    endPositionY: real('end_position_y').notNull(),
    easing: text('easing').notNull(),
    focusPointX: real('focus_point_x'),
    focusPointY: real('focus_point_y'),
    intensity: real('intensity').notNull().default(0.5),
    durationMs: integer('duration_ms').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    status: text('status').notNull().default('COMPLETED'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('motion_plan_scene_revision_idx').on(
      table.sceneRevisionId,
      table.revision,
    ),
    current: uniqueIndex('motion_plan_current_idx')
      .on(table.sceneStableId, table.sceneRevisionId)
      .where(sql`${table.isCurrent} = 1`),
    scene: index('motion_plan_scene_idx').on(
      table.projectId,
      table.chapterId,
      table.sceneStableId,
      table.isCurrent,
      table.revision,
    ),
    timing: index('motion_plan_timing_idx').on(table.timingRevisionId),
  }),
);

export const workerHeartbeats = sqliteTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  lastSeenAt: text('last_seen_at').notNull(),
  status: text('status').notNull(),
  version: text('version').notNull(),
});

export const renderJobs = sqliteTable(
  'render_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => workflowSteps.id, { onDelete: 'cascade' }),
    renderType: text('render_type').notNull().default('LEGACY_PROJECT'),
    scopeId: text('scope_id'),
    timelineAssetId: text('timeline_asset_id').references(() => assets.id),
    outputAssetId: text('output_asset_id').references(() => assets.id),
    expectedDurationMs: integer('expected_duration_ms'),
    actualDurationMs: integer('actual_duration_ms'),
    progressTimeMs: integer('progress_time_ms'),
    diagnostics: text('diagnostics'),
    status: text('status').notNull().default('PENDING'),
    ...timestamps,
  },
  (table) => ({
    scope: index('render_jobs_scope_idx').on(
      table.projectId,
      table.renderType,
      table.scopeId,
      table.status,
    ),
  }),
);

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

export const visualStyleSettings = sqliteTable(
  'visual_style_settings',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    styleName: text('style_name').notNull(),
    styleDescription: text('style_description').notNull().default(''),
    medium: text('medium').notNull().default(''),
    realism: text('realism').notNull().default(''),
    overallStyle: text('overall_style').notNull().default(''),
    colorPalette: text('color_palette').notNull().default(''),
    cinematicStyle: text('cinematic_style').notNull().default(''),
    cinematicLanguage: text('cinematic_language').notNull().default(''),
    lightingStyle: text('lighting_style').notNull().default(''),
    textureStyle: text('texture_style').notNull().default(''),
    environmentStyle: text('environment_style').notNull().default(''),
    characterRenderingStyle: text('character_rendering_style').notNull().default(''),
    cameraStyle: text('camera_style').notNull().default(''),
    compositionStyle: text('composition_style').notNull().default(''),
    moodKeywords: text('mood_keywords').notNull().default('[]'),
    aspectRatio: text('aspect_ratio').notNull().default('16:9'),
    promptSuffix: text('prompt_suffix').notNull().default(''),
    positivePromptSuffix: text('positive_prompt_suffix').notNull().default(''),
    negativePrompt: text('negative_prompt').notNull().default(''),
    referenceAssetIds: text('reference_asset_ids').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    rowVersion: integer('row_version').notNull().default(1),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('visual_style_settings_revision_idx').on(table.projectId, table.revision),
    current: uniqueIndex('visual_style_settings_current_idx')
      .on(table.projectId)
      .where(sql`${table.isCurrent} = 1`),
  }),
);

export const locations = sqliteTable(
  'locations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    description: text('description').notNull().default(''),
    type: text('type').notNull().default(''),
    visualDescription: text('visual_description').notNull().default(''),
    environment: text('environment').notNull().default(''),
    architecture: text('architecture').notNull().default(''),
    importantObjects: text('important_objects').notNull().default('[]'),
    lightingDefaults: text('lighting_defaults').notNull().default(''),
    status: text('status').notNull().default('DRAFT'),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps,
  },
  (table) => ({
    normalized: index('locations_project_normalized_idx').on(table.projectId, table.normalizedName),
  }),
);

export const scenePlanRevisions = sqliteTable(
  'scene_plan_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    chapterRevision: integer('chapter_revision').notNull(),
    revision: integer('revision').notNull(),
    density: text('density').notNull(),
    targetRange: text('target_range'),
    styleRevisionId: text('style_revision_id').references(() => visualStyleSettings.id, {
      onDelete: 'set null',
    }),
    inputFingerprint: text('input_fingerprint').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    metadata: text('metadata'),
    status: text('status').notNull().default('CURRENT'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('scene_plan_chapter_revision_idx').on(table.chapterId, table.revision),
    current: uniqueIndex('scene_plan_current_idx')
      .on(table.chapterId)
      .where(sql`${table.isCurrent} = 1`),
    projectStatus: index('scene_plan_project_status_idx').on(
      table.projectId,
      table.status,
      table.chapterId,
    ),
  }),
);

export const sceneRevisions = sqliteTable(
  'scene_revisions',
  {
    id: text('id').primaryKey(),
    stableId: text('stable_id').notNull(),
    scenePlanRevisionId: text('scene_plan_revision_id')
      .notNull()
      .references(() => scenePlanRevisions.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    chapterRevision: integer('chapter_revision').notNull(),
    sourceContent: text('source_content').notNull().default(''),
    sceneNumber: integer('scene_number').notNull(),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    purpose: text('purpose').notNull(),
    sourceStartOffset: integer('source_start_offset').notNull(),
    sourceEndOffset: integer('source_end_offset').notNull(),
    locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
    locationNameSnapshot: text('location_name_snapshot'),
    timeOfDay: text('time_of_day').notNull().default(''),
    weather: text('weather').notNull().default(''),
    mood: text('mood').notNull().default(''),
    visualDescription: text('visual_description').notNull(),
    camera: text('camera').notNull(),
    composition: text('composition').notNull(),
    importantObjects: text('important_objects').notNull().default('[]'),
    lighting: text('lighting').notNull().default(''),
    colorMood: text('color_mood').notNull().default(''),
    imagePrompt: text('image_prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    continuityNotes: text('continuity_notes').notNull().default(''),
    unresolvedReferences: text('unresolved_references').notNull().default('[]'),
    status: text('status').notNull().default('CURRENT'),
    promptStatus: text('prompt_status').notNull().default('CURRENT'),
    styleRevisionId: text('style_revision_id').references(() => visualStyleSettings.id, {
      onDelete: 'set null',
    }),
    inputFingerprint: text('input_fingerprint').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('scene_revision_stable_revision_idx').on(
      table.scenePlanRevisionId,
      table.stableId,
      table.revision,
    ),
    current: uniqueIndex('scene_revision_current_idx')
      .on(table.scenePlanRevisionId, table.stableId)
      .where(sql`${table.isCurrent} = 1`),
    chapterNumber: index('scene_revision_chapter_number_idx').on(
      table.chapterId,
      table.sceneNumber,
      table.isCurrent,
    ),
    location: index('scene_revision_location_idx').on(table.locationId, table.isCurrent),
  }),
);

export const sceneCharacters = sqliteTable(
  'scene_characters',
  {
    id: text('id').primaryKey(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    characterId: text('character_id'),
    displayName: text('display_name').notNull(),
    resolutionStatus: text('resolution_status').notNull().default('UNRESOLVED'),
    roleInScene: text('role_in_scene').notNull().default(''),
    visualState: text('visual_state').notNull().default('{}'),
    dependencyFingerprint: text('dependency_fingerprint'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    scene: index('scene_characters_scene_idx').on(table.sceneRevisionId),
    character: index('scene_characters_character_idx').on(table.characterId, table.sceneRevisionId),
  }),
);
export const characterVisualProfiles = sqliteTable(
  'character_visual_profiles',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    characterId: text('character_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('DRAFT'),
    payload: text('payload').notNull(),
    promptFragment: text('prompt_fragment').notNull().default(''),
    referenceAssetIds: text('reference_asset_ids').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    rowVersion: integer('row_version').notNull().default(1),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('character_visual_profiles_revision_idx').on(
      table.projectId,
      table.characterId,
      table.revision,
    ),
    current: uniqueIndex('character_visual_profiles_current_idx')
      .on(table.projectId, table.characterId)
      .where(sql`${table.isCurrent} = 1`),
    projectStatus: index('character_visual_profiles_project_status_idx').on(
      table.projectId,
      table.status,
      table.characterId,
    ),
  }),
);

export const locationVisualProfiles = sqliteTable(
  'location_visual_profiles',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    locationName: text('location_name').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('DRAFT'),
    payload: text('payload').notNull(),
    promptFragment: text('prompt_fragment').notNull().default(''),
    referenceAssetIds: text('reference_asset_ids').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    rowVersion: integer('row_version').notNull().default(1),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('location_visual_profiles_revision_idx').on(
      table.projectId,
      table.locationId,
      table.revision,
    ),
    current: uniqueIndex('location_visual_profiles_current_idx')
      .on(table.projectId, table.locationId)
      .where(sql`${table.isCurrent} = 1`),
    projectStatus: index('location_visual_profiles_project_status_idx').on(
      table.projectId,
      table.status,
      table.locationId,
    ),
  }),
);

export const visualObjectProfiles = sqliteTable(
  'visual_object_profiles',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    name: text('name').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('DRAFT'),
    payload: text('payload').notNull(),
    promptFragment: text('prompt_fragment').notNull().default(''),
    referenceAssetIds: text('reference_asset_ids').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    rowVersion: integer('row_version').notNull().default(1),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('visual_object_profiles_revision_idx').on(
      table.projectId,
      table.objectKey,
      table.revision,
    ),
    current: uniqueIndex('visual_object_profiles_current_idx')
      .on(table.projectId, table.objectKey)
      .where(sql`${table.isCurrent} = 1`),
    projectStatus: index('visual_object_profiles_project_status_idx').on(
      table.projectId,
      table.status,
      table.objectKey,
    ),
  }),
);

export const sceneObjectResolutions = sqliteTable(
  'scene_object_resolutions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    sourceLabel: text('source_label').notNull(),
    normalizedKey: text('normalized_key').notNull(),
    visualObjectProfileId: text('visual_object_profile_id').references(
      () => visualObjectProfiles.id,
      {
        onDelete: 'set null',
      },
    ),
    resolutionStatus: text('resolution_status').notNull().default('UNRESOLVED'),
    ...timestamps,
  },
  (table) => ({
    sceneKey: uniqueIndex('scene_object_resolutions_scene_key_idx').on(
      table.sceneRevisionId,
      table.normalizedKey,
    ),
    scene: index('scene_object_resolutions_scene_idx').on(
      table.sceneRevisionId,
      table.resolutionStatus,
    ),
    profile: index('scene_object_resolutions_profile_idx').on(
      table.visualObjectProfileId,
      table.sceneRevisionId,
    ),
  }),
);

export const visualPromptPackages = sqliteTable(
  'visual_prompt_packages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('CURRENT'),
    payload: text('payload').notNull(),
    consistencyStatus: text('consistency_status').notNull(),
    consistencyIssues: text('consistency_issues').notNull().default('[]'),
    inputFingerprint: text('input_fingerprint').notNull(),
    promptTemplateVersion: text('prompt_template_version').notNull(),
    generationId: text('generation_id').references(() => storyGenerationRecords.id, {
      onDelete: 'set null',
    }),
    rowVersion: integer('row_version').notNull().default(1),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    revision: uniqueIndex('visual_prompt_packages_revision_idx').on(
      table.sceneRevisionId,
      table.revision,
    ),
    current: uniqueIndex('visual_prompt_packages_current_idx')
      .on(table.sceneRevisionId)
      .where(sql`${table.isCurrent} = 1`),
    projectStatus: index('visual_prompt_packages_project_status_idx').on(
      table.projectId,
      table.status,
      table.sceneRevisionId,
    ),
  }),
);

export const visualPromptPackageDependencies = sqliteTable(
  'visual_prompt_package_dependencies',
  {
    packageId: text('package_id')
      .notNull()
      .references(() => visualPromptPackages.id, { onDelete: 'cascade' }),
    dependencyKind: text('dependency_kind').notNull(),
    dependencyKey: text('dependency_key').notNull(),
    dependencyRevisionId: text('dependency_revision_id').notNull(),
    dependencyRevision: integer('dependency_revision').notNull(),
    dependencyFingerprint: text('dependency_fingerprint').notNull(),
  },
  (table) => ({
    primary: primaryKey({
      columns: [table.packageId, table.dependencyKind, table.dependencyKey],
      name: 'visual_prompt_package_dependencies_primary',
    }),
    lookup: index('visual_prompt_package_dependencies_lookup_idx').on(
      table.dependencyKind,
      table.dependencyKey,
      table.dependencyRevisionId,
    ),
    package: index('visual_prompt_package_dependencies_package_idx').on(table.packageId),
  }),
);

export const imageGenerationSettings = sqliteTable(
  'image_generation_settings',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('COMFYUI'),
    baseUrl: text('base_url').notNull().default('http://127.0.0.1:8188'),
    workflowTemplate: text('workflow_template').notNull().default('text-to-image-v1'),
    diffusionModel: text('diffusion_model').notNull().default(''),
    textEncoder: text('text_encoder').notNull().default(''),
    vaeName: text('vae_name').notNull().default(''),
    sampler: text('sampler').notNull().default('euler'),
    connectionTimeoutMs: integer('connection_timeout_ms').notNull().default(5000),
    generationTimeoutMs: integer('generation_timeout_ms').notNull().default(3_600_000),
    width: integer('width').notNull().default(1024),
    height: integer('height').notNull().default(576),
    steps: integer('steps').notNull().default(20),
    guidance: real('guidance').notNull().default(5),
    seedMode: text('seed_mode').notNull().default('RANDOM'),
    fixedSeed: integer('fixed_seed'),
    rowVersion: integer('row_version').notNull().default(1),
    requireImageApproval: integer('require_image_approval', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => ({
    project: uniqueIndex('image_generation_settings_project_idx').on(table.projectId),
  }),
);

export const sceneImageGenerations = sqliteTable(
  'scene_image_generations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    visualPromptPackageId: text('visual_prompt_package_id').references(
      () => visualPromptPackages.id,
      { onDelete: 'set null' },
    ),
    revision: integer('revision').notNull(),
    source: text('source').notNull().default('GENERATED'),
    provider: text('provider'),
    status: text('status').notNull().default('PENDING'),
    reviewStatus: text('review_status').notNull().default('UNREVIEWED'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    requestedSeed: integer('requested_seed'),
    actualSeed: integer('actual_seed'),
    requestedWidth: integer('requested_width'),
    requestedHeight: integer('requested_height'),
    actualWidth: integer('actual_width'),
    actualHeight: integer('actual_height'),
    providerJobId: text('provider_job_id'),
    workflowTemplate: text('workflow_template'),
    modelSettings: text('model_settings').notNull().default('{}'),
    packageFingerprint: text('package_fingerprint'),
    settingsFingerprint: text('settings_fingerprint'),
    inputFingerprint: text('input_fingerprint').notNull(),
    workflowStepId: text('workflow_step_id').references(() => workflowSteps.id, {
      onDelete: 'set null',
    }),
    assetId: text('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    candidateSetId: text('candidate_set_id'),
    candidateIndex: integer('candidate_index'),
    reviewScores: text('review_scores').notNull().default('{}'),
    reviewIssues: text('review_issues').notNull().default('[]'),
    attempt: integer('attempt').notNull().default(0),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    error: text('error'),
    notes: text('notes').notNull().default(''),
    generationInstructions: text('generation_instructions'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    revision: uniqueIndex('scene_image_generations_revision_idx').on(
      table.projectId,
      table.sceneStableId,
      table.revision,
    ),
    current: uniqueIndex('scene_image_generations_current_idx')
      .on(table.projectId, table.sceneStableId)
      .where(sql`${table.isCurrent} = 1`),
    scene: index('scene_image_generations_scene_idx').on(
      table.projectId,
      table.sceneStableId,
      table.revision,
    ),
    status: index('scene_image_generations_status_idx').on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
    providerJob: index('scene_image_generations_provider_job_idx').on(table.providerJobId),
  }),
);

export const sceneImageCandidateSets = sqliteTable(
  'scene_image_candidate_sets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    visualPromptPackageId: text('visual_prompt_package_id').references(
      () => visualPromptPackages.id,
      { onDelete: 'set null' },
    ),
    mode: text('mode').notNull().default('TEXT_ONLY'),
    workflowTemplate: text('workflow_template'),
    packageFingerprint: text('package_fingerprint'),
    settingsFingerprint: text('settings_fingerprint'),
    requestedCount: integer('requested_count').notNull(),
    sourceGenerationId: text('source_generation_id'),
    generationInstructions: text('generation_instructions'),
    metadata: text('metadata').notNull().default('{}'),
    ...timestamps,
  },
  (table) => ({
    scene: index('scene_image_candidate_sets_scene_idx').on(
      table.projectId,
      table.sceneStableId,
      table.createdAt,
    ),
    project: index('scene_image_candidate_sets_project_idx').on(table.projectId, table.createdAt),
  }),
);

export const videoGenerationSettings = sqliteTable(
  'video_generation_settings',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('COMFYUI'),
    baseUrl: text('base_url').notNull().default('http://127.0.0.1:8188'),
    workflowTemplate: text('workflow_template').notNull().default('image-to-video-v1'),
    diffusionModel: text('diffusion_model').notNull().default(''),
    textEncoder: text('text_encoder').notNull().default(''),
    vaeName: text('vae_name').notNull().default(''),
    sampler: text('sampler').notNull().default('uni_pc'),
    scheduler: text('scheduler').notNull().default('simple'),
    steps: integer('steps').notNull().default(20),
    guidance: real('guidance').notNull().default(5),
    shift: real('shift').notNull().default(8),
    preset: text('preset').notNull().default('BALANCED'),
    connectionTimeoutMs: integer('connection_timeout_ms').notNull().default(5000),
    generationTimeoutMs: integer('generation_timeout_ms').notNull().default(3_600_000),
    seedMode: text('seed_mode').notNull().default('RANDOM'),
    fixedSeed: integer('fixed_seed'),
    rowVersion: integer('row_version').notNull().default(1),
    requireMotionApproval: integer('require_motion_approval', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    project: uniqueIndex('video_generation_settings_project_idx').on(table.projectId),
  }),
);

export const sceneMotionSources = sqliteTable(
  'scene_motion_sources',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    motionSource: text('motion_source').notNull().default('KEN_BURNS'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    scene: uniqueIndex('scene_motion_sources_scene_idx').on(table.projectId, table.sceneStableId),
    project: index('scene_motion_sources_project_idx').on(table.projectId, table.motionSource),
  }),
);

export const aiMotionPlanRevisions = sqliteTable(
  'ai_motion_plan_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    characterAction: text('character_action').notNull().default(''),
    environmentMotion: text('environment_motion').notNull().default(''),
    cameraMotion: text('camera_motion').notNull().default('STATIC'),
    intensity: text('intensity').notNull().default('SUBTLE'),
    priority: text('priority').notNull().default('NONE'),
    motionPrompt: text('motion_prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    inputFingerprint: text('input_fingerprint').notNull(),
    status: text('status').notNull().default('CURRENT'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    revision: uniqueIndex('ai_motion_plan_revisions_revision_idx').on(
      table.sceneRevisionId,
      table.revision,
    ),
    current: uniqueIndex('ai_motion_plan_revisions_current_idx')
      .on(table.sceneRevisionId)
      .where(sql`${table.isCurrent} = 1`),
    scene: index('ai_motion_plan_revisions_scene_idx').on(
      table.projectId,
      table.sceneStableId,
      table.revision,
    ),
  }),
);

export const sceneVideoGenerations = sqliteTable(
  'scene_video_generations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    sceneStableId: text('scene_stable_id').notNull(),
    sceneRevisionId: text('scene_revision_id')
      .notNull()
      .references(() => sceneRevisions.id, { onDelete: 'cascade' }),
    aiMotionPlanRevisionId: text('ai_motion_plan_revision_id').references(
      () => aiMotionPlanRevisions.id,
      { onDelete: 'set null' },
    ),
    revision: integer('revision').notNull(),
    provider: text('provider'),
    status: text('status').notNull().default('PENDING'),
    reviewStatus: text('review_status').notNull().default('UNREVIEWED'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    requestedSeed: integer('requested_seed'),
    actualSeed: integer('actual_seed'),
    requestedWidth: integer('requested_width'),
    requestedHeight: integer('requested_height'),
    actualWidth: integer('actual_width'),
    actualHeight: integer('actual_height'),
    frameCount: integer('frame_count'),
    fps: integer('fps'),
    providerJobId: text('provider_job_id'),
    workflowTemplate: text('workflow_template'),
    modelSettings: text('model_settings').notNull().default('{}'),
    requestSnapshot: text('request_snapshot').notNull().default('{}'),
    motionPlanFingerprint: text('motion_plan_fingerprint'),
    settingsFingerprint: text('settings_fingerprint'),
    inputFingerprint: text('input_fingerprint').notNull(),
    sourceImageAssetId: text('source_image_asset_id').references(() => assets.id, {
      onDelete: 'set null',
    }),
    sourceImageSha256: text('source_image_sha256'),
    workflowStepId: text('workflow_step_id').references(() => workflowSteps.id, {
      onDelete: 'set null',
    }),
    assetId: text('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    reviewIssues: text('review_issues').notNull().default('[]'),
    reviewNotes: text('review_notes').notNull().default(''),
    attempt: integer('attempt').notNull().default(0),
    clipDurationMs: integer('clip_duration_ms'),
    generationDurationMs: integer('generation_duration_ms'),
    errorCode: text('error_code'),
    error: text('error'),
    generationInstructions: text('generation_instructions'),
    metadata: text('metadata').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    revision: uniqueIndex('scene_video_generations_revision_idx').on(
      table.projectId,
      table.sceneStableId,
      table.revision,
    ),
    current: uniqueIndex('scene_video_generations_current_idx')
      .on(table.projectId, table.sceneStableId)
      .where(sql`${table.isCurrent} = 1`),
    scene: index('scene_video_generations_scene_idx').on(
      table.projectId,
      table.sceneStableId,
      table.revision,
    ),
    providerJob: index('scene_video_generations_provider_job_idx').on(table.providerJobId),
    status: index('scene_video_generations_status_idx').on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  }),
);
export const productionProfiles = sqliteTable(
  'production_profiles',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    profileKey: text('profile_key').notNull(),
    revision: integer('revision').notNull(),
    settings: text('settings').notNull(),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps,
  },
  (table) => ({
    current: uniqueIndex('production_profiles_current_idx')
      .on(table.projectId, table.profileKey)
      .where(sql`${table.isCurrent} = 1`),
    revision: uniqueIndex('production_profiles_revision_idx').on(
      table.projectId,
      table.profileKey,
      table.revision,
    ),
    project: index('production_profiles_project_idx').on(table.projectId, table.updatedAt),
  }),
);

export const productionRuns = sqliteTable(
  'production_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workflowExecutionId: text('workflow_execution_id')
      .notNull()
      .references(() => workflowExecutions.id, { onDelete: 'restrict' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => productionProfiles.id, { onDelete: 'restrict' }),
    profileRevision: integer('profile_revision').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeStart: integer('scope_start'),
    scopeEnd: integer('scope_end'),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    currentStage: text('current_stage'),
    rowVersion: integer('row_version').notNull().default(1),
    coordinatorSequence: integer('coordinator_sequence').notNull().default(0),
    progressCurrent: integer('progress_current').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    metrics: text('metrics').notNull().default('{}'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    pausedAt: text('paused_at'),
    completedAt: text('completed_at'),
    cancellationRequestedAt: text('cancellation_requested_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    execution: uniqueIndex('production_runs_execution_idx').on(table.workflowExecutionId),
    projectStatus: index('production_runs_project_status_idx').on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
    scope: index('production_runs_project_scope_idx').on(
      table.projectId,
      table.scopeType,
      table.scopeStart,
      table.scopeEnd,
      table.status,
    ),
    fingerprint: index('production_runs_fingerprint_idx').on(table.projectId, table.fingerprint),
  }),
);

export const productionStages = sqliteTable(
  'production_stages',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => productionRuns.id, { onDelete: 'cascade' }),
    stageKey: text('stage_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(0),
    fingerprint: text('fingerprint').notNull(),
    progressCurrent: integer('progress_current').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    reusableCount: integer('reusable_count').notNull().default(0),
    generatedCount: integer('generated_count').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    blockedCount: integer('blocked_count').notNull().default(0),
    summary: text('summary').notNull().default('{}'),
    warnings: text('warnings').notNull().default('[]'),
    fallbacks: text('fallbacks').notNull().default('[]'),
    blockers: text('blockers').notNull().default('[]'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    runStage: uniqueIndex('production_stages_run_stage_idx').on(table.runId, table.stageKey),
    runOrdinal: uniqueIndex('production_stages_run_ordinal_idx').on(table.runId, table.ordinal),
    runStatus: index('production_stages_run_status_idx').on(
      table.runId,
      table.status,
      table.ordinal,
    ),
  }),
);

export const productionStageWork = sqliteTable(
  'production_stage_work',
  {
    id: text('id').primaryKey(),
    stageId: text('stage_id')
      .notNull()
      .references(() => productionStages.id, { onDelete: 'cascade' }),
    workflowStepId: text('workflow_step_id')
      .notNull()
      .references(() => workflowSteps.id, { onDelete: 'cascade' }),
    unitKey: text('unit_key').notNull(),
    entityId: text('entity_id'),
    classification: text('classification').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    outputFingerprint: text('output_fingerprint'),
    status: text('status').notNull(),
    summary: text('summary').notNull().default('{}'),
    ...timestamps,
  },
  (table) => ({
    unit: uniqueIndex('production_stage_work_unit_idx').on(table.stageId, table.unitKey),
    step: uniqueIndex('production_stage_work_step_idx').on(table.stageId, table.workflowStepId),
    status: index('production_stage_work_status_idx').on(
      table.stageId,
      table.status,
      table.unitKey,
    ),
    workflowStep: index('production_stage_work_workflow_step_idx').on(table.workflowStepId),
  }),
);

export const productionInterventions = sqliteTable(
  'production_interventions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => productionRuns.id, { onDelete: 'cascade' }),
    stageId: text('stage_id').references(() => productionStages.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    status: text('status').notNull(),
    affectedEntityType: text('affected_entity_type'),
    affectedEntityId: text('affected_entity_id'),
    message: text('message').notNull(),
    actions: text('actions').notNull().default('[]'),
    dedupeKey: text('dedupe_key').notNull(),
    resolution: text('resolution'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    open: uniqueIndex('production_interventions_open_idx')
      .on(table.runId, table.dedupeKey)
      .where(sql`${table.status} = 'OPEN'`),
    runStatus: index('production_interventions_run_status_idx').on(
      table.runId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const publicationPackages = sqliteTable(
  'publication_packages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => productionRuns.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull(),
    fingerprint: text('fingerprint').notNull(),
    videoAssetId: text('video_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    thumbnailAssetId: text('thumbnail_asset_id').references(() => assets.id, {
      onDelete: 'set null',
    }),
    subtitleAssetIds: text('subtitle_asset_ids').notNull().default('[]'),
    metadata: text('metadata'),
    chapterMarkers: text('chapter_markers').notNull().default('[]'),
    validation: text('validation').notNull().default('[]'),
    manifest: text('manifest'),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps,
  },
  (table) => ({
    run: uniqueIndex('publication_packages_run_idx').on(table.runId),
    projectStatus: index('publication_packages_project_status_idx').on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const publicationPackageRevisions = sqliteTable(
  'publication_package_revisions',
  {
    id: text('id').primaryKey(),
    packageId: text('package_id')
      .notNull()
      .references(() => publicationPackages.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    fingerprint: text('fingerprint').notNull(),
    videoAssetId: text('video_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    thumbnailAssetId: text('thumbnail_asset_id').references(() => assets.id, {
      onDelete: 'set null',
    }),
    subtitleAssetIds: text('subtitle_asset_ids').notNull().default('[]'),
    metadata: text('metadata'),
    chapterMarkers: text('chapter_markers').notNull().default('[]'),
    validation: text('validation').notNull().default('[]'),
    manifest: text('manifest'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    revision: uniqueIndex('publication_package_revisions_revision_idx').on(
      table.packageId,
      table.revision,
    ),
    current: uniqueIndex('publication_package_revisions_current_idx')
      .on(table.packageId)
      .where(sql`${table.isCurrent} = 1`),
    package: index('publication_package_revisions_package_idx').on(table.packageId, table.revision),
  }),
);

export const publicationExports = sqliteTable(
  'publication_exports',
  {
    id: text('id').primaryKey(),
    packageId: text('package_id')
      .notNull()
      .references(() => publicationPackages.id, { onDelete: 'cascade' }),
    workflowStepId: text('workflow_step_id').references(() => workflowSteps.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    directoryName: text('directory_name').notNull(),
    manifest: text('manifest'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    active: uniqueIndex('publication_exports_active_idx')
      .on(table.packageId, table.directoryName)
      .where(sql`${table.status} IN ('PENDING', 'RUNNING')`),
    package: index('publication_exports_package_idx').on(table.packageId, table.updatedAt),
  }),
);
