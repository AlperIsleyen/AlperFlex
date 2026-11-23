import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { one } from '@/lib/db';
import { ApiError, createSession, jsonError, SESSION_COOKIE, verifyPassword } from '@/lib/server';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const { email, password, client } = z.object({ email: z.email(), password: z.string(), client: z.enum(['web','mobile']).default('web') }).parse(await req.json());
    const user = one('SELECT id,password_hash,role,full_name,approved FROM profiles WHERE email=?', email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) throw new ApiError(401, 'E-posta veya şifre yanlış');
    if (!user.approved) throw new ApiError(403, 'Merkez hesabı kaydınızı henüz onaylamadı');
    const token = createSession(user.id);
    const response = NextResponse.json({ profile: { id: user.id, role: user.role, full_name: user.full_name }, ...(client === 'mobile' ? { token } : {}) });
    if (client === 'web') response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: 7 * 86400 });
    return response;
  } catch (error) { return jsonError(error); }
}
