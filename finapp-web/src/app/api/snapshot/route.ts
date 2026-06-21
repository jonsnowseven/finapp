import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Upsert today's net-worth snapshot (one row per day).
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const { as_of, total, by_entity } = await request.json();
    if (!as_of || typeof total !== 'number') {
      return NextResponse.json({ error: 'as_of and numeric total required' }, { status: 400 });
    }
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabase
      .from('snapshots')
      .upsert({ as_of, total, by_entity: by_entity ?? null }, { onConflict: 'as_of' });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
