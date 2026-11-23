import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { one, run, now, Row } from './db';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const SESSION_COOKIE = 'alperflex_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || hash.length !== 128) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', digest(token), userId, new Date(Date.now() + 7 * 86400000).toISOString());
  return token;
}

export function revokeSession(token: string) { run('DELETE FROM sessions WHERE token_hash=?', digest(token)); }
export function requestToken(req: NextRequest) { return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || req.cookies.get(SESSION_COOKIE)?.value || null; }

export function actor(req: NextRequest): Row {
  const token = requestToken(req);
  if (!token) throw new ApiError(401, 'Oturum açmanız gerekiyor');
  const profile = one('SELECT p.id,p.email,p.full_name,p.role,p.center_id,p.max_parcels,p.available,p.approved,p.created_at FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', digest(token), now());
  if (!profile) throw new ApiError(401, 'Oturum süresi doldu; yeniden giriş yapın');
  if (req.method !== 'GET' && !req.headers.get('authorization')) {
    const origin = req.headers.get('origin');
    if (origin && new URL(origin).host !== req.headers.get('host')) throw new ApiError(403, 'Geçersiz istek kaynağı');
  }
  return profile;
}

export function requireAdmin(profile: Row) { if (profile.role !== 'admin') throw new ApiError(403, 'Yönetici yetkisi gerekli'); }
export function requireOwner(profile: Row) { if (profile.role !== 'admin' || profile.center_id) throw new ApiError(403, 'Ana yönetici yetkisi gerekli'); }
export function requireCenter(profile: Row, centerId: string) { if (profile.role !== 'admin' || profile.center_id !== centerId) throw new ApiError(403, 'Bu merkeze erişim yok'); }
export function jsonError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  if (status === 500) console.error('API error:', error);
  return NextResponse.json({ error: message }, { status });
}
