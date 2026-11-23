import { all, id, now, one, Row, run } from './db';
import { ApiError } from './server';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

function fail(message: string): never { throw new ApiError(422, message); }
function event(event_type: string, fields: Row = {}) {
  run('INSERT INTO events(actor_id,center_id,job_id,parcel_id,event_type,details,created_at) VALUES(?,?,?,?,?,?,?)', fields.actor_id || null, fields.center_id || null, fields.job_id || null, fields.parcel_id || null, event_type, JSON.stringify(fields.details || {}), now());
}
function address(text: string) {
  const display = text.trim().replace(/\s+/g, ' ');
  const normalized = display.toLocaleLowerCase('tr-TR');
  const found = one('SELECT id FROM addresses WHERE normalized_text=?', normalized);
  if (found) return found.id as string;
  const addressId = id();
  run('INSERT INTO addresses(id,normalized_text,display_text,created_at) VALUES(?,?,?,?)', addressId, normalized, display, now());
  return addressId;
}
function parcelsForJob(jobId: string) { return all('SELECT * FROM parcels WHERE job_id=? ORDER BY created_at,id', jobId); }
function returnHash(jobId: string, code: string) { return createHash('sha256').update(`${jobId}:${code}`).digest('hex'); }
function candidates(centerId: string) {
  return all(`SELECT * FROM profiles p WHERE role='courier' AND approved=1 AND available=1 AND center_id=? AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.courier_id=p.id AND j.status IN ('offered','accepted','picked_up','in_transit','return_pending')) ORDER BY created_at,id`, centerId);
}

export function issueReturnCode(profile: Row, jobId: string) {
  const job = one("SELECT * FROM jobs WHERE id=? AND status='return_pending' AND center_id=?", jobId, profile.center_id);
  if (!job) fail('Bu merkezde iade bekleyen iş yok');
  const code = String(randomInt(100000, 1000000));
  run('UPDATE jobs SET return_code_hash=?,return_code_expires_at=?,return_attempts=0 WHERE id=?', returnHash(job.id, code), new Date(Date.now() + 30 * 60000).toISOString(), job.id);
  event('return_code_issued', { actor_id: profile.id, center_id: job.center_id, job_id: job.id });
  return { code, expires_in_minutes: 30 };
}

export function dispatch(centerId: string) {
  for (const courier of candidates(centerId)) {
    const queued = all(`SELECT j.* FROM jobs j WHERE j.center_id=? AND j.status='queued' AND (SELECT COUNT(*) FROM parcels p WHERE p.job_id=j.id)<=? AND NOT EXISTS(SELECT 1 FROM job_rejections r WHERE r.job_id=j.id AND r.courier_id=?) ORDER BY j.created_at,j.id LIMIT 1`, centerId, courier.max_parcels, courier.id)[0];
    if (queued) {
      run("UPDATE jobs SET courier_id=?,status='offered',offered_at=? WHERE id=?", courier.id, now(), queued.id);
      run("UPDATE parcels SET status='offered' WHERE job_id=?", queued.id);
      event('job_offered', { center_id: centerId, job_id: queued.id, details: { courier_id: courier.id } });
      continue;
    }
    const ready = all("SELECT * FROM parcels WHERE center_id=? AND job_id IS NULL AND status='ready' ORDER BY created_at,id", centerId);
    if (!ready.length) continue;
    const groups = new Map<string, Row[]>();
    for (const parcel of ready) {
      const key = JSON.stringify([parcel.destination_address_id, parcel.recipient_name, parcel.recipient_phone]);
      groups.set(key, [...(groups.get(key) || []), parcel]);
    }
    const selected: Row[][] = [];
    let remaining = courier.max_parcels as number;
    for (const group of groups.values()) {
      if (remaining <= 0) break;
      if (group.length > remaining && (group.length <= courier.max_parcels || selected.length > 0)) continue;
      selected.push(group.slice(0, remaining));
      remaining -= Math.min(group.length, remaining);
    }
    if (!selected.length) continue;
    const jobId = id();
    run("INSERT INTO jobs(id,center_id,courier_id,status,offered_at,created_at) VALUES(?,?,?,'offered',?,?)", jobId, centerId, courier.id, now(), now());
    selected.forEach((group, index) => {
      const first = group[0];
      const stopId = id();
      run('INSERT INTO stops(id,job_id,address_id,recipient_name,recipient_phone,sequence_no) VALUES(?,?,?,?,?,?)', stopId, jobId, first.destination_address_id, first.recipient_name, first.recipient_phone, index + 1);
      for (const parcel of group) run("UPDATE parcels SET job_id=?,stop_id=?,status='offered' WHERE id=?", jobId, stopId, parcel.id);
    });
    event('job_offered', { center_id: centerId, job_id: jobId, details: { courier_id: courier.id, count: selected.flat().length } });
  }
}

export function requeue(profile: Row, jobId: string) {
  const job = one('SELECT * FROM jobs WHERE id=?', jobId);
  if (!job || !['queued','offered','accepted'].includes(job.status)) fail('Bu iş yeniden atanamaz');
  if (job.status === 'queued') run('DELETE FROM job_rejections WHERE job_id=?', jobId);
  else if (job.courier_id) run('INSERT OR IGNORE INTO job_rejections(job_id,courier_id,rejected_at) VALUES(?,?,?)', jobId, job.courier_id, now());
  run("UPDATE jobs SET courier_id=NULL,status='queued',offered_at=NULL,accepted_at=NULL,pickup_verified=0 WHERE id=?", jobId);
  run("UPDATE parcels SET status='ready' WHERE job_id=?", jobId);
  event('admin_requeue', { actor_id: profile.id, center_id: job.center_id, job_id: jobId });
  dispatch(job.center_id);
}

function finishReturn(job: Row, profile: Row) {
  const remaining = all("SELECT * FROM parcels WHERE job_id=? AND status<>'delivered' ORDER BY created_at,id", job.id);
  if (!remaining.length) fail('İade edilecek paket kalmadı');
  const delivered = one("SELECT id FROM parcels WHERE job_id=? AND status='delivered' LIMIT 1", job.id);
  if (!delivered) {
    run('INSERT OR IGNORE INTO job_rejections(job_id,courier_id,rejected_at) VALUES(?,?,?)', job.id, profile.id, now());
    run("UPDATE jobs SET status='queued',courier_id=NULL,offered_at=NULL,accepted_at=NULL,picked_up_at=NULL,pickup_verified=0,return_requested_at=NULL,return_code_hash=NULL,return_code_expires_at=NULL,return_attempts=0 WHERE id=?", job.id);
    run('UPDATE stops SET arrived_at=NULL WHERE job_id=?', job.id);
    run("UPDATE parcels SET status='ready',scanned_at=NULL WHERE job_id=?", job.id);
    return;
  }
  const newJobId = id();
  run("INSERT INTO jobs(id,center_id,status,created_at) VALUES(?,?,'queued',?)", newJobId, job.center_id, now());
  run('INSERT INTO job_rejections(job_id,courier_id,rejected_at) VALUES(?,?,?)', newJobId, profile.id, now());
  const oldStops = all(`SELECT s.* FROM stops s WHERE s.job_id=? AND EXISTS(SELECT 1 FROM parcels p WHERE p.stop_id=s.id AND p.status<>'delivered') ORDER BY s.sequence_no`, job.id);
  oldStops.forEach((stop, index) => {
    const newStopId = id();
    run('INSERT INTO stops(id,job_id,address_id,recipient_name,recipient_phone,sequence_no) VALUES(?,?,?,?,?,?)', newStopId, newJobId, stop.address_id, stop.recipient_name, stop.recipient_phone, index + 1);
    run("UPDATE parcels SET job_id=?,stop_id=?,status='ready',scanned_at=NULL WHERE stop_id=? AND status<>'delivered'", newJobId, newStopId, stop.id);
  });
  run("UPDATE jobs SET status='returned_partial',return_code_hash=NULL,return_code_expires_at=NULL,return_attempts=0 WHERE id=?", job.id);
}

export function courierAction(profile: Row, input: Row) {
  const job = one('SELECT * FROM jobs WHERE id=?', input.job_id);
  if (!job || job.courier_id !== profile.id || job.center_id !== profile.center_id) fail('Bu işe erişim yok');
  const { operation, stop_id: stopId, qr } = input;
  if (operation === 'accept' && job.status === 'offered') {
    run("UPDATE jobs SET status='accepted',accepted_at=? WHERE id=?", now(), job.id);
    run("UPDATE parcels SET status='accepted' WHERE job_id=?", job.id);
  } else if (operation === 'reject' && job.status === 'offered') {
    run('INSERT OR IGNORE INTO job_rejections(job_id,courier_id,rejected_at) VALUES(?,?,?)', job.id, profile.id, now());
    run("UPDATE jobs SET status='queued',courier_id=NULL,offered_at=NULL WHERE id=?", job.id);
    run("UPDATE parcels SET status='ready' WHERE job_id=?", job.id);
  } else if (operation === 'cancel' && ['offered','accepted'].includes(job.status)) {
    run('INSERT OR IGNORE INTO job_rejections(job_id,courier_id,rejected_at) VALUES(?,?,?)', job.id, profile.id, now());
    run("UPDATE jobs SET status='queued',courier_id=NULL,offered_at=NULL,accepted_at=NULL,pickup_verified=0 WHERE id=?", job.id);
    run("UPDATE parcels SET status='ready' WHERE job_id=?", job.id);
  } else if (operation === 'cancel' && ['picked_up','in_transit'].includes(job.status)) {
    run("UPDATE jobs SET status='return_pending',return_requested_at=? WHERE id=?", now(), job.id);
    run("UPDATE parcels SET status='return_pending',scanned_at=NULL WHERE job_id=? AND status<>'delivered'", job.id);
  } else if (operation === 'confirm_return' && job.status === 'return_pending') {
    const code = String(input.code || '').trim();
    if (!/^\d{6}$/.test(code) || !job.return_code_hash || !job.return_code_expires_at || job.return_code_expires_at < now()) fail('Merkezden geçerli bir iade kodu alın');
    if (job.return_attempts >= 5) fail('Çok fazla hatalı deneme. Merkez yeni kod oluşturmalı');
    const actual = Buffer.from(returnHash(job.id, code), 'hex');
    const expected = Buffer.from(job.return_code_hash, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      run('UPDATE jobs SET return_attempts=return_attempts+1 WHERE id=?', job.id);
      return { error: 'İade kodu yanlış' };
    }
    finishReturn(job, profile);
  } else if (operation === 'verify_pickup' && job.status === 'accepted') {
    if (!one('SELECT id FROM parcels WHERE job_id=? AND qr_token=?', job.id, qr || null)) fail('QR bu işe ait değil');
    run('UPDATE jobs SET pickup_verified=1 WHERE id=?', job.id);
  } else if (operation === 'confirm_pickup' && job.status === 'accepted' && job.pickup_verified) {
    run("UPDATE jobs SET status='picked_up',picked_up_at=? WHERE id=?", now(), job.id);
    run("UPDATE parcels SET status='picked_up' WHERE job_id=?", job.id);
  } else if (operation === 'start_route' && job.status === 'picked_up') {
    run("UPDATE jobs SET status='in_transit' WHERE id=?", job.id);
    run("UPDATE parcels SET status='in_transit' WHERE job_id=?", job.id);
  } else if (['arrive','scan','deliver_stop'].includes(operation) && job.status === 'in_transit') {
    const stop = one('SELECT * FROM stops WHERE id=? AND job_id=? AND delivered_at IS NULL', stopId || null, job.id);
    if (!stop) fail('Geçersiz teslimat noktası');
    if (operation === 'arrive') run('UPDATE stops SET arrived_at=COALESCE(arrived_at,?) WHERE id=?', now(), stop.id);
    if (operation === 'scan') {
      if (!stop.arrived_at) fail('Önce adrese vardığınızı belirtin');
      const parcel = one('SELECT * FROM parcels WHERE stop_id=? AND job_id=? AND qr_token=?', stop.id, job.id, qr || null);
      if (!parcel) fail('QR bu adresteki kargoya ait değil');
      if (!parcel.scanned_at) {
        run('UPDATE parcels SET scanned_at=? WHERE id=?', now(), parcel.id);
        event('parcel_scanned', { actor_id: profile.id, center_id: job.center_id, job_id: job.id, parcel_id: parcel.id });
      }
      return { ok: true, already_scanned: !!parcel.scanned_at };
    }
    if (operation === 'deliver_stop') {
      if (!stop.arrived_at) fail('Önce adrese vardığınızı belirtin');
      if (one('SELECT id FROM parcels WHERE stop_id=? AND scanned_at IS NULL', stop.id)) fail('Bu adresteki tüm QR kodlarını okutun');
      run('UPDATE stops SET delivered_at=? WHERE id=?', now(), stop.id);
      run("UPDATE parcels SET status='delivered',delivered_at=? WHERE stop_id=?", now(), stop.id);
      if (!one('SELECT id FROM stops WHERE job_id=? AND delivered_at IS NULL', job.id)) run("UPDATE jobs SET status='delivered',delivered_at=? WHERE id=?", now(), job.id);
    }
  } else fail('İş durumu bu işlem için uygun değil');
  event(operation, { actor_id: profile.id, center_id: job.center_id, job_id: job.id, details: { stop_id: stopId || null } });
  if (['reject','cancel','confirm_return','deliver_stop'].includes(operation)) dispatch(job.center_id);
  return { ok: true };
}

export function perform(profile: Row, input: Row) {
  let data: unknown = null;
  if (input.action === 'create_center') {
    const centerId = id();
    run('INSERT INTO centers(id,name,address_text,created_at) VALUES(?,?,?,?)', centerId, input.name, input.address, now());
    data = one('SELECT * FROM centers WHERE id=?', centerId);
  } else if (input.action === 'create_slot') {
    const slotId = id();
    run('INSERT INTO slots(id,center_id,code) VALUES(?,?,?)', slotId, input.center_id, input.code.toUpperCase());
    data = one('SELECT * FROM slots WHERE id=?', slotId);
  } else if (input.action === 'create_user') {
    fail('Kullanıcı oluşturma ayrı işlem gerektirir');
  } else if (input.action === 'create_parcel') {
    const slot = one('SELECT id FROM slots WHERE id=? AND center_id=?', input.slot_id, input.center_id);
    if (!slot) fail('Raf bu merkeze ait değil');
    if (input.kind === 'box' && !input.weight_kg) fail('Kutu ağırlığı zorunlu');
    const originId = address(input.origin_address);
    const destinationId = address(input.destination_address);
    const parcelId = id();
    run(`INSERT INTO parcels(id,qr_token,center_id,slot_id,kind,weight_kg,description,sender_name,sender_phone,recipient_name,recipient_phone,origin_address_id,destination_address_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, parcelId, id(), input.center_id, input.slot_id, input.kind, input.weight_kg ?? null, input.description, input.sender_name, input.sender_phone, input.recipient_name, input.recipient_phone, originId, destinationId, now());
    event('parcel_created', { actor_id: profile.id, center_id: input.center_id, parcel_id: parcelId });
    dispatch(input.center_id);
    data = one('SELECT * FROM parcels WHERE id=?', parcelId);
  } else if (input.action === 'dispatch') dispatch(input.center_id);
  else if (input.action === 'requeue') requeue(profile, input.job_id);
  else if (input.action === 'availability') {
    run('UPDATE profiles SET available=? WHERE id=?', input.available ? 1 : 0, profile.id);
    if (input.available && profile.center_id) dispatch(profile.center_id);
  } else if (input.action === 'job_action') data = courierAction(profile, input);
  return data;
}
