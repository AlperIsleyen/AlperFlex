import { NextRequest, NextResponse } from 'next/server';
import { actor, jsonError, requestToken, revokeSession, SESSION_COOKIE } from '@/lib/server';
export const runtime = 'nodejs';
export function POST(req: NextRequest) {
  try {
    actor(req);
    const token = requestToken(req);
    if (token) revokeSession(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (error) { return jsonError(error); }
}
