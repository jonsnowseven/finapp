import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Shared by POST (insert) and PATCH (update): validate + normalize a
// manually-entered transaction's fields. Returns an error string, or the row.
function buildRow(b: any): { error: string } | { row: Record<string, unknown> } {
  const date = String(b?.date ?? '');
  const entity = String(b?.entity ?? '').trim();
  const assetName = String(b?.asset_name ?? '').trim();
  const transactionType = String(b?.transaction_type ?? '').trim();
  const amount = Number(b?.amount);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Valid date required' };
  if (!entity) return { error: 'Entity required' };
  if (!assetName) return { error: 'Asset name required' };
  if (!transactionType) return { error: 'Transaction type required' };
  if (!isFinite(amount) || amount === 0) return { error: 'Non-zero amount required' };

  const quantity = b?.quantity !== undefined && b.quantity !== '' ? Number(b.quantity) : null;
  const price = b?.price !== undefined && b.price !== '' ? Number(b.price) : null;
  const fees = b?.fees !== undefined && b.fees !== '' ? Number(b.fees) : 0;

  return {
    row: {
      date,
      entity,
      asset_name: assetName,
      isin: b?.isin?.trim() || null,
      transaction_type: transactionType,
      quantity: quantity !== null && isFinite(quantity) ? quantity : null,
      price: price !== null && isFinite(price) ? price : null,
      amount: Math.abs(amount),
      currency: b?.currency?.trim() || 'EUR',
      fees: isFinite(fees) ? Math.abs(fees) : 0,
    },
  };
}

// Add one manually-entered transaction (no source_document — not tied to an import).
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const built = buildRow(b);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

    const { data, error } = await db().from('transactions').insert({ ...built.row, source_document: null }).select().maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Update an existing transaction in place. Body must include `id`.
export async function PATCH(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const id = b?.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const built = buildRow(b);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

    const { data, error } = await db().from('transactions').update(built.row).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, row: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Delete one transaction by id.
export async function DELETE(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    const { error } = await db().from('transactions').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
