import { requireApiUser } from '../../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBankCsv, parseBankXlsx, parseSantanderPdf, toExpenseRecords, type ParsedRow } from '../../../../../lib/expense-import';
import { extractPdfText } from '../../../../../lib/pdfText';

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isXlsx = /\.xlsx?$/i.test(file.name)
      || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.type === 'application/vnd.ms-excel';

    let rows: ParsedRow[];
    if (isPdf) {
      // "Extrato Consolidado" PDF — parse the Conta à Ordem running-balance table.
      const text = await extractPdfText(Buffer.from(await file.arrayBuffer()));
      rows = parseSantanderPdf(text);
    } else if (isXlsx) {
      // "Listagem de Movimentos" export — legacy binary .xls (CDFV2), same
      // column layout as the CSV/ActivoBank XLSX path: date/date/desc/signed amount/balance.
      rows = parseBankXlsx(Buffer.from(await file.arrayBuffer()));
    } else {
      rows = parseBankCsv(await file.text());   // CSV export (UTF-8)
    }

    const records = toExpenseRecords('santander', rows);
    if (records.length === 0) {
      return NextResponse.json({ error: `No expenses found. Check the ${isPdf ? 'PDF statement' : isXlsx ? 'XLS/XLSX' : 'CSV'} format.` }, { status: 422 });
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
