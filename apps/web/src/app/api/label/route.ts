import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { actor, ApiError, checked, db, jsonError, requireAdmin } from '@/lib/server';

export async function GET(req: NextRequest) {
  try {
    const profile = await actor(req);
    requireAdmin(profile);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) throw new ApiError(422, 'Kargo kimliği gerekli');
    const parcel = checked(await db.from('parcels').select('*').eq('id', id).single());
    const slot = checked(await db.from('slots').select('code').eq('id', parcel.slot_id).single());
    const address = checked(await db.from('addresses').select('display_text').eq('id', parcel.destination_address_id).single());
    const qr = await QRCode.toDataURL(parcel.qr_token, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
    return NextResponse.json({ qr, id: parcel.id, kind: parcel.kind, slot: slot.code, recipient: parcel.recipient_name, address: address.display_text });
  } catch (error) { return jsonError(error); }
}
