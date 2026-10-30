import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actor, ApiError, checked, db, ensure, geocode, jsonError, requireAdmin, upsertAddress } from '@/lib/server';

const id = z.string().uuid();
const short = z.string().trim().min(1).max(300);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_center'), name: short, address: short }),
  z.object({ action: z.literal('create_slot'), center_id: id, code: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal('create_user'), full_name: short, email: z.email(), password: z.string().min(12), role: z.enum(['admin','courier']), center_id: id.optional(), max_parcels: z.coerce.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal('create_parcel'), center_id: id, slot_id: id, kind: z.enum(['document','box','package']), weight_kg: z.coerce.number().positive().optional(), description: z.string().max(1000).default(''), sender_name: short, sender_phone: z.string().max(30).default(''), recipient_name: short, recipient_phone: short, origin_address: short, destination_address: short }),
  z.object({ action: z.literal('dispatch'), center_id: id }),
  z.object({ action: z.literal('requeue'), job_id: id }),
  z.object({ action: z.literal('availability'), available: z.boolean() }),
  z.object({ action: z.literal('job_action'), job_id: id, operation: z.enum(['accept','reject','verify_pickup','confirm_pickup','start_route','arrive','scan','deliver_stop']), stop_id: id.optional(), qr: id.optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() })
]);

export async function POST(req: NextRequest) {
  try {
    const profile = await actor(req);
    const input = schema.parse(await req.json());
    let data: unknown = null;
    if (input.action === 'create_center') {
      requireAdmin(profile);
      const pos = await geocode(input.address);
      data = checked(await db.from('centers').insert({ name: input.name, address_text: input.address, ...pos }).select('*').single());
    } else if (input.action === 'create_slot') {
      requireAdmin(profile);
      data = checked(await db.from('slots').insert({ center_id: input.center_id, code: input.code.toUpperCase() }).select('*').single());
    } else if (input.action === 'create_user') {
      requireAdmin(profile);
      if (input.role === 'courier' && !input.center_id) throw new ApiError(422, 'Kurye için merkez seçin');
      const created = await db.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true });
      if (created.error || !created.data.user) throw new ApiError(400, created.error?.message || 'Hesap oluşturulamadı');
      const userId = created.data.user.id;
      try {
        data = checked(await db.from('profiles').insert({ id: userId, full_name: input.full_name, role: input.role, center_id: input.role === 'courier' ? input.center_id : null, max_parcels: input.max_parcels || 5 }).select('id,full_name,role,center_id,max_parcels').single());
      } catch (error) {
        await db.auth.admin.deleteUser(userId);
        throw error;
      }
    } else if (input.action === 'create_parcel') {
      requireAdmin(profile);
      if (input.kind === 'box' && !input.weight_kg) throw new ApiError(422, 'Kutu ağırlığı zorunlu');
      const slot = checked(await db.from('slots').select('id').eq('id', input.slot_id).eq('center_id', input.center_id).single());
      if (!slot) throw new ApiError(422, 'Raf bu merkeze ait değil');
      const [originId, destinationId] = await Promise.all([upsertAddress(input.origin_address), upsertAddress(input.destination_address)]);
      data = checked(await db.from('parcels').insert({ center_id: input.center_id, slot_id: input.slot_id, kind: input.kind, weight_kg: input.weight_kg ?? null, description: input.description, sender_name: input.sender_name, sender_phone: input.sender_phone, recipient_name: input.recipient_name, recipient_phone: input.recipient_phone, origin_address_id: originId, destination_address_id: destinationId }).select('*').single());
      ensure(await db.from('events').insert({ actor_id: profile.id, center_id: input.center_id, parcel_id: (data as { id: string }).id, event_type: 'parcel_created' }));
      ensure(await db.rpc('dispatch_center', { p_center: input.center_id }));
    } else if (input.action === 'dispatch') {
      requireAdmin(profile);
      ensure(await db.rpc('dispatch_center', { p_center: input.center_id }));
    } else if (input.action === 'requeue') {
      requireAdmin(profile);
      ensure(await db.rpc('admin_requeue', { p_actor: profile.id, p_job: input.job_id }));
    } else if (input.action === 'availability') {
      if (profile.role !== 'courier') throw new ApiError(403, 'Kurye yetkisi gerekli');
      ensure(await db.from('profiles').update({ available: input.available }).eq('id', profile.id));
      if (input.available && profile.center_id) ensure(await db.rpc('dispatch_center', { p_center: profile.center_id }));
    } else if (input.action === 'job_action') {
      if (profile.role !== 'courier') throw new ApiError(403, 'Kurye yetkisi gerekli');
      data = checked(await db.rpc('courier_action', { p_actor: profile.id, p_action: input.operation, p_job: input.job_id, p_stop: input.stop_id || null, p_qr: input.qr || null, p_lat: input.lat ?? null, p_lng: input.lng ?? null }));
    }
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join(', ') }, { status: 422 });
    return jsonError(error);
  }
}
