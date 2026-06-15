import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Upsert the (up to 3) pension scenarios.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const body = await request.json();
    const scenarios = Array.isArray(body?.scenarios) ? body.scenarios : [];
    if (!scenarios.length) return NextResponse.json({ error: 'No scenarios' }, { status: 400 });

    const rows = scenarios
      .filter((s: any) => s?.scenario)
      .map((s: any) => ({
        scenario: String(s.scenario),
        title: s.title ?? null,
        note: s.note ?? null,
        retirement_date: s.retirement_date || null,
        gross: s.gross != null && s.gross !== '' ? Number(s.gross) : null,
        access_age: s.access_age ?? null,
      }));

    const { data, error } = await db()
      .from('pension_sim')
      .upsert(rows, { onConflict: 'scenario' })
      .select();
    if (error) throw error;
    return NextResponse.json({ ok: true, count: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
