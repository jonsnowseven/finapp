import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function ptNum(s: string): number {
  // Strip spaces (thousands sep like "3 710,95") and dots, comma → decimal.
  return parseFloat(s.replace(/[\s.]/g, '').replace(',', '.')) || 0;
}

function ptDate(s: string): string {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function parseBancoInvestPdf(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Extract account number for dedup key
  let account = 'unknown';
  for (let i = 0; i < lines.length; i++) {
    if (/^CONTA$/i.test(lines[i]) && /^\d{5,}$/.test(lines[i + 1] ?? '')) {
      account = lines[i + 1].trim();
      break;
    }
  }

  // Only parse rows after the "Investimentos (por lote)" section header
  const sectionIdx = lines.findIndex(l => /investimentos/i.test(l));
  const dataLines = sectionIdx >= 0 ? lines.slice(sectionIdx) : lines;

  // pdf-parse concatenates all cells with no spaces:
  // "Subscrição11-05-20264,781420,91431,100,1"
  // Pattern: DATE(DD-MM-YYYY) + QTD(N,4dec) + PRICE(N,4dec) + rest
  const ROW_RE = /(\d{2}-\d{2}-\d{4})(\d+,\d{4})(\d+,\d{4})/;

  const records = [];
  let rowIdx = 0;

  for (const line of dataLines) {
    if (/DATA/i.test(line)) continue; // skip header
    const m = line.match(ROW_RE);
    if (!m) continue;

    const date  = ptDate(m[1]);
    const qty   = ptNum(m[2]);
    const price = ptNum(m[3]);
    if (!date || qty === 0 || price === 0) continue;

    const amount = parseFloat((qty * price).toFixed(2));
    const source = `bancoinvest_${account}_${date}_${rowIdx}`;
    rowIdx++;

    records.push({
      date,
      entity:           'Banco Invest',
      asset_name:       'Alves Ribeiro PPR',
      transaction_type: 'buy',
      quantity:         qty,
      price,
      amount,
      currency:         'EUR',
      fees:             0,
      source_document:  source,
    });
  }

  return records;
}

// Current valuation from the summary row:
//   "... 08-12-2020 175,5050 19,4987 21,1444 8,44 288,83 3 710,95"
// columns: INÍCIO QTD P.M.S COTAÇÃO VAR% VAR_MOEDA VALOR  (VALOR = current value).
// Statement date is the standalone DD-MM-YYYY line near the top.
function parseBancoInvestValuation(text: string): { as_of_date: string; value: number; units: number | null } | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Summary row (pdf-parse glues all cells, no spaces between numbers):
  //   ...INÍCIO QTD(,4) P.M.S(,4) COTAÇÃO(,4) VAR%(,2) VAR_MOEDA(,2) VALOR(,2)
  // Fixed decimal widths disambiguate the run. VALOR may keep a space thousands
  // separator (e.g. "3 710,95").
  // VALOR group allows whitespace (incl. non-breaking space U+00A0) and dot
  // thousands separators, e.g. "3 710,95" / "3 710,95" / "3.710,95".
  const SUMMARY_RE = /(\d{2}-\d{2}-\d{4})(\d+,\d{4})(\d+,\d{4})(\d+,\d{4})(\d+,\d{2})(\d+,\d{2})([\d\s.]+,\d{2})/;
  let sm: RegExpMatchArray | null = null;
  for (const l of lines) {
    sm = l.match(SUMMARY_RE);
    if (sm) break;
  }
  if (!sm) return null;

  const units = ptNum(sm[2]);
  const value = ptNum(sm[7]);
  if (!value) return null;

  // Statement date: a standalone DD-MM-YYYY line near the top. Some exports omit
  // it — fall back to today (this is a "current position" report regardless).
  const dateLine = lines.find(l => /^\d{2}-\d{2}-\d{4}$/.test(l));
  const as_of_date = dateLine ? ptDate(dateLine) : new Date().toISOString().slice(0, 10);

  return { as_of_date, value, units };
}

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdf = await pdfParse(buffer);
    const records = parseBancoInvestPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No subscriptions found in PDF. Check the file format.' }, { status: 422 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('transactions')
      .upsert(records, { onConflict: 'source_document' })
      .select();

    if (error) throw error;

    // Store the statement's current valuation (best-effort)
    const val = parseBancoInvestValuation(pdf.text);
    if (val) {
      await supabase.from('valuations').upsert(
        {
          entity:          'Banco Invest',
          asset_name:      'Alves Ribeiro PPR',
          as_of_date:      val.as_of_date,
          units:           val.units,
          value:           val.value,
          currency:        'EUR',
          source_document: `bancoinvest_val_${val.as_of_date}`,
        },
        { onConflict: 'entity,as_of_date' }
      );
    }

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
