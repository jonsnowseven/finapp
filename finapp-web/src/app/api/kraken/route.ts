import { requireApiUser } from "../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchKrakenTransactions } from '../../../lib/kraken';

export async function POST() {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const transactions = await fetchKrakenTransactions();

    if (transactions.length === 0) {
      return NextResponse.json({ message: 'No Kraken transactions found', inserted: 0 });
    }

    const { data, error } = await supabase
      .from('transactions')
      .upsert(transactions, { onConflict: 'source_document' })
      .select();

    if (error) throw error;

    return NextResponse.json({ message: 'Kraken sync complete', inserted: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
