import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Upsert a single set (manual add, or per-set field edits like annual_pct).
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const body = await request.json();
    if (!body?.set_no) return NextResponse.json({ error: 'set_no required' }, { status: 400 });

    const row = {
      set_no: String(body.set_no).trim(),
      name: body.name ?? body.set_no,
      theme: body.theme ?? null,
      retail: body.retail ?? null,
      paid: body.paid ?? null,
      value: body.value ?? null,
      qty_new: body.qty_new ?? 0,
      qty_used: body.qty_used ?? 0,
      growth_pct: body.growth_pct ?? null,
      annual_pct: body.annual_pct ?? null,
      source_document: `lego_${String(body.set_no).trim()}`,
    };
    // Drop undefined so a partial edit (e.g. only annual_pct) doesn't clobber columns
    const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));

    const { data, error } = await db()
      .from('lego_sets')
      .upsert(clean, { onConflict: 'set_no' })
      .select();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data?.[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Delete by ?set_no=
export async function DELETE(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const setNo = new URL(request.url).searchParams.get('set_no');
  if (!setNo) return NextResponse.json({ error: 'set_no required' }, { status: 400 });
  try {
    const { error } = await db().from('lego_sets').delete().eq('set_no', setNo);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
