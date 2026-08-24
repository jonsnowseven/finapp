import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Add one legacy-report row.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const name = String(b?.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

    const row = {
      category: b?.category?.trim() || null,
      name,
      platform: b?.platform?.trim() || null,
      password_location: b?.password_location?.trim() || null,
      two_fa: b?.two_fa?.trim() || null,
      is_physical: Boolean(b?.is_physical),
      storage: b?.storage?.trim() || null,
      notes: b?.notes?.trim() || null,
    };
    const { data, error } = await db().from('legacy_accounts').insert(row).select().maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update one field or more on one row. Body: { id, category?, name?, platform?, password_location?, two_fa?, is_physical?, storage?, notes? }.
export async function PATCH(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const id = b?.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const update: Record<string, unknown> = {};
    for (const key of ['category', 'name', 'platform', 'password_location', 'two_fa', 'storage', 'notes'] as const) {
      if (b[key] !== undefined) update[key] = String(b[key]).trim() || null;
    }
    if (b.is_physical !== undefined) update.is_physical = Boolean(b.is_physical);
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

    const { data, error } = await db().from('legacy_accounts').update(update).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const { error } = await db().from('legacy_accounts').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
