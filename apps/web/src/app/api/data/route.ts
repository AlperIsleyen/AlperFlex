import { NextRequest, NextResponse } from 'next/server';
import { all, one } from '@/lib/db';
import { actor, jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export function GET(req: NextRequest) {
  try {
    const profile = actor(req);
    if (profile.role === 'admin' && !profile.center_id) return NextResponse.json({
      profile, centers: all('SELECT * FROM centers ORDER BY name'), slots: [],
      profiles: all("SELECT id,full_name,role,center_id,approved FROM profiles WHERE role='admin' ORDER BY created_at"),
      addresses: [], parcels: [], jobs: [], stops: [], events: []
    });
    if (profile.role === 'admin') {
      const parcels = all('SELECT * FROM parcels WHERE center_id=? ORDER BY created_at DESC LIMIT 500', profile.center_id);
      const addressIds = [...new Set(parcels.flatMap(p => [p.origin_address_id, p.destination_address_id]))];
      const jobs = all('SELECT * FROM jobs WHERE center_id=? ORDER BY created_at DESC LIMIT 200', profile.center_id);
      const jobIds = jobs.map(j => j.id);
      return NextResponse.json({
        profile, centers: [one('SELECT * FROM centers WHERE id=?', profile.center_id)].filter(Boolean),
        slots: all('SELECT * FROM slots WHERE center_id=? ORDER BY code', profile.center_id),
        profiles: all('SELECT id,full_name,role,center_id,max_parcels,available,approved,created_at FROM profiles WHERE center_id=? ORDER BY created_at', profile.center_id),
        parcels, addresses: addressIds.length ? all(`SELECT * FROM addresses WHERE id IN (${addressIds.map(() => '?').join(',')})`, ...addressIds) : [],
        jobs, stops: jobIds.length ? all(`SELECT * FROM stops WHERE job_id IN (${jobIds.map(() => '?').join(',')}) ORDER BY sequence_no`, ...jobIds) : [],
        events: all('SELECT * FROM events WHERE center_id=? ORDER BY created_at DESC LIMIT 200', profile.center_id)
      });
    }
    const jobs = all("SELECT * FROM jobs WHERE courier_id=? AND status IN ('offered','accepted','picked_up','in_transit','return_pending') ORDER BY created_at DESC", profile.id);
    const jobIds = jobs.map(j => j.id);
    const parcels = jobIds.length ? all(`SELECT * FROM parcels WHERE job_id IN (${jobIds.map(() => '?').join(',')})`, ...jobIds).map(({ qr_token, ...parcel }) => parcel) : [];
    const stops = jobIds.length ? all(`SELECT * FROM stops WHERE job_id IN (${jobIds.map(() => '?').join(',')}) ORDER BY sequence_no`, ...jobIds) : [];
    const addressIds = [...new Set([...parcels.map(p => p.destination_address_id), ...stops.map(s => s.address_id)])];
    return NextResponse.json({ profile, jobs, centers: profile.center_id ? [one('SELECT * FROM centers WHERE id=?', profile.center_id)].filter(Boolean) : [], slots: all('SELECT * FROM slots WHERE center_id=?', profile.center_id), parcels, stops, addresses: addressIds.length ? all(`SELECT * FROM addresses WHERE id IN (${addressIds.map(() => '?').join(',')})`, ...addressIds) : [] });
  } catch (error) { return jsonError(error); }
}
