import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Dev-only: deletes all transactions (and valuations) for one entity.
// Use when re-importing a source whose dedup-key format changed.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Disabled in production.' }, { status: 403 });
  }

  let entity = '';
  try {
    ({ entity } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Send { entity } as JSON.' }, { status: 400 });
  }
  if (!entity) return NextResponse.json({ error: 'Missing entity.' }, { status: 400 });

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: txErr, count: txCount } = await supabase
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('entity', entity);
    if (txErr) throw txErr;

    // Drop matching valuations too (table may not exist — ignore that).
    const { error: valErr, count: valCount } = await supabase
      .from('valuations')
      .delete({ count: 'exact' })
      .eq('entity', entity);
    if (valErr && !/relation .*valuations.* does not exist/i.test(valErr.message)) throw valErr;

    return NextResponse.json({ entity, transactions: txCount ?? 0, valuations: valCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
