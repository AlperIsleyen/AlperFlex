import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';

const dir = process.env.ALPERFLEX_DATA_DIR || join(process.env.LOCALAPPDATA || join(process.cwd(), '.local'), 'AlperFlex');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, 'data.sqlite'));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS centers (id TEXT PRIMARY KEY, name TEXT NOT NULL, address_text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','courier')), center_id TEXT REFERENCES centers(id), max_parcels INTEGER NOT NULL DEFAULT 5, available INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`);
if (db.prepare("SELECT id FROM profiles WHERE role='admin' LIMIT 1").get()) { console.error('Yönetici zaten mevcut.'); process.exitCode = 1; }
else if (!process.stdin.isTTY) { console.error('Bu komutu etkileşimli bir terminalde çalıştırın.'); process.exitCode = 1; }
else {
  let hideInput = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hideInput) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  output.isTTY = true;
  output.columns = process.stdout.columns || 80;
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const name = (await rl.question('Yönetici adı: ')).trim();
  const email = (await rl.question('E-posta: ')).trim().toLowerCase();
  process.stdout.write('Şifre (en az 12 karakter; ekranda görünmez): ');
  hideInput = true;
  const password = await rl.question('');
  hideInput = false;
  rl.close();
  process.stdout.write('\n');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) { console.error('Ad, geçerli e-posta ve en az 12 karakterli şifre gerekli.'); process.exitCode = 1; }
  else {
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
    db.prepare('INSERT INTO profiles(id,email,password_hash,full_name,role,center_id,max_parcels,available,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), email, hash, name, 'admin', null, 5, 0, new Date().toISOString());
    console.log('Yönetici oluşturuldu.');
  }
}
db.close();
