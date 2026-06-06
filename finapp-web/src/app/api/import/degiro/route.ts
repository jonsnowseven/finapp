import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// "1.234,56" or "-190,28" → number
function parsePtNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// DD-MM-YYYY → YYYY-MM-DD
function parsePtDate(raw: string): string {
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

const ISIN_RE = /[A-Z]{2}[A-Z0-9]{9}\d/;

// Header/footer noise to strip before parsing.
const NOISE = [
  /^flatexDEGIRO/i, /^Bank SE/i, /degiro\.pt/i, /clientes@/i, /Amstelplein/i,
  /Resumo da carteira/i, /^P[áa]gina/i, /^Transa[çc][õo]es de/i,
  /Quantidade|Valor local|Bolsa de refer|Custos|Taxa de C[âa]mbio|Autofx|Total EUR|^Pre[çc]os$/i,
  /^\d{4}-\d{2}-\d{2}$/,
];

// pdf-parse renders this PDF roughly row-by-row, but products span lines and the
// column count varies (USD vs EUR, with/without costs). Robust strategy:
//  1. strip noise, 2. split into records at each "DD-MM-YYYY HH:MM" boundary,
//  3. anchor on the ISIN, 4. read quantity (first integer after ISIN), price
//     (next 4-decimal number), and Total EUR (the LAST 2-decimal number — the
//     final column, which already nets transaction costs).
function parseDeGiroPdf(text: string) {
  const cleaned = text
    .split('\n')
    .filter((l) => { const s = l.trim(); return s && !NOISE.some((re) => re.test(s)); })
    .join('\n');

  const recRe = /(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2})([\s\S]*?)(?=\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}|$)/g;
  const byKey = new Map<string, any>();
  let m: RegExpExecArray | null;

  while ((m = recRe.exec(cleaned)) !== null) {
    const date = parsePtDate(m[1]);
    const time = m[2];
    const body = m[3];
    const im = body.match(ISIN_RE);
    if (!date || !im) continue;

    const isin = im[0];
    const product = body.slice(0, im.index).replace(/\s+/g, ' ').trim();
    const toks = body.slice((im.index ?? 0) + isin.length).split(/\s+/).filter(Boolean);

    // quantity = first standalone (optionally signed) integer after the ISIN
    const qi = toks.findIndex((t) => /^-?\d+$/.test(t));
    if (qi < 0) continue;
    const qty = parseInt(toks[qi], 10);

    // price = next 4-decimal number (DeGiro prices use 4 decimals)
    const priceTok = toks[qi + 1];
    const price = priceTok && /^-?[\d.]*\d,\d{3,}$/.test(priceTok) ? parsePtNumber(priceTok) : 0;

    // Total EUR = last 2-decimal number on the row (final column, net of costs)
    let total = 0;
    for (let i = toks.length - 1; i >= 0; i--) {
      if (/^-?[\d.]*\d,\d{2}$/.test(toks[i])) { total = parsePtNumber(toks[i]); break; }
    }

    // Skip non-tradeable / corporate-action artifacts (no quantity and no value)
    if (qty === 0 && total === 0) continue;

    const txType = qty < 0 ? 'sell' : qty > 0 ? 'buy' : 'deposit';
    // Deterministic key dedups page-split duplicates (last/complete row wins) and
    // prevents "ON CONFLICT cannot affect row a second time" within the batch.
    const source = `degiro_web_${isin}_${date}_${time.replace(':', '')}_${qty}_${price.toFixed(4)}`;

    byKey.set(source, {
      date,
      entity: 'DeGiro',
      asset_name: product || isin,
      transaction_type: txType,
      quantity: qty !== 0 ? Math.abs(qty) : null,
      price: price || null,
      amount: Math.abs(total),
      currency: 'EUR',
      fees: 0,
      source_document: source,
    });
  }

  return Array.from(byKey.values());
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
    const records = parseDeGiroPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No transactions found in PDF. Check the file format.' }, { status: 422 });
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

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
