CREATE TABLE video_generation_settings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'COMFYUI',
  base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8188',
  workflow_template TEXT NOT NULL DEFAULT 'image-to-video-v1',
  diffusion_model TEXT NOT NULL DEFAULT 'wan2.2_ti2v_5B_fp16.safetensors',
  text_encoder TEXT NOT NULL DEFAULT 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae_name TEXT NOT NULL DEFAULT 'wan2.2_vae.safetensors',
  sampler TEXT NOT NULL DEFAULT 'uni_pc',
  scheduler TEXT NOT NULL DEFAULT 'simple',
  steps INTEGER NOT NULL DEFAULT 20,
  guidance REAL NOT NULL DEFAULT 5,
  shift REAL NOT NULL DEFAULT 8,
  preset TEXT NOT NULL DEFAULT 'BALANCED',
  connection_timeout_ms INTEGER NOT NULL DEFAULT 5000,
  generation_timeout_ms INTEGER NOT NULL DEFAULT 3600000,
  seed_mode TEXT NOT NULL DEFAULT 'RANDOM',
  fixed_seed INTEGER,
  require_motion_approval INTEGER NOT NULL DEFAULT 1 CHECK (require_motion_approval IN (0, 1)),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX video_generation_settings_project_idx
  ON video_generation_settings(project_id);

CREATE TABLE scene_motion_sources (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  motion_source TEXT NOT NULL DEFAULT 'KEN_BURNS',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX scene_motion_sources_scene_idx
  ON scene_motion_sources(project_id, scene_stable_id);

CREATE TABLE ai_motion_plan_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  character_action TEXT NOT NULL DEFAULT '',
  environment_motion TEXT NOT NULL DEFAULT '',
  camera_motion TEXT NOT NULL DEFAULT 'STATIC',
  intensity TEXT NOT NULL DEFAULT 'SUBTLE',
  priority TEXT NOT NULL DEFAULT 'NONE',
  motion_prompt TEXT NOT NULL,
  negative_prompt TEXT,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ai_motion_plan_revisions_revision_idx
  ON ai_motion_plan_revisions(scene_revision_id, revision);
CREATE UNIQUE INDEX ai_motion_plan_revisions_current_idx
  ON ai_motion_plan_revisions(scene_revision_id)
  WHERE is_current = 1;
CREATE INDEX ai_motion_plan_revisions_scene_idx
  ON ai_motion_plan_revisions(project_id, scene_stable_id, revision);

CREATE TABLE scene_video_generations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  ai_motion_plan_revision_id TEXT REFERENCES ai_motion_plan_revisions(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  review_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  requested_seed INTEGER,
  actual_seed INTEGER,
  requested_width INTEGER,
  requested_height INTEGER,
  actual_width INTEGER,
  actual_height INTEGER,
  frame_count INTEGER,
  fps INTEGER,
  provider_job_id TEXT,
  workflow_template TEXT,
  model_settings TEXT NOT NULL DEFAULT '{}',
  request_snapshot TEXT NOT NULL DEFAULT '{}',
  motion_plan_fingerprint TEXT,
  settings_fingerprint TEXT,
  input_fingerprint TEXT NOT NULL,
  source_image_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  source_image_sha256 TEXT,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  review_issues TEXT NOT NULL DEFAULT '[]',
  review_notes TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  clip_duration_ms INTEGER,
  generation_duration_ms INTEGER,
  error_code TEXT,
  error TEXT,
  generation_instructions TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX scene_video_generations_revision_idx
  ON scene_video_generations(project_id, scene_stable_id, revision);
CREATE UNIQUE INDEX scene_video_generations_current_idx
  ON scene_video_generations(project_id, scene_stable_id)
  WHERE is_current = 1;
CREATE INDEX scene_video_generations_scene_idx
  ON scene_video_generations(project_id, scene_stable_id, revision);
CREATE INDEX scene_video_generations_provider_job_idx
  ON scene_video_generations(provider_job_id);
CREATE INDEX scene_video_generations_status_idx
  ON scene_video_generations(project_id, status, updated_at);
