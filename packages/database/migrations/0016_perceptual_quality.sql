CREATE TABLE shot_plans (
  id TEXT PRIMARY KEY NOT NULL,
  stable_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT', 'STALE', 'FAILED')),
  template_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  review_notes TEXT NOT NULL DEFAULT '',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scene_revision_id, revision)
);
CREATE UNIQUE INDEX shot_plans_current_idx
  ON shot_plans(scene_revision_id) WHERE is_current = 1;
CREATE INDEX shot_plans_project_scene_idx
  ON shot_plans(project_id, scene_stable_id, revision);

CREATE TABLE narrative_beats (
  id TEXT PRIMARY KEY NOT NULL,
  stable_id TEXT NOT NULL,
  shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
  source_end_offset INTEGER NOT NULL CHECK (source_end_offset > source_start_offset),
  kind TEXT NOT NULL,
  meaning TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('LOW', 'MEDIUM', 'HIGH')),
  turning_point INTEGER NOT NULL DEFAULT 0 CHECK (turning_point IN (0, 1)),
  timing_group_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (shot_plan_id, ordinal),
  UNIQUE (shot_plan_id, stable_id)
);
CREATE INDEX narrative_beats_plan_idx ON narrative_beats(shot_plan_id, ordinal);

CREATE TABLE shots (
  id TEXT PRIMARY KEY NOT NULL,
  stable_id TEXT NOT NULL,
  shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id) ON DELETE CASCADE,
  narrative_beat_id TEXT NOT NULL REFERENCES narrative_beats(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
  source_end_offset INTEGER NOT NULL CHECK (source_end_offset > source_start_offset),
  primary_beat TEXT NOT NULL,
  event_kinds TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK (event_count BETWEEN 1 AND 8),
  importance TEXT NOT NULL CHECK (importance IN ('LOW', 'MEDIUM', 'HIGH')),
  is_hero INTEGER NOT NULL DEFAULT 0 CHECK (is_hero IN (0, 1)),
  identity_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (identity_sensitive IN (0, 1)),
  dialogue_mode TEXT NOT NULL,
  dialogue_text TEXT NOT NULL DEFAULT '',
  speaker_character_id TEXT,
  visual_carrier TEXT NOT NULL DEFAULT '',
  offscreen_rationale TEXT NOT NULL DEFAULT '',
  visible_character_ids TEXT NOT NULL DEFAULT '[]',
  offscreen_character_ids TEXT NOT NULL DEFAULT '[]',
  static_intent TEXT NOT NULL,
  dynamic_intent TEXT NOT NULL,
  initial_state TEXT NOT NULL,
  final_state TEXT NOT NULL,
  continuation TEXT NOT NULL,
  planned_duration_ms INTEGER NOT NULL CHECK (planned_duration_ms BETWEEN 250 AND 60000),
  variation_intent TEXT NOT NULL DEFAULT 'NORMAL',
  validation_issues TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shot_plan_id, ordinal),
  UNIQUE (shot_plan_id, stable_id, revision)
);
CREATE INDEX shots_plan_idx ON shots(shot_plan_id, ordinal);
CREATE INDEX shots_beat_idx ON shots(narrative_beat_id, ordinal);

CREATE TABLE character_appearance_stages (
  id TEXT PRIMARY KEY NOT NULL,
  stable_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  character_profile_id TEXT NOT NULL REFERENCES character_visual_profiles(id) ON DELETE CASCADE,
  profile_revision INTEGER NOT NULL CHECK (profile_revision > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  provenance TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN ('DRAFT', 'APPROVED', 'REJECTED')),
  reference_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  reference_sha256 TEXT,
  input_fingerprint TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, stable_id, revision)
);
CREATE UNIQUE INDEX character_appearance_stages_current_idx
  ON character_appearance_stages(project_id, stable_id) WHERE is_current = 1;
CREATE INDEX character_appearance_stages_character_idx
  ON character_appearance_stages(project_id, character_id, review_status);

CREATE TABLE visual_reference_generations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('CHARACTER_PROTOTYPE', 'CHARACTER_STAGE', 'LOCATION')),
  target_entity_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision > 0),
  source_prototype_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  source_prototype_sha256 TEXT,
  prompt TEXT NOT NULL,
  workflow_template TEXT NOT NULL,
  provider TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  seed INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  approval TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (approval IN ('CANDIDATE', 'APPROVED', 'REJECTED')),
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  asset_sha256 TEXT,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX visual_reference_generations_current_idx
  ON visual_reference_generations(project_id, target_kind, target_entity_id, target_revision)
  WHERE is_current = 1;
CREATE INDEX visual_reference_generations_target_idx
  ON visual_reference_generations(project_id, target_kind, target_entity_id, created_at);

CREATE TABLE image_critic_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES scene_image_generations(id) ON DELETE CASCADE,
  candidate_set_id TEXT REFERENCES scene_image_candidate_sets(id) ON DELETE SET NULL,
  shot_stable_id TEXT,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_sha256 TEXT NOT NULL,
  package_fingerprint TEXT NOT NULL,
  reference_fingerprint TEXT NOT NULL,
  critic_provider TEXT NOT NULL,
  critic_model TEXT NOT NULL,
  critic_version TEXT NOT NULL,
  status TEXT NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}',
  issues TEXT NOT NULL DEFAULT '[]',
  hard_failure INTEGER NOT NULL DEFAULT 0 CHECK (hard_failure IN (0, 1)),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  explanation TEXT NOT NULL DEFAULT '',
  guidance TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX image_critic_evaluations_input_idx
  ON image_critic_evaluations(generation_id, input_fingerprint);
CREATE INDEX image_critic_evaluations_status_idx
  ON image_critic_evaluations(project_id, status, created_at);

CREATE TABLE video_critic_evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES scene_video_generations(id) ON DELETE CASCADE,
  shot_stable_id TEXT,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  clip_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  clip_sha256 TEXT NOT NULL,
  keyframe_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  keyframe_sha256 TEXT NOT NULL,
  shot_fingerprint TEXT NOT NULL,
  critic_provider TEXT NOT NULL,
  critic_model TEXT NOT NULL,
  critic_version TEXT NOT NULL,
  status TEXT NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  explanation TEXT NOT NULL DEFAULT '',
  guidance TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  workflow_step_id TEXT REFERENCES workflow_steps(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX video_critic_evaluations_input_idx
  ON video_critic_evaluations(generation_id, input_fingerprint);
CREATE INDEX video_critic_evaluations_status_idx
  ON video_critic_evaluations(project_id, status, created_at);

CREATE TABLE shot_timing_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_timing_revision_id TEXT NOT NULL REFERENCES scene_timing_revisions(id) ON DELETE CASCADE,
  shot_plan_id TEXT NOT NULL REFERENCES shot_plans(id) ON DELETE CASCADE,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  target_duration_ms INTEGER NOT NULL CHECK (target_duration_ms > 0),
  actual_duration_ms INTEGER NOT NULL CHECK (actual_duration_ms > 0),
  frame_count INTEGER NOT NULL CHECK (frame_count > 0),
  fps INTEGER NOT NULL CHECK (fps > 0),
  residual_ms INTEGER NOT NULL,
  backend TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scene_timing_revision_id, shot_id)
);
CREATE INDEX shot_timing_allocations_scene_idx
  ON shot_timing_allocations(scene_timing_revision_id, ordinal);

ALTER TABLE visual_prompt_packages ADD COLUMN shot_plan_id TEXT REFERENCES shot_plans(id) ON DELETE SET NULL;
ALTER TABLE visual_prompt_packages ADD COLUMN shot_stable_id TEXT;
DROP INDEX IF EXISTS visual_prompt_packages_revision_idx;
DROP INDEX IF EXISTS visual_prompt_packages_current_idx;
CREATE UNIQUE INDEX visual_prompt_packages_legacy_revision_idx
  ON visual_prompt_packages(scene_revision_id, revision) WHERE shot_stable_id IS NULL;
CREATE UNIQUE INDEX visual_prompt_packages_shot_revision_idx
  ON visual_prompt_packages(scene_revision_id, shot_stable_id, revision) WHERE shot_stable_id IS NOT NULL;
CREATE UNIQUE INDEX visual_prompt_packages_legacy_current_idx
  ON visual_prompt_packages(scene_revision_id) WHERE is_current = 1 AND shot_stable_id IS NULL;
CREATE UNIQUE INDEX visual_prompt_packages_shot_current_idx
  ON visual_prompt_packages(scene_revision_id, shot_stable_id) WHERE is_current = 1 AND shot_stable_id IS NOT NULL;

ALTER TABLE scene_image_candidate_sets ADD COLUMN shot_plan_id TEXT REFERENCES shot_plans(id) ON DELETE SET NULL;
ALTER TABLE scene_image_candidate_sets ADD COLUMN shot_stable_id TEXT;
ALTER TABLE scene_image_candidate_sets ADD COLUMN ranking TEXT;
ALTER TABLE scene_image_generations ADD COLUMN shot_plan_id TEXT REFERENCES shot_plans(id) ON DELETE SET NULL;
ALTER TABLE scene_image_generations ADD COLUMN shot_stable_id TEXT;
ALTER TABLE scene_image_generations ADD COLUMN automatic_quality_status TEXT NOT NULL DEFAULT 'NOT_RUN';
ALTER TABLE scene_image_generations ADD COLUMN critic_evaluation_id TEXT REFERENCES image_critic_evaluations(id) ON DELETE SET NULL;
DROP INDEX IF EXISTS scene_image_generations_revision_idx;
DROP INDEX IF EXISTS scene_image_generations_current_idx;
CREATE UNIQUE INDEX scene_image_generations_legacy_revision_idx
  ON scene_image_generations(project_id, scene_stable_id, revision) WHERE shot_stable_id IS NULL;
CREATE UNIQUE INDEX scene_image_generations_shot_revision_idx
  ON scene_image_generations(project_id, shot_stable_id, revision) WHERE shot_stable_id IS NOT NULL;
CREATE UNIQUE INDEX scene_image_generations_legacy_current_idx
  ON scene_image_generations(project_id, scene_stable_id) WHERE is_current = 1 AND shot_stable_id IS NULL;
CREATE UNIQUE INDEX scene_image_generations_shot_current_idx
  ON scene_image_generations(project_id, shot_stable_id) WHERE is_current = 1 AND shot_stable_id IS NOT NULL;

ALTER TABLE ai_motion_plan_revisions ADD COLUMN shot_plan_id TEXT REFERENCES shot_plans(id) ON DELETE SET NULL;
ALTER TABLE ai_motion_plan_revisions ADD COLUMN shot_stable_id TEXT;
DROP INDEX IF EXISTS ai_motion_plan_revisions_revision_idx;
DROP INDEX IF EXISTS ai_motion_plan_revisions_current_idx;
CREATE UNIQUE INDEX ai_motion_plan_revisions_legacy_revision_idx
  ON ai_motion_plan_revisions(scene_revision_id, revision) WHERE shot_stable_id IS NULL;
CREATE UNIQUE INDEX ai_motion_plan_revisions_shot_revision_idx
  ON ai_motion_plan_revisions(scene_revision_id, shot_stable_id, revision) WHERE shot_stable_id IS NOT NULL;
CREATE UNIQUE INDEX ai_motion_plan_revisions_legacy_current_idx
  ON ai_motion_plan_revisions(scene_revision_id) WHERE is_current = 1 AND shot_stable_id IS NULL;
CREATE UNIQUE INDEX ai_motion_plan_revisions_shot_current_idx
  ON ai_motion_plan_revisions(scene_revision_id, shot_stable_id) WHERE is_current = 1 AND shot_stable_id IS NOT NULL;

ALTER TABLE scene_video_generations ADD COLUMN shot_plan_id TEXT REFERENCES shot_plans(id) ON DELETE SET NULL;
ALTER TABLE scene_video_generations ADD COLUMN shot_stable_id TEXT;
ALTER TABLE scene_video_generations ADD COLUMN backend TEXT NOT NULL DEFAULT 'WAN22_TI2V_5B';
ALTER TABLE scene_video_generations ADD COLUMN automatic_quality_status TEXT NOT NULL DEFAULT 'NOT_RUN';
ALTER TABLE scene_video_generations ADD COLUMN critic_evaluation_id TEXT REFERENCES video_critic_evaluations(id) ON DELETE SET NULL;
ALTER TABLE scene_video_generations ADD COLUMN continuation_source TEXT;
DROP INDEX IF EXISTS scene_video_generations_revision_idx;
DROP INDEX IF EXISTS scene_video_generations_current_idx;
CREATE UNIQUE INDEX scene_video_generations_legacy_revision_idx
  ON scene_video_generations(project_id, scene_stable_id, revision) WHERE shot_stable_id IS NULL;
CREATE UNIQUE INDEX scene_video_generations_shot_revision_idx
  ON scene_video_generations(project_id, shot_stable_id, revision) WHERE shot_stable_id IS NOT NULL;
CREATE UNIQUE INDEX scene_video_generations_legacy_current_idx
  ON scene_video_generations(project_id, scene_stable_id) WHERE is_current = 1 AND shot_stable_id IS NULL;
CREATE UNIQUE INDEX scene_video_generations_shot_current_idx
  ON scene_video_generations(project_id, shot_stable_id) WHERE is_current = 1 AND shot_stable_id IS NOT NULL;

ALTER TABLE video_generation_settings ADD COLUMN backend TEXT NOT NULL DEFAULT 'WAN22_TI2V_5B';
ALTER TABLE video_generation_settings ADD COLUMN ltx_checkpoint TEXT NOT NULL DEFAULT 'ltx-2-19b-distilled-fp8.safetensors';
ALTER TABLE video_generation_settings ADD COLUMN ltx_text_encoder TEXT NOT NULL DEFAULT 'gemma_3_12B_it_fp4_mixed.safetensors';
ALTER TABLE video_generation_settings ADD COLUMN ltx_vae_name TEXT NOT NULL DEFAULT '';
ALTER TABLE video_generation_settings ADD COLUMN ltx_fps INTEGER NOT NULL DEFAULT 25 CHECK (ltx_fps BETWEEN 8 AND 60);
