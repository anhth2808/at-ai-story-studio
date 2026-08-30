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
    ...timestamps,
  },
  (table) => ({
    projectNumber: uniqueIndex('chapters_project_number_idx').on(table.projectId, table.number),
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
