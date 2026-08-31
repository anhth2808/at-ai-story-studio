import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

export function createDatabase(filename: string): DatabaseHandle {
  mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export function migrateDatabase(database: DatabaseHandle): string {
  const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const migrations = [
    '0000_initial',
    '0001_status_constraints',
    '0002_story_engine',
    '0003_story_continuity_outputs',
    '0004_long_story_engine',
    '0005_manual_analysis',
    '0006_arc_ordinal',
  ];
  database.sqlite.exec(readFileSync(join(migrationDirectory, '0000_initial.sql'), 'utf8'));
  database.sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _studio_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  for (const id of migrations) {
    if (!database.sqlite.prepare('SELECT 1 FROM _studio_migrations WHERE id=?').get(id)) {
      database.sqlite.exec(readFileSync(join(migrationDirectory, `${id}.sql`), 'utf8'));
      database.sqlite
        .prepare('INSERT INTO _studio_migrations (id, applied_at) VALUES (?, ?)')
        .run(id, new Date().toISOString());
    }
  }
  return migrations.at(-1)!;
}

export function closeDatabase(database: DatabaseHandle): void {
  database.sqlite.close();
}
