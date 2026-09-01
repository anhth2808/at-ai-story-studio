ALTER TABLE workflow_steps ADD COLUMN payload TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS visual_style_settings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  style_name TEXT NOT NULL,
  style_description TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  realism TEXT NOT NULL DEFAULT '',
  color_palette TEXT NOT NULL DEFAULT '',
  cinematic_style TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  prompt_suffix TEXT NOT NULL DEFAULT '',
  input_fingerprint TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (is_current IN (0, 1)),
  UNIQUE (project_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS visual_style_settings_current_idx
  ON visual_style_settings(project_id)
  WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  visual_description TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  architecture TEXT NOT NULL DEFAULT '',
  important_objects TEXT NOT NULL DEFAULT '[]',
  lighting_defaults TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('DRAFT', 'ACTIVE'))
);

CREATE INDEX IF NOT EXISTS locations_project_normalized_idx
  ON locations(project_id, normalized_name);

CREATE TABLE IF NOT EXISTS scene_plan_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  density TEXT NOT NULL,
  target_range TEXT,
  style_revision_id TEXT REFERENCES visual_style_settings(id) ON DELETE SET NULL,
  input_fingerprint TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'CURRENT',
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (density IN ('LOW', 'MEDIUM', 'HIGH')),
  CHECK (status IN ('CURRENT', 'STALE', 'INVALIDATED')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (chapter_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS scene_plan_current_idx
  ON scene_plan_revisions(chapter_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS scene_plan_project_status_idx
  ON scene_plan_revisions(project_id, status, chapter_id);

CREATE TABLE IF NOT EXISTS scene_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  stable_id TEXT NOT NULL,
  scene_plan_revision_id TEXT NOT NULL REFERENCES scene_plan_revisions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  scene_number INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  purpose TEXT NOT NULL,
  source_start_offset INTEGER NOT NULL,
  source_end_offset INTEGER NOT NULL,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  location_name_snapshot TEXT,
  time_of_day TEXT NOT NULL DEFAULT '',
  weather TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  visual_description TEXT NOT NULL,
  camera TEXT NOT NULL,
  composition TEXT NOT NULL,
  important_objects TEXT NOT NULL DEFAULT '[]',
  lighting TEXT NOT NULL DEFAULT '',
  color_mood TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL,
  negative_prompt TEXT,
  continuity_notes TEXT NOT NULL DEFAULT '',
  unresolved_references TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'CURRENT',
  prompt_status TEXT NOT NULL DEFAULT 'CURRENT',
  style_revision_id TEXT REFERENCES visual_style_settings(id) ON DELETE SET NULL,
  input_fingerprint TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  generation_id TEXT REFERENCES story_generation_records(id) ON DELETE SET NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (scene_number > 0),
  CHECK (revision > 0),
  CHECK (source_start_offset >= 0),
  CHECK (source_end_offset > source_start_offset),
  CHECK (status IN ('CURRENT', 'STALE', 'INVALIDATED')),
  CHECK (prompt_status IN ('CURRENT', 'STALE', 'MISSING')),
  CHECK (is_current IN (0, 1)),
  UNIQUE (scene_plan_revision_id, stable_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS scene_revision_current_idx
  ON scene_revisions(scene_plan_revision_id, stable_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS scene_revision_chapter_number_idx
  ON scene_revisions(chapter_id, scene_number, is_current);

CREATE INDEX IF NOT EXISTS scene_revision_location_idx
  ON scene_revisions(location_id, is_current);

CREATE TABLE IF NOT EXISTS scene_characters (
  id TEXT PRIMARY KEY NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  character_id TEXT,
  display_name TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
  role_in_scene TEXT NOT NULL DEFAULT '',
  visual_state TEXT NOT NULL DEFAULT '{}',
  dependency_fingerprint TEXT,
  created_at TEXT NOT NULL,
  CHECK (resolution_status IN ('RESOLVED', 'UNRESOLVED'))
);

CREATE INDEX IF NOT EXISTS scene_characters_scene_idx
  ON scene_characters(scene_revision_id);

CREATE INDEX IF NOT EXISTS scene_characters_character_idx
  ON scene_characters(character_id, scene_revision_id);
