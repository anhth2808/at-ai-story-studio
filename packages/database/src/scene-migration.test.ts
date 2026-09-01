import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from './db.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Scene Engine migrations', () => {
  it('adds scene tables and source snapshots without resetting existing rows', () => {
    const database = createDatabase(':memory:');
    const initialMigration = join(
      dirname(fileURLToPath(import.meta.url)),
      '../migrations/0000_initial.sql',
    );
    database.sqlite.exec(readFileSync(initialMigration, 'utf8'));
    database.sqlite
      .prepare(
        "INSERT INTO projects(id,title,language,render_config,created_at,updated_at) VALUES('project','Existing project','vi-VN','{}','2026-01-01','2026-01-01')",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO chapters(id,project_id,number,title,content,status,revision,row_version,created_at,updated_at) VALUES('chapter','project',1,'Existing chapter','Existing chapter text','ACTIVE',1,1,'2026-01-01','2026-01-01')",
      )
      .run();
    database.sqlite
      .prepare(
        "INSERT INTO assets(id,project_id,type,role,path,media_type,bytes,sha256,metadata,created_at,updated_at) VALUES('asset','project','BACKGROUND_IMAGE','chapter:background','projects/project/backgrounds/asset.jpg','image/jpeg',1,'hash','{}','2026-01-01','2026-01-01')",
      )
      .run();

    migrateDatabase(database);

    expect(
      database.sqlite.prepare('SELECT title,content FROM chapters WHERE id=?').get('chapter'),
    ).toEqual({
      title: 'Existing chapter',
      content: 'Existing chapter text',
    });
    expect(database.sqlite.prepare('SELECT path FROM assets WHERE id=?').get('asset')).toEqual({
      path: 'projects/project/backgrounds/asset.jpg',
    });
    expect(
      database.sqlite
        .prepare("SELECT 1 FROM _studio_migrations WHERE id='0008_scene_source_snapshot'")
        .get(),
    ).toEqual({ 1: 1 });
    expect(
      (
        database.sqlite.prepare('PRAGMA table_info(scene_revisions)').all() as Array<{
          name: string;
        }>
      ).some((column) => column.name === 'source_content'),
    ).toBe(true);
    expect(
      (
        database.sqlite.prepare('PRAGMA table_info(workflow_steps)').all() as Array<{
          name: string;
        }>
      ).some((column) => column.name === 'payload'),
    ).toBe(true);
    database.sqlite.close();
  });
});
