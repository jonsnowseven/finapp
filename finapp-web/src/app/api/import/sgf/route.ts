import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function ptNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseSgfPdf(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Receipt number → dedup key
  const receiptMatch = text.match(/Recibo\s+n[ºo°]?\s*(\d+)/i);
  if (!receiptMatch) return [];
  const receiptNum = receiptMatch[1];

  // Date: "Data Efeito: 05/05/2026"
  const dateMatch = text.match(/Data Efeito[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!dateMatch) return [];
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

  // Amount: label and value may be on separate lines — scan up to 5 lines after label
  let amount = 0;
  const montanteIdx = lines.findIndex(l => /subscri[çc][aã]o\s+l[íi]quida/i.test(l));
  if (montanteIdx >= 0) {
    for (let i = montanteIdx; i < Math.min(montanteIdx + 6, lines.length); i++) {
      const m = lines[i].match(/(\d[\d.]*,\d{2})/);
      if (m) { const v = ptNum(m[1]); if (v > 0) { amount = v; break; } }
    }
  }

  // Fund name: only capture alpha chars after "PPR SGF" — avoids grabbing concatenated numbers
  const fundMatch = text.match(/PPR SGF\s+([A-Za-zÀ-úà-ú]+)/i);
  const assetName = fundMatch ? `PPR SGF ${fundMatch[1]}` : 'PPR SGF';

  // Price/Qty: 5-decimal numbers, but only from the subscription table —
  // truncate at "Repartição do Património" to exclude accumulated totals
  const cutoff = text.indexOf('Repartição do Património');
  const subText = cutoff > 0 ? text.slice(0, cutoff) : text;
  const fiveDecNums: number[] = [];
  const re5 = /(\d+,\d{5})/g;
  let m5: RegExpExecArray | null;
  while ((m5 = re5.exec(subText)) !== null) fiveDecNums.push(ptNum(m5[1]));

  const price = fiveDecNums[0] ?? null;
  const qty   = fiveDecNums[1] ?? null;

  return [{
    date,
    entity:           'SGF',
    asset_name:       assetName,
    transaction_type: 'buy',
    quantity:         qty,
    price,
    amount:           amount || (qty && price ? parseFloat((qty * price).toFixed(2)) : 0),
    currency:         'EUR',
    fees:             0,
    source_document:  `sgf_${receiptNum}`,
  }];
}

// Current valuation from the "Repartição do Património em: DD/MM/YYYY" section:
//   Total line "... 1.705,98" (Valor Acumulado) and units (5-decimal, e.g. 229,47031).
function parseSgfValuation(text: string): { as_of_date: string; value: number; units: number | null } | null {
  const pi = text.search(/Reparti[çc][ãa]o do Patrim[óo]nio/i);
  const sub = pi >= 0 ? text.slice(pi) : text;

  // Date — from the Património header, else fall back to Data Efeito
  const dm = sub.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    ?? text.match(/Data Efeito[:\s]*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!dm) return null;
  const as_of_date = `${dm[3]}-${dm[2]}-${dm[1]}`;

  // Valor Acumulado = last 2-decimal amount in the section (the Total)
  const amounts = sub.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? [];
  if (!amounts.length) return null;
  const value = ptNum(amounts[amounts.length - 1]);
  if (!value) return null;

  // Units = largest 5-decimal number (Nº U.P.'s Acumulado, not the UP price)
  const fiveDec = (sub.match(/\d{1,3}(?:\.\d{3})*,\d{5}/g) ?? []).map(ptNum);
  const units = fiveDec.length ? Math.max(...fiveDec) : null;

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
    const records = parseSgfPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'Could not parse receipt. Check the file.' }, { status: 422 });
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

    // Store the receipt's accumulated valuation (best-effort)
    const val = parseSgfValuation(pdf.text);
    if (val) {
      await supabase.from('valuations').upsert(
        {
          entity:          'SGF',
          asset_name:      'PPR SGF Stoik',
          as_of_date:      val.as_of_date,
          units:           val.units,
          value:           val.value,
          currency:        'EUR',
          source_document: `sgf_val_${val.as_of_date}`,
        },
        { onConflict: 'entity,as_of_date' }
      );
    }

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
