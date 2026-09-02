ALTER TABLE tts_segments ADD COLUMN chapter_revision INTEGER;
ALTER TABLE tts_segments ADD COLUMN source_start_offset INTEGER;
ALTER TABLE tts_segments ADD COLUMN source_end_offset INTEGER;
ALTER TABLE tts_segments ADD COLUMN source_text TEXT;

CREATE INDEX tts_segments_chapter_revision_idx
  ON tts_segments(chapter_id, chapter_revision, segment_index);

CREATE TABLE scene_timing_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_revision INTEGER NOT NULL,
  audio_asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('AUTO', 'MANUAL')),
  revision INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  minimum_scene_duration_ms INTEGER NOT NULL CHECK (minimum_scene_duration_ms > 0),
  items TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(chapter_id, revision)
);
CREATE UNIQUE INDEX scene_timing_current_idx
  ON scene_timing_revisions(chapter_id)
  WHERE is_current = 1;
CREATE INDEX scene_timing_project_idx
  ON scene_timing_revisions(project_id, chapter_id, is_current, revision);

CREATE TABLE motion_plan_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  timing_revision_id TEXT REFERENCES scene_timing_revisions(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL,
  motion_type TEXT NOT NULL CHECK (motion_type IN ('STATIC', 'ZOOM_IN', 'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT', 'PAN_UP', 'PAN_DOWN', 'PAN_ZOOM', 'SLOW_PUSH_IN')),
  start_scale REAL NOT NULL CHECK (start_scale >= 1 AND start_scale <= 1.25),
  end_scale REAL NOT NULL CHECK (end_scale >= 1 AND end_scale <= 1.25),
  start_position_x REAL NOT NULL CHECK (start_position_x >= 0 AND start_position_x <= 1),
  start_position_y REAL NOT NULL CHECK (start_position_y >= 0 AND start_position_y <= 1),
  end_position_x REAL NOT NULL CHECK (end_position_x >= 0 AND end_position_x <= 1),
  end_position_y REAL NOT NULL CHECK (end_position_y >= 0 AND end_position_y <= 1),
  easing TEXT NOT NULL CHECK (easing IN ('LINEAR', 'EASE_IN_OUT')),
  focus_point_x REAL CHECK (focus_point_x IS NULL OR (focus_point_x >= 0 AND focus_point_x <= 1)),
  focus_point_y REAL CHECK (focus_point_y IS NULL OR (focus_point_y >= 0 AND focus_point_y <= 1)),
  intensity REAL NOT NULL DEFAULT 0.5 CHECK (intensity >= 0 AND intensity <= 1),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scene_revision_id, revision)
);
CREATE UNIQUE INDEX motion_plan_current_idx
  ON motion_plan_revisions(scene_stable_id, scene_revision_id)
  WHERE is_current = 1;
CREATE INDEX motion_plan_scene_idx
  ON motion_plan_revisions(project_id, chapter_id, scene_stable_id, is_current, revision);
CREATE INDEX motion_plan_timing_idx
  ON motion_plan_revisions(timing_revision_id);

ALTER TABLE render_jobs ADD COLUMN render_type TEXT NOT NULL DEFAULT 'LEGACY_PROJECT';
ALTER TABLE render_jobs ADD COLUMN scope_id TEXT;
ALTER TABLE render_jobs ADD COLUMN progress_time_ms INTEGER;
ALTER TABLE render_jobs ADD COLUMN diagnostics TEXT;
CREATE INDEX render_jobs_scope_idx
  ON render_jobs(project_id, render_type, scope_id, status);

CREATE INDEX asset_dependencies_depends_on_idx
  ON asset_dependencies(depends_on_asset_id, asset_id);
CREATE UNIQUE INDEX asset_dependencies_unique_idx
  ON asset_dependencies(asset_id, depends_on_asset_id, role);
