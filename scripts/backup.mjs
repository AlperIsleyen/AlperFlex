import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.ALPERFLEX_DATA_DIR || join(process.env.LOCALAPPDATA || join(process.cwd(), '.local'), 'AlperFlex');
const source = join(dir, 'data.sqlite');
if (!existsSync(source)) { console.error('Yedeklenecek veritabanı bulunamadı.'); process.exit(1); }
const backups = join(dir, 'backups');
mkdirSync(backups, { recursive: true });
const target = join(backups, `alperflex-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(source);
try { await backup(db, target); console.log(`Yedek: ${target}`); }
finally { db.close(); }
