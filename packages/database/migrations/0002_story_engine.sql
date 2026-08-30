ALTER TABLE chapters ADD COLUMN story_origin TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE chapters ADD COLUMN story_plan_item_id TEXT;
ALTER TABLE chapters ADD COLUMN story_generation_id TEXT;

CREATE TABLE IF NOT EXISTS story_settings_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  mode TEXT NOT NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_settings_current_idx
  ON story_settings_revisions(project_id) WHERE is_current=1;

CREATE TABLE IF NOT EXISTS story_blueprint_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  settings_revision_id TEXT NOT NULL REFERENCES story_settings_revisions(id),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  metadata TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_blueprint_current_idx
  ON story_blueprint_revisions(project_id) WHERE is_current=1;

CREATE TABLE IF NOT EXISTS story_plan_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  blueprint_revision_id TEXT NOT NULL REFERENCES story_blueprint_revisions(id),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  metadata TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_plan_current_idx
  ON story_plan_revisions(project_id) WHERE is_current=1;

CREATE TABLE IF NOT EXISTS story_plan_items (
  id TEXT PRIMARY KEY NOT NULL,
  plan_revision_id TEXT NOT NULL REFERENCES story_plan_revisions(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  payload TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_revision_id, stable_id),
  UNIQUE(plan_revision_id, chapter_number)
);
CREATE INDEX IF NOT EXISTS story_plan_items_number_idx
  ON story_plan_items(plan_revision_id, chapter_number);

CREATE TABLE IF NOT EXISTS story_threads (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stable_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, stable_id)
);

CREATE TABLE IF NOT EXISTS story_thread_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES story_threads(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  source_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_thread_current_idx
  ON story_thread_revisions(thread_id) WHERE is_current=1;

CREATE TABLE IF NOT EXISTS story_summary_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(chapter_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS story_summary_current_idx
  ON story_summary_revisions(chapter_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS story_summary_source_idx
  ON story_summary_revisions(chapter_id, chapter_revision);

CREATE TABLE IF NOT EXISTS story_generation_records (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  target_id TEXT NOT NULL,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  input_fingerprint TEXT NOT NULL,
  metadata TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS story_generation_target_idx
  ON story_generation_records(project_id, target_id, created_at);
CREATE INDEX IF NOT EXISTS story_generation_fingerprint_idx
  ON story_generation_records(input_fingerprint);
