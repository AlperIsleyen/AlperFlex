import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.ALPERFLEX_DATA_DIR || join(process.env.LOCALAPPDATA || join(process.cwd(), '.local'), 'AlperFlex');
export const databasePath = join(dataDir, 'data.sqlite');

declare global { var alperflexDb: DatabaseSync | undefined; }

export function db() {
  if (globalThis.alperflexDb) return globalThis.alperflexDb;
  mkdirSync(dataDir, { recursive: true });
  const connection = new DatabaseSync(databasePath, { timeout: 5000 });
  connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS centers (id TEXT PRIMARY KEY, name TEXT NOT NULL, address_text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, center_id TEXT NOT NULL REFERENCES centers(id), code TEXT NOT NULL, UNIQUE(center_id, code));
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','courier')), center_id TEXT REFERENCES centers(id), max_parcels INTEGER NOT NULL DEFAULT 5, available INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS addresses (id TEXT PRIMARY KEY, normalized_text TEXT NOT NULL UNIQUE, display_text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, center_id TEXT NOT NULL REFERENCES centers(id), courier_id TEXT REFERENCES profiles(id), status TEXT NOT NULL DEFAULT 'queued', pickup_verified INTEGER NOT NULL DEFAULT 0, offered_at TEXT, accepted_at TEXT, picked_up_at TEXT, delivered_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS job_rejections (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, courier_id TEXT NOT NULL REFERENCES profiles(id), rejected_at TEXT NOT NULL, PRIMARY KEY(job_id,courier_id));
    CREATE TABLE IF NOT EXISTS stops (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, address_id TEXT NOT NULL REFERENCES addresses(id), recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL, sequence_no INTEGER NOT NULL, arrived_at TEXT, delivered_at TEXT, UNIQUE(job_id,address_id,recipient_name,recipient_phone), UNIQUE(job_id,sequence_no));
    CREATE TABLE IF NOT EXISTS parcels (id TEXT PRIMARY KEY, qr_token TEXT NOT NULL UNIQUE, center_id TEXT NOT NULL REFERENCES centers(id), slot_id TEXT NOT NULL REFERENCES slots(id), kind TEXT NOT NULL CHECK(kind IN ('document','box','package')), weight_kg REAL, description TEXT NOT NULL DEFAULT '', sender_name TEXT NOT NULL, sender_phone TEXT NOT NULL DEFAULT '', recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL, origin_address_id TEXT NOT NULL REFERENCES addresses(id), destination_address_id TEXT NOT NULL REFERENCES addresses(id), job_id TEXT REFERENCES jobs(id), stop_id TEXT REFERENCES stops(id), status TEXT NOT NULL DEFAULT 'ready', scanned_at TEXT, delivered_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES profiles(id), center_id TEXT REFERENCES centers(id), job_id TEXT REFERENCES jobs(id), parcel_id TEXT REFERENCES parcels(id), event_type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS parcels_dispatch_idx ON parcels(center_id,status,created_at) WHERE job_id IS NULL;
    CREATE INDEX IF NOT EXISTS jobs_courier_idx ON jobs(courier_id,status);
    CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at DESC);
  `);
  const profileColumns = new Set((connection.prepare('PRAGMA table_info(profiles)').all() as Row[]).map(column => column.name));
  if (!profileColumns.has('approved')) connection.exec('ALTER TABLE profiles ADD COLUMN approved INTEGER NOT NULL DEFAULT 1');
  const jobColumns = new Set((connection.prepare('PRAGMA table_info(jobs)').all() as Row[]).map(column => column.name));
  if (!jobColumns.has('return_requested_at')) connection.exec('ALTER TABLE jobs ADD COLUMN return_requested_at TEXT');
  if (!jobColumns.has('return_code_hash')) connection.exec('ALTER TABLE jobs ADD COLUMN return_code_hash TEXT');
  if (!jobColumns.has('return_code_expires_at')) connection.exec('ALTER TABLE jobs ADD COLUMN return_code_expires_at TEXT');
  if (!jobColumns.has('return_attempts')) connection.exec('ALTER TABLE jobs ADD COLUMN return_attempts INTEGER NOT NULL DEFAULT 0');
  globalThis.alperflexDb = connection;
  return connection;
}

export type Row = Record<string, any>;
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function all(sql: string, ...params: (string | number | null)[]): Row[] { return db().prepare(sql).all(...params) as Row[]; }
export function one(sql: string, ...params: (string | number | null)[]): Row | undefined { return db().prepare(sql).get(...params) as Row | undefined; }
export function run(sql: string, ...params: (string | number | null)[]) { return db().prepare(sql).run(...params); }
export function transaction<T>(work: () => T): T {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try { const result = work(); connection.exec('COMMIT'); return result; }
  catch (error) { connection.exec('ROLLBACK'); throw error; }
}
