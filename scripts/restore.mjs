import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const chosen = process.argv[2];
if (!chosen || !existsSync(chosen)) {
  console.error('Kullanım: npm run restore -- "C:\\yedek\\alperflex-....sqlite"');
  process.exit(1);
}
const source = resolve(chosen);
const dir = process.env.ALPERFLEX_DATA_DIR || join(process.env.LOCALAPPDATA || join(process.cwd(), '.local'), 'AlperFlex');
mkdirSync(dir, { recursive: true });
const live = join(dir, 'data.sqlite');
if (source === resolve(live)) { console.error('Canlı veritabanını yedek olarak seçmeyin.'); process.exit(1); }

const check = new DatabaseSync(source, { readOnly: true });
try {
  const integrity = check.prepare('PRAGMA integrity_check').get();
  if (integrity?.integrity_check !== 'ok') throw new Error('Yedek veritabanı bütünlük kontrolünü geçemedi.');
  if (!check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").get()) throw new Error('Bu dosya AlperFlex veritabanı değil.');
} finally { check.close(); }

if (existsSync(live)) {
  const current = new DatabaseSync(live);
  try {
    const safety = join(dir, 'backups', `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    mkdirSync(join(dir, 'backups'), { recursive: true });
    await backup(current, safety);
    console.log(`Önceki veritabanının yedeği: ${safety}`);
  } finally { current.close(); }
}

const temp = join(dir, `restore-${process.pid}.sqlite`);
const from = new DatabaseSync(source, { readOnly: true });
try { await backup(from, temp); } finally { from.close(); }
const old = join(dir, `before-restore-${process.pid}.sqlite`);
const movedSidecars = [];
try {
  if (existsSync(live)) renameSync(live, old);
  // Eski WAL/SHM dosyaları yeni veritabanıyla eşleşmez.
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${live}${suffix}`)) {
      renameSync(`${live}${suffix}`, `${old}${suffix}`);
      movedSidecars.push(suffix);
    }
  }
  renameSync(temp, live);
}
catch (error) {
  if (existsSync(old)) renameSync(old, live);
  for (const suffix of movedSidecars) renameSync(`${old}${suffix}`, `${live}${suffix}`);
  throw error;
}
rmSync(old, { force: true });
for (const suffix of movedSidecars) rmSync(`${old}${suffix}`, { force: true });
console.log(`Geri yüklendi: ${live}`);
