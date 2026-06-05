import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// "2.325,29" → 2325.29 ; "1,03842" → 1.03842
function ptNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

// DD-MM-YYYY → YYYY-MM-DD
function ptDate(s: string): string {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// Movement rows (in "MOVIMENTOS DE PRODUTOS REALIZADOS NO PERÍODO"):
//   DATA_MOV(DD-MM-YYYY)  DATA_VALOR(DD-MM-YYYY)  PROD  SUBNUM(9)  TIPO  UNIDADES  VALOR
// e.g. "04-08-2025 04-08-2025 CAF / Série F 209618132 Subscrição 4.000 4.000,00"
// pdf-parse concatenates columns, so UNIDADES+VALOR can glue ("4.0004.000,00").
// Aforro units are issued at ~1 EUR, so we split using units ≈ valor.
function parseAforroPdf(text: string) {
  // Scope to the MOVIMENTOS section (detail/resumo rows won't match anyway)
  const movIdx = text.indexOf('MOVIMENTOS DE PRODUTOS');
  const movText = movIdx >= 0 ? text.slice(movIdx) : text;

  // Collapse whitespace so spaced and concatenated layouts parse identically
  const flat = movText.replace(/\s+/g, '');

  // DATA_MOV + DATA_VALOR + product(any) + SUBNUM(9) + TIPO(letters) + (UNITS&VALOR int run) + ,DEC
  const ROW_RE = /(\d{2}-\d{2}-\d{4})(\d{2}-\d{2}-\d{4}).*?(\d{9})([A-Za-zÀ-ÿ]+)([\d.]+),(\d{2})/g;

  const records = [];
  let m: RegExpExecArray | null;

  while ((m = ROW_RE.exec(flat)) !== null) {
    const date    = ptDate(m[1]);             // Data Mov.
    const subnum  = m[3];
    const tipo    = m[4].toLowerCase();
    const intRun  = m[5].replace(/\./g, '');  // UNIDADES + VALOR-integer-part, glued (dots stripped)
    const dec     = m[6];                     // VALOR decimals
    if (!date) continue;

    // Subscrição → buy, Resgate → sell
    let txType: string;
    if (tipo.startsWith('subscri')) txType = 'buy';
    else if (tipo.startsWith('resgate')) txType = 'sell';
    else continue;

    // Split UNITS|VALOR assuming unit price ≈ 1 EUR (Aforro issue value)
    let units = 0;
    let valor = 0;
    let bestErr = Infinity;
    for (let k = 1; k < intRun.length; k++) {
      const u = parseInt(intRun.slice(0, k), 10);
      const valorInt = parseInt(intRun.slice(k), 10);
      const v = valorInt + parseInt(dec, 10) / 100;
      const err = Math.abs(u - v);
      if (err < bestErr) { bestErr = err; units = u; valor = v; }
    }
    if (units === 0 || valor === 0) continue;

    records.push({
      date,
      entity:           'Aforro',
      asset_name:       'Certificados de Aforro Série F',
      transaction_type: txType,
      quantity:         units,
      price:            parseFloat((valor / units).toFixed(5)),
      amount:           valor,
      currency:         'EUR',
      fees:             0,
      source_document:  `aforro_${subnum}`,
    });
  }

  return records;
}

// Current valuation from the statement header/RESUMO:
//   "Data do Extrato: 01-09-2025"  +  "TOTAL 6.450,39"
// This reflects accrued interest and is not derivable from the ledger.
function parseAforroValuation(text: string): {
  as_of_date: string; value: number; units: number | null;
} | null {
  const dateM = text.match(/Data do Extrato[:\s]*(\d{2})-(\d{2})-(\d{4})/i);
  if (!dateM) return null;
  const as_of_date = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;

  // First "TOTAL <value>" (RESUMO total) — value only, no units glued
  const flat = text.replace(/\s+/g, '');
  const totalM = flat.match(/TOTAL([\d.]+),(\d{2})/);
  if (!totalM) return null;
  const value = ptNum(`${totalM[1]},${totalM[2]}`);
  if (!value) return null;

  // Units from "Certificados de Aforro Série F <units> <value>" (best-effort)
  let units: number | null = null;
  const prodM = flat.match(/CertificadosdeAforroS[ée]rieF([\d.]+),(\d{2})/i);
  if (prodM) {
    const glued = prodM[1].replace(/\./g, '');          // units + value-int
    const valInt = String(Math.trunc(value));            // value integer part
    if (glued.endsWith(valInt)) {
      const u = parseInt(glued.slice(0, glued.length - valInt.length), 10);
      if (!isNaN(u)) units = u;
    }
  }

  return { as_of_date, value, units };
}

export async function POST(request: Request) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdf = await pdfParse(buffer);
    const records = parseAforroPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No subscriptions found. Check the file format.' }, { status: 422 });
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

    // Store the statement's current valuation (best-effort — don't fail import)
    const val = parseAforroValuation(pdf.text);
    if (val) {
      await supabase.from('valuations').upsert(
        {
          entity:          'Aforro',
          asset_name:      'Certificados de Aforro Série F',
          as_of_date:      val.as_of_date,
          units:           val.units,
          value:           val.value,
          currency:        'EUR',
          source_document: `aforro_val_${val.as_of_date}`,
        },
        { onConflict: 'entity,as_of_date' }
      );
    }

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
