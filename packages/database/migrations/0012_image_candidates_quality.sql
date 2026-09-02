CREATE TABLE scene_image_candidate_sets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_stable_id TEXT NOT NULL,
  scene_revision_id TEXT NOT NULL REFERENCES scene_revisions(id) ON DELETE CASCADE,
  visual_prompt_package_id TEXT REFERENCES visual_prompt_packages(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'TEXT_ONLY',
  workflow_template TEXT,
  package_fingerprint TEXT,
  settings_fingerprint TEXT,
  requested_count INTEGER NOT NULL,
  source_generation_id TEXT REFERENCES scene_image_generations(id) ON DELETE SET NULL,
  generation_instructions TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scene_image_candidate_sets_scene_idx
  ON scene_image_candidate_sets(project_id, scene_stable_id, created_at);
CREATE INDEX scene_image_candidate_sets_project_idx
  ON scene_image_candidate_sets(project_id, created_at);
ALTER TABLE scene_image_generations ADD COLUMN candidate_set_id TEXT
  REFERENCES scene_image_candidate_sets(id) ON DELETE SET NULL;
ALTER TABLE scene_image_generations ADD COLUMN candidate_index INTEGER;
CREATE UNIQUE INDEX scene_image_generations_candidate_idx
  ON scene_image_generations(candidate_set_id, candidate_index)
  WHERE candidate_set_id IS NOT NULL;
CREATE INDEX scene_image_generations_candidate_set_idx
  ON scene_image_generations(candidate_set_id);
ALTER TABLE scene_image_generations ADD COLUMN review_scores TEXT NOT NULL DEFAULT '{}';
ALTER TABLE scene_image_generations ADD COLUMN review_issues TEXT NOT NULL DEFAULT '[]';
ALTER TABLE image_generation_settings ADD COLUMN require_image_approval INTEGER
  NOT NULL DEFAULT 0 CHECK (require_image_approval IN (0, 1));
