import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://invalid.local',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'missing',
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
);

const base = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
export async function api(path: string, token: string, body?: object) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Bağlantı hatası');
  return payload;
}

export type Row = Record<string, any>;
export type CourierData = { profile: Row; centers: Row[]; slots: Row[]; jobs: Row[]; parcels: Row[]; stops: Row[]; addresses: Row[] };

export function decodePolyline(encoded: string) {
  const coordinates: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const coord of ['lat', 'lng']) {
      let shift = 0, result = 0, byte: number;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      const delta = (result & 1) ? ~(result >> 1) : result >> 1;
      if (coord === 'lat') lat += delta; else lng += delta;
    }
    coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return coordinates;
}
