CREATE TABLE IF NOT EXISTS image_generation_settings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'COMFYUI',
  base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8188',
  workflow_template TEXT NOT NULL DEFAULT 'text-to-image-v1',
  diffusion_model TEXT NOT NULL DEFAULT '',
  text_encoder TEXT NOT NULL DEFAULT '',
  vae_name TEXT NOT NULL DEFAULT '',
  sampler TEXT NOT NULL DEFAULT 'euler',
  connection_timeout_ms INTEGER NOT NULL DEFAULT 5000,
  generation_timeout_ms INTEGER NOT NULL DEFAULT 3600000,
  width INTEGER NOT NULL DEFAULT 1024,
  height INTEGER NOT NULL DEFAULT 576,
  steps INTEGER NOT NULL DEFAULT 20,
  guidance REAL NOT NULL DEFAULT 5,
  seed_mode TEXT NOT NULL DEFAULT 'RANDOM',
  fixed_seed INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1,
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider IN ('COMFYUI')),
  CHECK (workflow_template IN ('text-to-image-v1')),
  CHECK (connection_timeout_ms BETWEEN 500 AND 120000),
  CHECK (generation_timeout_ms BETWEEN 5000 AND 86400000),
  CHECK (width BETWEEN 16 AND 16384),
  CHECK (height BETWEEN 16 AND 16384),
  CHECK (steps BETWEEN 1 AND 4096),
  CHECK (guidance BETWEEN 0 AND 100),
  CHECK (seed_mode IN ('RANDOM', 'FIXED')),
  CHECK (fixed_seed IS NULL OR fixed_seed BETWEEN 0 AND 9007199254740991),
  CHECK (seed_mode = 'RANDOM' OR fixed_seed IS NOT NULL),
  CHECK (row_version > 0),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS image_generation_settings_project_idx
  ON image_generation_settings(project_id);

CREATE TABLE IF NOT EXISTS scene_image_generations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  visual_prompt_package_id TEXT REFERENCES visual_prompt_packages(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'GENERATED',
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
  is_current INTEGER NOT NULL DEFAULT 0,
  requested_seed INTEGER,
  actual_seed INTEGER,
  requested_width INTEGER,
  requested_height INTEGER,
  actual_width INTEGER,
  actual_height INTEGER,
  provider_job_id TEXT,
  workflow_template TEXT,
  model_settings TEXT NOT NULL DEFAULT '{}',
  package_fingerprint TEXT,
  settings_fingerprint TEXT,
  input_fingerprint TEXT NOT NULL,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  error TEXT,
  notes TEXT NOT NULL DEFAULT '',
  generation_instructions TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (source IN ('GENERATED', 'MANUAL')),
  CHECK (provider IS NULL OR provider IN ('COMFYUI')),
  CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CHECK (review_status IN ('UNREVIEWED', 'ACCEPTED', 'REJECTED')),
  CHECK (is_current IN (0, 1)),
  CHECK (revision > 0),
  CHECK (requested_seed IS NULL OR requested_seed BETWEEN 0 AND 9007199254740991),
  CHECK (actual_seed IS NULL OR actual_seed BETWEEN 0 AND 9007199254740991),
  CHECK (requested_width IS NULL OR requested_width BETWEEN 16 AND 16384),
  CHECK (requested_height IS NULL OR requested_height BETWEEN 16 AND 16384),
  CHECK (actual_width IS NULL OR actual_width BETWEEN 16 AND 16384),
  CHECK (actual_height IS NULL OR actual_height BETWEEN 16 AND 16384),
  CHECK (attempt >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (project_id, scene_stable_id, revision),
  UNIQUE (provider_job_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS scene_image_generations_current_idx
  ON scene_image_generations(project_id, scene_stable_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS scene_image_generations_scene_idx
  ON scene_image_generations(project_id, scene_stable_id, revision DESC);

CREATE INDEX IF NOT EXISTS scene_image_generations_status_idx
  ON scene_image_generations(project_id, status, updated_at);

CREATE INDEX IF NOT EXISTS scene_image_generations_provider_job_idx
  ON scene_image_generations(provider_job_id);
