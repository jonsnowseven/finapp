import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateTag } from '../../../lib/expenses';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Add one expense.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const amount = Number(b?.amount);  // signed: negative = expense, positive = income
    if (!b?.date || !isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: 'date and non-zero amount required' }, { status: 400 });
    }
    const tag = validateTag(String(b?.tag ?? ''));
    if (!tag.ok) return NextResponse.json({ error: tag.error ?? 'Invalid tag' }, { status: 400 });

    const row = {
      date: b.date,
      amount,
      currency: b.currency || 'EUR',
      tag: tag.canonical,
      tag_label: tag.label,
      merchant: b.merchant?.trim() || null,
      note: b.note?.trim() || null,
      source: 'manual',
    };
    const { data, error } = await db().from('expenses').insert(row).select().maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update one or many rows (any source). Body: { id|ids, tag?, note? }.
export async function PATCH(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const ids: string[] = Array.isArray(b?.ids) ? b.ids.filter(Boolean) : b?.id ? [b.id] : [];
    if (ids.length === 0) return NextResponse.json({ error: 'id(s) required' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (b?.tag !== undefined) {
      const tag = validateTag(String(b.tag ?? ''));
      if (!tag.ok) return NextResponse.json({ error: tag.error ?? 'Invalid tag' }, { status: 400 });
      update.tag = tag.canonical; update.tag_label = tag.label;
    }
    if (b?.note !== undefined) {
      const note = String(b.note ?? '').trim();
      update.note = note ? note.slice(0, 500) : null;
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

    const { data, error } = await db().from('expenses').update(update).in('id', ids).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Delete by ?id=
export async function DELETE(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const { error } = await db().from('expenses').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
