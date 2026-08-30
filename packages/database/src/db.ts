import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

export function closeDatabase(database: DatabaseHandle): void {
  database.sqlite.close();
}
