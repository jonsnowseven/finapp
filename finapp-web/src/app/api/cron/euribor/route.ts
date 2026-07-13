import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchEuriborSeries, TENORS } from '../../../../lib/euribor';

// Daily: record the latest business-day Euribor for every tenor, so the
// mortgage tab can compute the month-to-date average that drives the next
// rate reset. Protected by CRON_SECRET (Bearer); fails closed when unset.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const rows: { date: string; tenor: string; rate: number }[] = [];
    for (const tenor of TENORS) {
      try {
        const obs = await fetchEuriborSeries(tenor, 'B', 1, true);
        const last = obs[obs.length - 1];
        if (last?.period) rows.push({ date: last.period, tenor, rate: last.rate });
      } catch { /* skip this tenor */ }
    }
    if (rows.length) {
      const { error } = await db.from('euribor_daily').upsert(rows, { onConflict: 'date,tenor' });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, recorded: rows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
