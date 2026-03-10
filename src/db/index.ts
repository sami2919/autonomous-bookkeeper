import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DATABASE_URL ?? path.join(process.cwd(), 'bookkeeper.db');

// Survive Next.js HMR reloads in dev
const globalForDb = globalThis as unknown as { sqlite: Database.Database };

const sqlite = globalForDb.sqlite ?? new Database(DB_PATH);

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sqlite = sqlite;
}

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

import * as schema from './schema';

export const db = drizzle(sqlite, { schema });
export type Schema = typeof schema;

export { sqlite };
