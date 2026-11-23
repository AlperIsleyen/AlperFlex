import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { id, now, one, run, transaction } from '@/lib/db';
import { ApiError, jsonError, passwordHash } from '@/lib/server';

export const runtime = 'nodejs';
const schema = z.object({ full_name: z.string().trim().min(2).max(300), email: z.email(), password: z.string().min(12).max(200), center_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const input = schema.parse(await req.json());
    transaction(() => {
      if (!one('SELECT id FROM centers WHERE id=?', input.center_id)) throw new ApiError(404, 'Merkez bulunamadı');
      if (one('SELECT id FROM profiles WHERE email=?', input.email.trim().toLowerCase())) throw new ApiError(409, 'Bu e-posta zaten kayıtlı');
      run('INSERT INTO profiles(id,email,password_hash,full_name,role,center_id,max_parcels,available,approved,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id(), input.email.trim().toLowerCase(), passwordHash(input.password), input.full_name, 'courier', input.center_id, 5, 0, 0, now());
    });
    return NextResponse.json({ ok: true, message: 'Kayıt alındı. Merkez hesabı onaylayınca giriş yapabilirsiniz.' });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(issue => issue.message).join(', ') }, { status: 422 });
    return jsonError(error);
  }
}
