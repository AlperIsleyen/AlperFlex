import { NextRequest, NextResponse } from 'next/server';
import { actor, ApiError, checked, db, jsonError } from '@/lib/server';

export async function POST(req: NextRequest) {
  try {
    const profile = await actor(req);
    if (profile.role !== 'courier') throw new ApiError(403, 'Kurye yetkisi gerekli');
    const { job_id, stop_id, origin } = await req.json();
    const job = checked(await db.from('jobs').select('id,center_id,courier_id,status').eq('id', job_id).single());
    if (job.courier_id !== profile.id || job.center_id !== profile.center_id || !['picked_up','in_transit'].includes(job.status)) throw new ApiError(403, 'Bu rotaya erişim yok');
    const stop = checked(await db.from('stops').select('address_id').eq('id', stop_id).eq('job_id', job_id).single());
    const destination = checked(await db.from('addresses').select('lat,lng').eq('id', stop.address_id).single());
    if (typeof origin?.lat !== 'number' || typeof origin?.lng !== 'number' || Math.abs(origin.lat) > 90 || Math.abs(origin.lng) > 180) throw new ApiError(422, 'Geçersiz koordinat');
    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) throw new ApiError(503, 'Google Maps sunucu anahtarı ayarlanmamış');
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline' },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } }, destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } }, travelMode: 'DRIVE', languageCode: 'tr-TR', units: 'METRIC' }), cache: 'no-store'
    });
    if (!response.ok) throw new ApiError(502, 'Rota alınamadı');
    const payload = await response.json();
    return NextResponse.json({ route: payload.routes?.[0] || null });
  } catch (error) { return jsonError(error); }
}
