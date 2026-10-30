import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const db = createClient(url || 'https://invalid.local', serviceKey || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false }
});

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function actor(req: NextRequest) {
  if (!url || !serviceKey) throw new ApiError(503, 'Sunucu Supabase ayarları eksik');
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new ApiError(401, 'Oturum açmanız gerekiyor');
  const { data: userData, error: authError } = await db.auth.getUser(token);
  if (authError || !userData.user) throw new ApiError(401, 'Oturum geçersiz');
  const { data: profile, error } = await db.from('profiles').select('*').eq('id', userData.user.id).single();
  if (error || !profile) throw new ApiError(403, 'Hesap profili bulunamadı');
  return profile as { id: string; role: 'admin' | 'courier'; center_id: string | null; full_name: string; available: boolean; max_parcels: number };
}

export function requireAdmin(profile: { role: string }) {
  if (profile.role !== 'admin') throw new ApiError(403, 'Yönetici yetkisi gerekli');
}

export function jsonError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error('API error:', error);
  return NextResponse.json({ error: message }, { status });
}

export async function geocode(text: string) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) throw new ApiError(503, 'Google Maps sunucu anahtarı ayarlanmamış');
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`, { cache: 'no-store' });
  if (!response.ok) throw new ApiError(502, 'Adres konumu bulunamadı');
  const result = await response.json();
  if (result.status !== 'OK' || !result.results?.[0]) throw new ApiError(422, `Adres doğrulanamadı: ${text}`);
  const loc = result.results[0].geometry.location;
  return { lat: loc.lat as number, lng: loc.lng as number };
}

export async function upsertAddress(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
  const existing = await db.from('addresses').select('id').eq('normalized_text', normalized).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id as string;
  const pos = await geocode(text);
  const insert = await db.from('addresses').upsert({ normalized_text: normalized, display_text: text.trim(), ...pos }, { onConflict: 'normalized_text' }).select('id').single();
  if (insert.error) throw insert.error;
  return insert.data.id as string;
}

export function checked<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new ApiError(400, result.error.message);
  if (result.data === null || result.data === undefined) throw new ApiError(404, 'Kayıt bulunamadı');
  return result.data as NonNullable<T>;
}

export function ensure(result: { error: { message: string } | null }) {
  if (result.error) throw new ApiError(400, result.error.message);
}
