import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchRevolutTransactions } from '../../../lib/revolut';

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const transactions = await fetchRevolutTransactions();

    if (transactions.length === 0) {
      return NextResponse.json({ message: 'No Revolut transactions found', inserted: 0 });
    }

    const { data, error } = await supabase
      .from('transactions')
      .upsert(transactions, { onConflict: 'source_document' })
      .select();

    if (error) throw error;

    return NextResponse.json({ message: 'Revolut sync complete', inserted: data?.length ?? 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
