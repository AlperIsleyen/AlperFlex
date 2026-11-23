import { NextRequest, NextResponse } from 'next/server';
import { actor, jsonError } from '@/lib/server';
export const runtime = 'nodejs';
export function GET(req: NextRequest) { try { return NextResponse.json({ profile: actor(req) }); } catch (error) { return jsonError(error); } }
