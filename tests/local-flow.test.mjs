import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const web = join(root, 'apps', 'web');

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('yerel yönetici, kurye, atama ve QR teslimat akışı', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alperflex-test-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const adminEmail = 'admin@example.test';
  const adminPassword = 'long-test-password-123';
  const server = spawn(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', web, '-p', String(port), '-H', '127.0.0.1'], { cwd: root, env: { ...process.env, ALPERFLEX_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let db;
  server.stdout.on('data', chunk => { output += chunk.toString(); });
  server.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    let ready = false;
    let lastHealth = '';
    for (let n = 0; n < 100; n++) {
      try { const r = await fetch(`${base}/api/health`); lastHealth = `${r.status} ${await r.text()}`; if (r.ok) { ready = true; break; } } catch (error) { lastHealth = String(error); }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `web sunucusu başlamadı: ${lastHealth}; ${output}`);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) })).status, 401);
    db = new DatabaseSync(join(dir, 'data.sqlite'));
    const salt = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO profiles(id,email,password_hash,full_name,role,center_id,max_parcels,available,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), adminEmail, `${salt}:${scryptSync(adminPassword, salt, 64).toString('hex')}`, 'Yönetici', 'admin', null, 5, 0, new Date().toISOString());
    const adminLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
    assert.equal(adminLogin.status, 200);
    const cookie = adminLogin.headers.get('set-cookie').split(';')[0];
    const admin = async (action, values = {}) => {
      const r = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ action, ...values }) });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return body.data;
    };
    const center = await admin('create_center', { name: 'Test Merkez', address: 'Test Sokak 1', manager_full_name: 'Merkez Yetkilisi', manager_email: 'merkez@example.test', manager_password: 'manager-password-123' });
    const otherCenter = await admin('create_center', { name: 'Diğer Merkez', address: 'Başka Sokak 9', manager_full_name: 'Diğer Yetkili', manager_email: 'diger@example.test', manager_password: 'other-manager-pass-123' });
    const centerLogin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'merkez@example.test', password: 'manager-password-123' }) });
    assert.equal(centerLogin.status, 200);
    const centerCookie = centerLogin.headers.get('set-cookie').split(';')[0];
    const manager = async (action, values = {}, expected = 200) => {
      const r = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: centerCookie }, body: JSON.stringify({ action, ...values }) });
      const body = await r.json();
      assert.equal(r.status, expected, JSON.stringify(body));
      return body.data;
    };
    const slot = await manager('create_slot', { center_id: center.id, code: 'a1' });
    assert.equal(slot.code, 'A1');
    await manager('create_slot', { center_id: otherCenter.id, code: 'B1' }, 403);
    const centerData = await fetch(`${base}/api/data`, { headers: { Cookie: centerCookie } });
    assert.deepEqual((await centerData.json()).centers.map(item => item.id), [center.id]);
    const courier1 = await manager('create_user', { full_name: 'Kurye Bir', email: 'bir@example.test', password: 'courier-password-123', role: 'courier', center_id: center.id, max_parcels: 2 });
    const courier2 = await manager('create_user', { full_name: 'Kurye İki', email: 'iki@example.test', password: 'courier-password-456', role: 'courier', center_id: center.id, max_parcels: 2 });
    const publicCenters = await fetch(`${base}/api/public/centers`);
    assert.ok((await publicCenters.json()).centers.some(item => item.id === center.id));
    const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: 'Yeni Kurye', email: 'yeni@example.test', password: 'new-courier-pass-123', center_id: center.id }) });
    assert.equal(registration.status, 200);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yeni@example.test', password: 'new-courier-pass-123', client: 'mobile' }) })).status, 403);
    const pending = db.prepare("SELECT id FROM profiles WHERE email='yeni@example.test'").get();
    await manager('approve_courier', { courier_id: pending.id });
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yeni@example.test', password: 'new-courier-pass-123', client: 'mobile' }) })).status, 200);
    const parcelInput = { center_id: center.id, slot_id: slot.id, kind: 'box', weight_kg: 1, description: '', sender_name: 'Gönderici', sender_phone: '', recipient_name: 'Alıcı', recipient_phone: '5551234567', origin_address: 'Test Sokak 1', destination_address: 'Hedef Sokak 2' };
    const p1 = await manager('create_parcel', parcelInput);
    const p2 = await manager('create_parcel', parcelInput);
    const courierLogin = async (email, password) => {
      const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, client: 'mobile' }) });
      assert.equal(r.status, 200);
      return (await r.json()).token;
    };
    const token1 = await courierLogin('bir@example.test', 'courier-password-123');
    const token2 = await courierLogin('iki@example.test', 'courier-password-456');
    const mobile = async (token, action, values = {}, expected = 200) => {
      const r = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...values }) });
      const body = await r.json();
      assert.equal(r.status, expected, JSON.stringify(body));
      return body;
    };
    await mobile(token1, 'availability', { available: true });
    let job = db.prepare('SELECT * FROM jobs ORDER BY created_at LIMIT 1').get();
    assert.equal(job.courier_id, courier1.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM parcels WHERE job_id=?').get(job.id).n, 2);
    await mobile(token1, 'job_action', { job_id: job.id, operation: 'reject' });
    await mobile(token2, 'availability', { available: true });
    job = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
    assert.equal(job.courier_id, courier2.id);
    await mobile(token2, 'job_action', { job_id: job.id, operation: 'accept' });
    const courierData = await fetch(`${base}/api/data`, { headers: { Authorization: `Bearer ${token2}` } });
    assert.equal(courierData.status, 200);
    assert.ok((await courierData.json()).parcels.every(parcel => !('qr_token' in parcel)));
    await mobile(token2, 'job_action', { job_id: job.id, operation: 'verify_pickup', qr: randomUUID() }, 422);
    const label = await fetch(`${base}/api/label?id=${p1.id}`, { headers: { Cookie: centerCookie } });
    assert.equal(label.status, 200);
    assert.match((await label.json()).qr, /^data:image\/png;base64,/);
    const qr1 = db.prepare('SELECT qr_token FROM parcels WHERE id=?').get(p1.id).qr_token;
    const qr2 = db.prepare('SELECT qr_token FROM parcels WHERE id=?').get(p2.id).qr_token;
    await mobile(token2, 'job_action', { job_id: job.id, operation: 'verify_pickup', qr: qr1 });
    await mobile(token2, 'job_action', { job_id: job.id, operation: 'confirm_pickup' });
    await mobile(token2, 'job_action', { job_id: job.id, operation: 'start_route' });
    const stop = db.prepare('SELECT id FROM stops WHERE job_id=?').get(job.id);
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'arrive' });
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'scan', qr: randomUUID() }, 422);
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'scan', qr: qr1 });
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'deliver_stop' }, 422);
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'scan', qr: qr2 });
    await mobile(token2, 'job_action', { job_id: job.id, stop_id: stop.id, operation: 'deliver_stop' });
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'delivered');
    const p3 = await manager('create_parcel', { ...parcelInput, recipient_name: 'Yeni Alıcı', destination_address: 'Başka Sokak 5' });
    const returnJob = db.prepare('SELECT * FROM jobs WHERE id<>? ORDER BY created_at DESC LIMIT 1').get(job.id);
    const returnToken = returnJob.courier_id === courier1.id ? token1 : token2;
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'accept' });
    const qr3 = db.prepare('SELECT qr_token FROM parcels WHERE id=?').get(p3.id).qr_token;
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'verify_pickup', qr: qr3 });
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'confirm_pickup' });
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'cancel' });
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(returnJob.id).status, 'return_pending');
    const returnInfo = await manager('issue_return_code', { job_id: returnJob.id });
    assert.match(returnInfo.code, /^\d{6}$/);
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'confirm_return', code: '000000' }, 422);
    assert.equal(db.prepare('SELECT return_attempts FROM jobs WHERE id=?').get(returnJob.id).return_attempts, 1);
    await mobile(returnToken, 'job_action', { job_id: returnJob.id, operation: 'confirm_return', code: returnInfo.code });
    assert.notEqual(db.prepare('SELECT status FROM jobs WHERE id=?').get(returnJob.id).status, 'return_pending');
    const userData = await fetch(`${base}/api/data`, { headers: { Authorization: `Bearer ${token1}` } });
    assert.equal(userData.status, 200);
    assert.equal((await userData.json()).profile.id, courier1.id);
  } finally {
    db?.close();
    if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
    await rm(dir, { recursive: true, force: true });
  }
});
