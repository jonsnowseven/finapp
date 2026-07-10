import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeSnapshot } from '../../../../lib/portfolio';

// Daily net-worth snapshot, computed server-side (no browser needed).
// Triggered by Vercel Cron; protected by CRON_SECRET (Vercel sends it as a
// Bearer token). Fails closed when CRON_SECRET is unset.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { total, byEntity } = await computeSnapshot(true);
    const as_of = new Date().toISOString().slice(0, 10);
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await db.from('snapshots').upsert({ as_of, total, by_entity: byEntity }, { onConflict: 'as_of' });
    if (error) throw error;
    return NextResponse.json({ ok: true, as_of, total, entities: Object.keys(byEntity).length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
