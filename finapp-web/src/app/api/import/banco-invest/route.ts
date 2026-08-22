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

// Google Sheets exports this statement with US-locale numbers regardless of
// content: thousands-comma, decimal-dot (e.g. "4,135.67", "193.9900").
function usNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

// Handles a comma inside one quoted field (the VALOR total, e.g. "4,135.67").
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// CSV export of the same "Posição Actual" statement the PDF path below
// parses — mobile app only offers CSV/XLSX, and its PDF export truncates
// year digits unpredictably (a rendering bug, not a parseable pattern), so
// CSV is the reliable source when importing from mobile.
function parseBancoInvestCsv(text: string): {
  records: ReturnType<typeof parseBancoInvestPdf>;
  valuation: ReturnType<typeof parseBancoInvestValuation>;
} {
  const rows = text.split('\n').map(l => l.trim()).filter(Boolean).map(splitCsvLine);

  let account = 'unknown';
  for (let i = 0; i < rows.length; i++) {
    if (/^CONTA$/i.test(rows[i][0] ?? '') && /^\d{5,}$/.test(rows[i + 1]?.[0] ?? '')) {
      account = rows[i + 1][0].trim();
      break;
    }
  }

  const dateRow = rows.find(r => /^\d{2}-\d{2}-\d{4}$/.test(r[0] ?? ''));
  const as_of_date = dateRow ? ptDate(dateRow[0]) : new Date().toISOString().slice(0, 10);

  let valuation: { as_of_date: string; value: number; units: number | null } | null = null;
  const summaryHeaderIdx = rows.findIndex(r => /^TITULAR$/i.test(r[0] ?? '') && /IN[ÍI]CIO/i.test(r[1] ?? ''));
  if (summaryHeaderIdx >= 0 && rows[summaryHeaderIdx + 1]) {
    const sr = rows[summaryHeaderIdx + 1];
    const units = usNum(sr[2] ?? '');
    const value = usNum(sr[7] ?? '');
    if (value) valuation = { as_of_date, value, units: units || null };
  }

  const lotsHeaderIdx = rows.findIndex(r => /^TIPO$/i.test(r[0] ?? '') && /DATA/i.test(r[1] ?? ''));
  const records: ReturnType<typeof parseBancoInvestPdf> = [];
  let rowIdx = 0;
  if (lotsHeaderIdx >= 0) {
    for (let i = lotsHeaderIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0] || /bancoinvest\.pt/i.test(r[0])) break;
      if (!/^\d{2}-\d{2}-\d{4}$/.test(r[1] ?? '')) continue;

      const date = ptDate(r[1]);
      const qty = usNum(r[2] ?? '');
      const price = usNum(r[3] ?? '');
      if (!date || qty === 0 || price === 0) continue;

      const amount = parseFloat((qty * price).toFixed(2));
      records.push({
        date,
        entity: 'Banco Invest',
        asset_name: 'Alves Ribeiro PPR',
        transaction_type: 'buy',
        quantity: qty,
        price,
        amount,
        currency: 'EUR',
        fees: 0,
        source_document: `bancoinvest_${account}_${date}_${rowIdx}`,
      });
      rowIdx++;
    }
  }

  return { records, valuation };
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
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';

    let records: ReturnType<typeof parseBancoInvestPdf>;
    let val: ReturnType<typeof parseBancoInvestValuation>;

    if (isCsv) {
      const parsed = parseBancoInvestCsv(await file.text());
      records = parsed.records;
      val = parsed.valuation;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdf = await pdfParse(buffer);
      records = parseBancoInvestPdf(pdf.text);
      val = parseBancoInvestValuation(pdf.text);
    }

    if (records.length === 0 && !val) {
      return NextResponse.json({ error: 'No subscriptions or valuation found. Check the file format.' }, { status: 422 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = records.length > 0
      ? await supabase.from('transactions').upsert(records, { onConflict: 'source_document' }).select()
      : { data: [], error: null };

    if (error) throw error;

    // Store the statement's current valuation (best-effort)
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
