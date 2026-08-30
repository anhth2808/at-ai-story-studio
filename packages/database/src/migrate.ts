import { join } from 'node:path';
import { createDatabase, migrateDatabase } from './db.js';

const filename = process.env.STUDIO_DB_PATH ?? join(process.cwd(), 'workspace', 'studio.db');
const database = createDatabase(filename);
const version = migrateDatabase(database);
console.log(`Database ready: ${filename} (${version})`);
database.sqlite.close();
