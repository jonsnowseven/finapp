import { requireApiUser } from '../../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBankCsv, toExpenseRecords } from '../../../../../lib/expense-import';

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();   // UTF-8
    const records = toExpenseRecords('santander', parseBankCsv(text));
    if (records.length === 0) {
      return NextResponse.json({ error: 'No expenses found. Check the CSV format.' }, { status: 422 });
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase
      // ignoreDuplicates: keep existing rows untouched (preserves manual re-tags/comments).
      .from('expenses').upsert(records, { onConflict: 'source_document', ignoreDuplicates: true }).select();
    if (error) throw error;
    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
