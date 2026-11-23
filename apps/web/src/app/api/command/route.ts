import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { id, now, one, run, transaction } from '@/lib/db';
import { actor, ApiError, jsonError, passwordHash, requireCenter, requireOwner } from '@/lib/server';
import { issueReturnCode, perform } from '@/lib/operations';

export const runtime = 'nodejs';
const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(300);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_center'), name: short, address: short, manager_full_name: short, manager_email: z.email(), manager_password: z.string().min(12) }),
  z.object({ action: z.literal('create_center_account'), center_id: uuid, full_name: short, email: z.email(), password: z.string().min(12) }),
  z.object({ action: z.literal('create_slot'), center_id: uuid, code: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal('create_user'), full_name: short, email: z.email(), password: z.string().min(12), role: z.literal('courier'), center_id: uuid, max_parcels: z.coerce.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal('approve_courier'), courier_id: uuid }),
  z.object({ action: z.literal('create_parcel'), center_id: uuid, slot_id: uuid, kind: z.enum(['document','box','package']), weight_kg: z.coerce.number().positive().optional(), description: z.string().max(1000).default(''), sender_name: short, sender_phone: z.string().max(30).default(''), recipient_name: short, recipient_phone: short, origin_address: short, destination_address: short }),
  z.object({ action: z.literal('dispatch'), center_id: uuid }),
  z.object({ action: z.literal('requeue'), job_id: uuid }),
  z.object({ action: z.literal('issue_return_code'), job_id: uuid }),
  z.object({ action: z.literal('availability'), available: z.boolean() }),
  z.object({ action: z.literal('job_action'), job_id: uuid, operation: z.enum(['accept','reject','cancel','confirm_return','verify_pickup','confirm_pickup','start_route','arrive','scan','deliver_stop']), stop_id: uuid.optional(), qr: uuid.optional(), code: z.string().optional() })
]);

export async function POST(req: NextRequest) {
  try {
    const profile = actor(req);
    const input = schema.parse(await req.json());
    if (['create_center','create_center_account'].includes(input.action)) requireOwner(profile);
    if ('center_id' in input && ['create_slot','create_user','create_parcel','dispatch'].includes(input.action)) requireCenter(profile, input.center_id);
    if ('job_id' in input && ['requeue','issue_return_code'].includes(input.action)) {
      const job = one('SELECT center_id FROM jobs WHERE id=?', input.job_id);
      if (!job) throw new ApiError(404, 'İş bulunamadı');
      requireCenter(profile, job.center_id);
    }
    if (input.action === 'approve_courier') {
      const courier = one("SELECT center_id FROM profiles WHERE id=? AND role='courier'", input.courier_id);
      if (!courier) throw new ApiError(404, 'Kurye bulunamadı');
      requireCenter(profile, courier.center_id);
    }
    if (['availability','job_action'].includes(input.action) && profile.role !== 'courier') throw new ApiError(403, 'Kurye yetkisi gerekli');
    let data: unknown;
    if (input.action === 'create_center' || input.action === 'create_center_account') {
      const email = (input.action === 'create_center' ? input.manager_email : input.email).trim().toLowerCase();
      const password = input.action === 'create_center' ? input.manager_password : input.password;
      const fullName = input.action === 'create_center' ? input.manager_full_name : input.full_name;
      data = transaction(() => {
        if (one('SELECT id FROM profiles WHERE email=?', email)) throw new ApiError(409, 'Bu e-posta zaten kayıtlı');
        const centerId = input.action === 'create_center' ? id() : input.center_id;
        if (input.action === 'create_center') run('INSERT INTO centers(id,name,address_text,created_at) VALUES(?,?,?,?)', centerId, input.name, input.address, now());
        else if (!one('SELECT id FROM centers WHERE id=?', centerId)) throw new ApiError(404, 'Merkez bulunamadı');
        if (one("SELECT id FROM profiles WHERE role='admin' AND center_id=?", centerId)) throw new ApiError(409, 'Bu merkezin hesabı zaten var');
        run('INSERT INTO profiles(id,email,password_hash,full_name,role,center_id,max_parcels,available,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id(), email, passwordHash(password), fullName, 'admin', centerId, 5, 0, now());
        return one('SELECT * FROM centers WHERE id=?', centerId);
      });
    } else if (input.action === 'create_user') {
      data = transaction(() => {
        if (one('SELECT id FROM profiles WHERE email=?', input.email.trim().toLowerCase())) throw new ApiError(409, 'Bu e-posta zaten kayıtlı');
        const userId = id();
        run('INSERT INTO profiles(id,email,password_hash,full_name,role,center_id,max_parcels,available,created_at) VALUES(?,?,?,?,?,?,?,?,?)', userId, input.email.trim().toLowerCase(), passwordHash(input.password), input.full_name, 'courier', input.center_id, input.max_parcels || 5, 0, now());
        return one('SELECT id,full_name,role,center_id,max_parcels FROM profiles WHERE id=?', userId);
      });
    } else if (input.action === 'approve_courier') {
      data = transaction(() => { run("UPDATE profiles SET approved=1 WHERE id=? AND role='courier' AND center_id=?", input.courier_id, profile.center_id); return { ok: true }; });
    } else if (input.action === 'issue_return_code') {
      data = transaction(() => issueReturnCode(profile, input.job_id));
    } else data = transaction(() => perform(profile, input));
    if (data && typeof data === 'object' && 'error' in data) throw new ApiError(422, String((data as { error: string }).error));
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join(', ') }, { status: 422 });
    return jsonError(error);
  }
}
