ALTER TABLE visual_style_settings ADD COLUMN overall_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN cinematic_language TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN lighting_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN texture_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN environment_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN character_rendering_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN camera_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN composition_style TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN mood_keywords TEXT NOT NULL DEFAULT '[]';
ALTER TABLE visual_style_settings ADD COLUMN positive_prompt_suffix TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN negative_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE visual_style_settings ADD COLUMN reference_asset_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS character_visual_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payload TEXT NOT NULL,
  prompt_fragment TEXT NOT NULL DEFAULT '',
  reference_asset_ids TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('DRAFT', 'APPROVED', 'STALE')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (project_id, character_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS character_visual_profiles_current_idx
  ON character_visual_profiles(project_id, character_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS character_visual_profiles_project_status_idx
  ON character_visual_profiles(project_id, status, character_id);

CREATE TABLE IF NOT EXISTS location_visual_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  location_name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payload TEXT NOT NULL,
  prompt_fragment TEXT NOT NULL DEFAULT '',
  reference_asset_ids TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('DRAFT', 'APPROVED', 'STALE')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (project_id, location_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS location_visual_profiles_current_idx
  ON location_visual_profiles(project_id, location_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS location_visual_profiles_project_status_idx
  ON location_visual_profiles(project_id, status, location_id);

CREATE TABLE IF NOT EXISTS visual_object_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payload TEXT NOT NULL,
  prompt_fragment TEXT NOT NULL DEFAULT '',
  reference_asset_ids TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('DRAFT', 'APPROVED', 'STALE')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (project_id, object_key, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS visual_object_profiles_current_idx
  ON visual_object_profiles(project_id, object_key)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS visual_object_profiles_project_status_idx
  ON visual_object_profiles(project_id, status, object_key);

CREATE TABLE IF NOT EXISTS scene_object_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  visual_object_profile_id TEXT REFERENCES visual_object_profiles(id) ON DELETE SET NULL,
  resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (resolution_status IN ('RESOLVED', 'UNRESOLVED', 'AMBIGUOUS')),
  UNIQUE (scene_revision_id, normalized_key)
);

CREATE INDEX IF NOT EXISTS scene_object_resolutions_scene_idx
  ON scene_object_resolutions(scene_revision_id, resolution_status);

CREATE INDEX IF NOT EXISTS scene_object_resolutions_profile_idx
  ON scene_object_resolutions(visual_object_profile_id, scene_revision_id);

CREATE TABLE IF NOT EXISTS visual_prompt_packages (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  payload TEXT NOT NULL,
  consistency_status TEXT NOT NULL,
  consistency_issues TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  prompt_template_version TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('CURRENT', 'STALE', 'FAILED')),
  CHECK (consistency_status IN ('PASS', 'WARN', 'FAIL')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (scene_revision_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS visual_prompt_packages_current_idx
  ON visual_prompt_packages(scene_revision_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS visual_prompt_packages_project_status_idx
  ON visual_prompt_packages(project_id, status, scene_revision_id);

CREATE TABLE IF NOT EXISTS visual_prompt_package_dependencies (
  package_id TEXT NOT NULL REFERENCES visual_prompt_packages(id) ON DELETE CASCADE,
  dependency_kind TEXT NOT NULL,
  dependency_key TEXT NOT NULL,
  dependency_revision_id TEXT NOT NULL,
  dependency_revision INTEGER NOT NULL,
  dependency_fingerprint TEXT NOT NULL,
  PRIMARY KEY (package_id, dependency_kind, dependency_key),
  CHECK (dependency_kind IN ('STYLE_BIBLE', 'CHARACTER_PROFILE', 'LOCATION_PROFILE', 'OBJECT_PROFILE'))
);

CREATE INDEX IF NOT EXISTS visual_prompt_package_dependencies_lookup_idx
  ON visual_prompt_package_dependencies(dependency_kind, dependency_key, dependency_revision_id);

CREATE INDEX IF NOT EXISTS visual_prompt_package_dependencies_package_idx
  ON visual_prompt_package_dependencies(package_id);
