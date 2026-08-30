import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDatabase } from './db.js';

const root = dirname(fileURLToPath(import.meta.url));
const filename = process.env.STUDIO_DB_PATH ?? join(process.cwd(), 'workspace', 'studio.db');
const database = createDatabase(filename);
const migration = readFileSync(join(root, '..', 'migrations', '0000_initial.sql'), 'utf8');
database.sqlite.exec(migration);
database.sqlite.exec(
  'CREATE TABLE IF NOT EXISTS _studio_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
);
database.sqlite
  .prepare('INSERT OR IGNORE INTO _studio_migrations (id, applied_at) VALUES (?, ?)')
  .run('0000_initial', new Date().toISOString());
console.log(`Database ready: ${filename}`);
database.sqlite.close();
