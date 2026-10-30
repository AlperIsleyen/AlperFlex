import { NextRequest, NextResponse } from 'next/server';
import { actor, checked, db, jsonError } from '@/lib/server';

export async function GET(req: NextRequest) {
  try {
    const profile = await actor(req);
    if (profile.role === 'admin') {
      const [centers, slots, profiles, addresses, parcels, jobs, stops, events] = await Promise.all([
        db.from('centers').select('*').order('name'),
        db.from('slots').select('*').order('code'),
        db.from('profiles').select('id,full_name,role,center_id,max_parcels,available,created_at').order('created_at'),
        db.from('addresses').select('*'),
        db.from('parcels').select('*').order('created_at', { ascending: false }).limit(500),
        db.from('jobs').select('*').order('created_at', { ascending: false }).limit(200),
        db.from('stops').select('*').order('sequence_no'),
        db.from('events').select('*').order('created_at', { ascending: false }).limit(200)
      ]);
      return NextResponse.json({ profile, centers: checked(centers), slots: checked(slots), profiles: checked(profiles), addresses: checked(addresses), parcels: checked(parcels), jobs: checked(jobs), stops: checked(stops), events: checked(events) });
    }
    const jobs = checked(await db.from('jobs').select('*').eq('courier_id', profile.id).in('status', ['offered','accepted','picked_up','in_transit']).order('created_at', { ascending: false }));
    const ids = jobs.map(j => j.id);
    const [centers, slots, parcels, stops] = await Promise.all([
      db.from('centers').select('*').eq('id', profile.center_id),
      db.from('slots').select('*').eq('center_id', profile.center_id),
      ids.length ? db.from('parcels').select('*').in('job_id', ids) : Promise.resolve({ data: [], error: null }),
      ids.length ? db.from('stops').select('*').in('job_id', ids).order('sequence_no') : Promise.resolve({ data: [], error: null })
    ]);
    const safeParcels = checked(parcels);
    const safeStops = checked(stops);
    const addressIds = new Set([...safeParcels.map(p => p.destination_address_id), ...safeStops.map(s => s.address_id)]);
    const addresses = addressIds.size ? checked(await db.from('addresses').select('*').in('id', [...addressIds])) : [];
    return NextResponse.json({ profile, jobs, centers: checked(centers), slots: checked(slots), parcels: safeParcels, stops: safeStops, addresses });
  } catch (error) { return jsonError(error); }
}
