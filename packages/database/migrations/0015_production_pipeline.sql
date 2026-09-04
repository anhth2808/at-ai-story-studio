CREATE TABLE production_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_key TEXT NOT NULL CHECK (profile_key IN ('MANUAL_REVIEW', 'BALANCED', 'AUTO')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  settings TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, profile_key, revision)
);
CREATE UNIQUE INDEX production_profiles_current_idx
  ON production_profiles(project_id, profile_key)
  WHERE is_current = 1;
CREATE INDEX production_profiles_project_idx
  ON production_profiles(project_id, updated_at);

CREATE TABLE production_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE RESTRICT,
  profile_id TEXT NOT NULL REFERENCES production_profiles(id) ON DELETE RESTRICT,
  profile_revision INTEGER NOT NULL CHECK (profile_revision > 0),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_PROJECT', 'CHAPTER_RANGE')),
  scope_start INTEGER,
  scope_end INTEGER,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'READY', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED', 'FAILED', 'CANCELLED', 'COMPLETED')),
  current_stage TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  coordinator_sequence INTEGER NOT NULL DEFAULT 0 CHECK (coordinator_sequence >= 0),
  progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  metrics TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  cancellation_requested_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(workflow_execution_id)
);
CREATE INDEX production_runs_project_status_idx
  ON production_runs(project_id, status, updated_at);
CREATE INDEX production_runs_project_scope_idx
  ON production_runs(project_id, scope_type, scope_start, scope_end, status);
CREATE INDEX production_runs_fingerprint_idx
  ON production_runs(project_id, fingerprint);

CREATE TABLE production_stages (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL CHECK (stage_key IN ('STORY', 'CHAPTERS', 'AUDIO', 'SCENES', 'VISUAL_PROFILES', 'VISUAL_PROMPTS', 'SCENE_IMAGES', 'AI_MOTION', 'TIMELINE', 'RENDER', 'PUBLICATION_PACKAGE')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'RUNNING', 'WAITING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  fingerprint TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  reusable_count INTEGER NOT NULL DEFAULT 0 CHECK (reusable_count >= 0),
  generated_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  summary TEXT NOT NULL DEFAULT '{}',
  warnings TEXT NOT NULL DEFAULT '[]',
  fallbacks TEXT NOT NULL DEFAULT '[]',
  blockers TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, stage_key),
  UNIQUE(run_id, ordinal)
);
CREATE INDEX production_stages_run_status_idx
  ON production_stages(run_id, status, ordinal);

CREATE TABLE production_stage_work (
  id TEXT PRIMARY KEY NOT NULL,
  stage_id TEXT NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
  workflow_step_id TEXT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  unit_key TEXT NOT NULL,
  entity_id TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('REUSE', 'BUILD', 'REVIEW', 'BLOCKED')),
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'INVALIDATED', 'CANCELLED')),
  summary TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(stage_id, unit_key),
  UNIQUE(stage_id, workflow_step_id)
);
CREATE INDEX production_stage_work_status_idx
  ON production_stage_work(stage_id, status, unit_key);
CREATE INDEX production_stage_work_step_idx
  ON production_stage_work(workflow_step_id);

CREATE TABLE production_interventions (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  stage_id TEXT REFERENCES production_stages(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCKING')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  affected_entity_type TEXT,
  affected_entity_id TEXT,
  message TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX production_interventions_open_idx
  ON production_interventions(run_id, dedupe_key)
  WHERE status = 'OPEN';
CREATE INDEX production_interventions_run_status_idx
  ON production_interventions(run_id, status, updated_at);

CREATE TABLE publication_packages (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'INCOMPLETE', 'READY', 'STALE')),
  fingerprint TEXT NOT NULL,
  video_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  subtitle_asset_ids TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  chapter_markers TEXT NOT NULL DEFAULT '[]',
  validation TEXT NOT NULL DEFAULT '[]',
  manifest TEXT,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id)
);
CREATE INDEX publication_packages_project_status_idx
  ON publication_packages(project_id, status, updated_at);

CREATE TABLE publication_package_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL REFERENCES publication_packages(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'INCOMPLETE', 'READY', 'STALE')),
  fingerprint TEXT NOT NULL,
  video_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  subtitle_asset_ids TEXT NOT NULL DEFAULT '[]',
  metadata TEXT,
  chapter_markers TEXT NOT NULL DEFAULT '[]',
  validation TEXT NOT NULL DEFAULT '[]',
  manifest TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE(package_id, revision)
);
CREATE UNIQUE INDEX publication_package_revisions_current_idx
  ON publication_package_revisions(package_id)
  WHERE is_current = 1;
CREATE INDEX publication_package_revisions_package_idx
  ON publication_package_revisions(package_id, revision);

CREATE TABLE publication_exports (
  id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL REFERENCES publication_packages(id) ON DELETE CASCADE,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  directory_name TEXT NOT NULL,
  manifest TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX publication_exports_active_idx
  ON publication_exports(package_id, directory_name)
  WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX publication_exports_package_idx
  ON publication_exports(package_id, updated_at);
