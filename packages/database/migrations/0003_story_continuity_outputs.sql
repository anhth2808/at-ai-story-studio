ALTER TABLE story_summary_revisions ADD COLUMN events TEXT NOT NULL DEFAULT '[]';
ALTER TABLE story_summary_revisions ADD COLUMN thread_transitions TEXT NOT NULL DEFAULT '[]';
