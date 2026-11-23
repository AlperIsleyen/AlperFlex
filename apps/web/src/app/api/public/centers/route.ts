import { NextResponse } from 'next/server';
import { all } from '@/lib/db';
import { jsonError } from '@/lib/server';

export const runtime = 'nodejs';
export function GET() {
  try { return NextResponse.json({ centers: all('SELECT id,name,address_text FROM centers ORDER BY name') }); }
  catch (error) { return jsonError(error); }
}
