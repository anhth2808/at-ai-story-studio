import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from './db.js';
import type { DatabaseHandle } from './db.js';

const MIGRATION_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
const migrations = [
  '0000_initial',
  '0001_status_constraints',
  '0002_story_engine',
  '0003_story_continuity_outputs',
  '0004_long_story_engine',
  '0005_manual_analysis',
  '0006_arc_ordinal',
  '0007_scene_engine',
  '0008_scene_source_snapshot',
  '0009_visual_consistency',
  '0010_image_generation',
  '0011_conditioning_mode',
  '0012_image_candidates_quality',
  '0013_animated_story_timeline',
  '0014_ai_video',
];

function migrateThrough0014(database: DatabaseHandle): void {
  database.sqlite.exec(readFileSync(join(MIGRATION_DIRECTORY, '0000_initial.sql'), 'utf8'));
  database.sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _studio_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  for (const id of migrations.slice(1)) {
    database.sqlite.exec(readFileSync(join(MIGRATION_DIRECTORY, `${id}.sql`), 'utf8'));
    database.sqlite
      .prepare('INSERT INTO _studio_migrations (id, applied_at) VALUES (?, ?)')
      .run(id, new Date().toISOString());
  }
}

describe('production pipeline migration', () => {
  it('migrates a fresh database through 0015', () => {
    const database = createDatabase(':memory:');
    expect(migrateDatabase(database)).toBe('0015_production_pipeline');
    expect(
      database.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('production_runs', 'publication_packages') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'production_runs' }, { name: 'publication_packages' }]);
    expect(
      database.sqlite
        .prepare("SELECT 1 FROM _studio_migrations WHERE id='0015_production_pipeline'")
        .get(),
    ).toEqual({ 1: 1 });
    database.sqlite.close();
  });

  it('upgrades an 0014 database without losing rows and enforces foreign keys', () => {
    const database = createDatabase(':memory:');
    migrateThrough0014(database);
    database.sqlite
      .prepare(
        "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Existing','vi-VN','{}','2026-01-01','2026-01-01')",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO video_generation_settings(id,project_id,created_at,updated_at) VALUES('video-settings','project','2026-01-01','2026-01-01')",
      )
      .run();
    database.sqlite.exec(
      readFileSync(join(MIGRATION_DIRECTORY, '0015_production_pipeline.sql'), 'utf8'),
    );
    expect(database.sqlite.prepare('SELECT id FROM video_generation_settings').get()).toEqual({
      id: 'video-settings',
    });
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO production_profiles(id,project_id,profile_key,revision,settings,created_at,updated_at) VALUES('profile','missing','BALANCED',1,'{}','2026-01-01','2026-01-01')",
        )
        .run(),
    ).toThrow();
    database.sqlite.close();
  });
});
