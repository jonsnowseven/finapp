import { requireApiUser } from '../../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseBankCsv, parseBankXlsx, parseActivoBankPdf, toExpenseRecords, type ParsedRow } from '../../../../../lib/expense-import';

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isXlsx = /\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    let rows: ParsedRow[];
    if (isPdf) {
      // "EXTRATO COMBINADO" PDF — parse the CONTA SIMPLES running-balance table.
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
      const pdf = await pdfParse(Buffer.from(await file.arrayBuffer()));
      rows = parseActivoBankPdf(pdf.text);
    } else if (isXlsx) {
      // XLSX history export — same columns as the CSV export.
      rows = parseBankXlsx(Buffer.from(await file.arrayBuffer()));
    } else {
      // CSV movements export (UTF-8; debits use a double minus).
      rows = parseBankCsv(await file.text());
    }

    const records = toExpenseRecords('activobank', rows);
    if (records.length === 0) {
      return NextResponse.json({ error: `No expenses found. Check the ${isPdf ? 'PDF statement' : isXlsx ? 'XLSX' : 'CSV'} format.` }, { status: 422 });
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
