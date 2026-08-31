ALTER TABLE chapters ADD COLUMN continuity_status TEXT NOT NULL DEFAULT 'CURRENT';
ALTER TABLE chapters ADD COLUMN source_state_revision INTEGER;
ALTER TABLE chapters ADD COLUMN continuity_check_status TEXT;

CREATE TABLE IF NOT EXISTS story_arc_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  conflict TEXT NOT NULL,
  important_character_ids TEXT NOT NULL DEFAULT '[]',
  important_thread_ids TEXT NOT NULL DEFAULT '[]',
  planned_outcome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  source_blueprint_revision_id TEXT NOT NULL REFERENCES story_blueprint_revisions(id),
  input_fingerprint TEXT,
  metadata TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, stable_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_arc_current_idx
  ON story_arc_revisions(project_id, stable_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS story_arc_range_idx
  ON story_arc_revisions(project_id, start_chapter, end_chapter, is_current);

CREATE TABLE IF NOT EXISTS story_plan_window_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  arc_id TEXT NOT NULL REFERENCES story_arc_revisions(id),
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  source_blueprint_revision_id TEXT NOT NULL REFERENCES story_blueprint_revisions(id),
  prior_window_summary TEXT,
  payload TEXT NOT NULL,
  input_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, stable_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_plan_window_current_idx
  ON story_plan_window_revisions(project_id, stable_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS story_plan_window_range_idx
  ON story_plan_window_revisions(project_id, start_chapter, end_chapter, is_current);

CREATE TABLE IF NOT EXISTS story_plan_window_items (
  id TEXT PRIMARY KEY NOT NULL,
  window_revision_id TEXT NOT NULL REFERENCES story_plan_window_revisions(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(window_revision_id, stable_id),
  UNIQUE(window_revision_id, chapter_number)
);
CREATE INDEX IF NOT EXISTS story_plan_window_items_number_idx
  ON story_plan_window_items(window_revision_id, chapter_number);

CREATE TABLE IF NOT EXISTS story_state_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  current_chapter INTEGER NOT NULL,
  source_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  source_chapter_revision INTEGER,
  previous_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_state_current_idx
  ON story_state_revisions(project_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS story_state_checkpoint_idx
  ON story_state_revisions(project_id, current_chapter, revision);

CREATE TABLE IF NOT EXISTS story_state_deltas (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  source_chapter_revision INTEGER,
  source_generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  target_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'VALID',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS story_state_delta_source_idx
  ON story_state_deltas(project_id, source_chapter_id, source_chapter_revision);

CREATE TABLE IF NOT EXISTS story_character_states (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  location TEXT,
  current_goal TEXT,
  power_level TEXT,
  injuries TEXT NOT NULL DEFAULT '[]',
  possessions TEXT NOT NULL DEFAULT '[]',
  relationships TEXT NOT NULL DEFAULT '[]',
  knowledge TEXT NOT NULL DEFAULT '[]',
  last_updated_chapter INTEGER,
  source_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, character_id)
);
CREATE INDEX IF NOT EXISTS story_character_state_updated_idx
  ON story_character_states(project_id, last_updated_chapter);

CREATE TABLE IF NOT EXISTS story_important_facts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  text TEXT NOT NULL,
  importance TEXT NOT NULL,
  introduced_chapter INTEGER NOT NULL,
  last_confirmed_chapter INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, stable_id)
);
CREATE INDEX IF NOT EXISTS story_facts_relevance_idx
  ON story_important_facts(project_id, status, importance, last_confirmed_chapter);

CREATE TABLE IF NOT EXISTS story_events (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  importance TEXT NOT NULL,
  character_ids TEXT NOT NULL DEFAULT '[]',
  thread_ids TEXT NOT NULL DEFAULT '[]',
  source_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, stable_id)
);
CREATE INDEX IF NOT EXISTS story_events_relevance_idx
  ON story_events(project_id, chapter_number, importance);

CREATE TABLE IF NOT EXISTS story_chapter_lineage (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  source_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  source_generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  continuity_status TEXT NOT NULL DEFAULT 'CURRENT',
  continuity_check_status TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(chapter_id, chapter_revision)
);
CREATE INDEX IF NOT EXISTS story_chapter_lineage_status_idx
  ON story_chapter_lineage(project_id, continuity_status, chapter_revision);

CREATE TABLE IF NOT EXISTS story_generation_batches (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  total INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS story_generation_batches_project_idx
  ON story_generation_batches(project_id, status, created_at);

CREATE TABLE IF NOT EXISTS story_generation_batch_items (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES story_generation_batches(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  plan_item_id TEXT NOT NULL,
  workflow_step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL DEFAULT 'PENDING',
  input_fingerprint TEXT,
  error TEXT,
  skip_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(batch_id, chapter_number),
  UNIQUE(project_id, chapter_number, batch_id)
);
CREATE INDEX IF NOT EXISTS story_generation_batch_items_status_idx
  ON story_generation_batch_items(batch_id, outcome, chapter_number);
CREATE INDEX IF NOT EXISTS story_generation_batch_items_project_idx
  ON story_generation_batch_items(project_id, chapter_number, outcome);

CREATE UNIQUE INDEX IF NOT EXISTS story_generation_batch_active_chapter_idx
  ON story_generation_batch_items(project_id, chapter_number)
  WHERE outcome IN ('PENDING','RUNNING');

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  cost_usd REAL,
  currency TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_project_created_idx
  ON ai_usage(project_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_entity_idx
  ON ai_usage(project_id, entity_id, operation, attempt);

CREATE TABLE IF NOT EXISTS story_continuity_checks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  source_state_revision_id TEXT REFERENCES story_state_revisions(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS story_continuity_checks_chapter_idx
  ON story_continuity_checks(chapter_id, chapter_revision, created_at);

UPDATE chapters SET continuity_status='CURRENT' WHERE continuity_status IS NULL OR continuity_status='';
UPDATE chapters SET continuity_status='NOT_ANALYZED'
WHERE story_origin='GENERATED' AND source_state_revision IS NULL;
