import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Dev-only: clears all rows from the transactions table.
// Equivalent to re-running database/schema.sql against an already-correct schema
// (PostgREST can't run DDL, so we empty the table instead of DROP/CREATE).
export async function POST() {
  // Hard guard — never run outside local development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Disabled in production.' }, { status: 403 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // PostgREST requires a filter on delete — match every row.
    const { error: txErr, count: txCount } = await supabase
      .from('transactions')
      .delete({ count: 'exact' })
      .not('id', 'is', null);
    if (txErr) throw txErr;

    // Valuations table may not exist yet — ignore "missing table" errors.
    const { error: valErr, count: valCount } = await supabase
      .from('valuations')
      .delete({ count: 'exact' })
      .not('id', 'is', null);
    if (valErr && !/relation .*valuations.* does not exist/i.test(valErr.message)) throw valErr;

    return NextResponse.json({ deleted: (txCount ?? 0) + (valCount ?? 0), transactions: txCount ?? 0, valuations: valCount ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
