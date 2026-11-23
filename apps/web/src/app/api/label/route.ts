import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { one } from '@/lib/db';
import { actor, ApiError, jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const profile = actor(req);
    if (profile.role !== 'admin' || !profile.center_id) throw new ApiError(403, 'Merkez hesabı gerekli');
    const parcel = one('SELECT p.*,s.code AS slot,a.display_text AS address FROM parcels p JOIN slots s ON s.id=p.slot_id JOIN addresses a ON a.id=p.destination_address_id WHERE p.id=?', req.nextUrl.searchParams.get('id'));
    if (!parcel) throw new ApiError(404, 'Kargo bulunamadı');
    if (parcel.center_id !== profile.center_id) throw new ApiError(403, 'Bu kargo başka merkeze ait');
    const qr = await QRCode.toDataURL(parcel.qr_token, { width: 512, margin: 4, errorCorrectionLevel: 'M' });
    return NextResponse.json({ qr, id: parcel.id, kind: parcel.kind, slot: parcel.slot, recipient: parcel.recipient_name, address: parcel.address });
  } catch (error) { return jsonError(error); }
}
