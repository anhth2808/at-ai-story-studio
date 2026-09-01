ALTER TABLE scene_revisions ADD COLUMN source_content TEXT NOT NULL DEFAULT '';

UPDATE scene_revisions
SET source_content = (
  SELECT content
  FROM chapters
  WHERE chapters.id = scene_revisions.chapter_id
)
WHERE source_content = '';
