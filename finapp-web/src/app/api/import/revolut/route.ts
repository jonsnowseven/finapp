import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Portuguese amount: "5 339,20" or "200,00" → number
function ptNum(s: string): number {
  return parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;
}

// DD/MM/YYYY → YYYY-MM-DD
function ptDate(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// Extracts the first Portuguese-formatted €-amount from a string
// Handles space thousands sep: "5 339,20€" or "200,00€"
function firstAmount(s: string): number {
  const m = s.match(/([\d][\d\s]*,\d{2})€/);
  return m ? ptNum(m[1]) : 0;
}

function parseRevolutBoostedPdf(text: string) {
  // Only parse the Savings section to avoid duplicates with the current account section
  const savingsMarker = 'Operações de Poupança de Acesso Imediato';
  const savingsIdx = text.indexOf(savingsMarker);
  const savingsText = savingsIdx >= 0 ? text.slice(savingsIdx) : text;

  const lines = savingsText.split('\n').map(l => l.trim()).filter(Boolean);
  const records: any[] = [];
  let rowIdx = 0;
  let lastDate = '';

  for (const line of lines) {
    // Dates are concatenated: "07/03/202607/03/2026Para EUR..."
    // Extract first DD/MM/YYYY occurrence
    const dateLead = line.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dateLead) lastDate = dateLead[1];

    const lower = line.toLowerCase();
    if (!lower.includes('boosted')) continue;

    // Skip header/summary/metadata lines
    if (/saldo|dinheiro retirado|dinheiro recebido|^poupanças criadas/i.test(line)) continue;
    if (/TANB|juros brutos|imposto retido/i.test(line)) continue;

    const date = ptDate(lastDate);
    if (!date) continue;

    let txType: string;

    // Use plain includes — \b fails on concatenated "2026Para"
    if (lower.includes('para eur boosted')) {
      txType = 'deposit';
    } else if (lower.includes('de eur boosted')) {
      txType = 'sell';
    } else if (lower.includes('pagamento de juros')) {
      txType = 'interest';
    } else {
      continue;
    }

    const amount = firstAmount(line);
    if (amount === 0) continue;

    const source = `revolut_boosted_${date}_${txType}_${amount}_${rowIdx}`;
    rowIdx++;

    records.push({
      date,
      entity:           'Revolut',
      asset_name:       'Revolut Boosted Account',
      transaction_type: txType,
      quantity:         null,
      price:            null,
      amount,
      currency:         'EUR',
      fees:             0,
      source_document:  source,
    });
  }

  return records;
}

// Current Boosted balance = "Saldo disponível final" of the "Poupança de Acesso
// Imediato" summary row (last €-amount before the Total line).
function parseRevolutValuation(text: string): { as_of_date: string; value: number } | null {
  const si = text.indexOf('Poupança de Acesso Imediato');
  if (si < 0) return null;
  const ti = text.indexOf('Total', si);
  const slice = ti > si ? text.slice(si, ti) : text.slice(si);

  // €-amounts (space/nbsp thousands), final balance = last one in the summary row
  const amts = slice.match(/\d[\d\s.]*,\d{2}(?=\s*€)/g);
  if (!amts?.length) return null;
  const value = ptNum(amts[amts.length - 1]);
  if (!value) return null;

  const dm = text.match(/Gerado a (\d{2})\/(\d{2})\/(\d{4})/);
  const as_of_date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : new Date().toISOString().slice(0, 10);
  return { as_of_date, value };
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
    const records = parseRevolutBoostedPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No Boosted Account transactions found. Make sure this is a Revolut EUR statement.' }, { status: 422 });
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

    // Store the current Boosted balance as a valuation (best-effort)
    const val = parseRevolutValuation(pdf.text);
    if (val) {
      await supabase.from('valuations').upsert(
        {
          entity:          'Revolut',
          asset_name:      'Boosted Account',
          as_of_date:      val.as_of_date,
          units:           null,
          value:           val.value,
          currency:        'EUR',
          source_document: `revolut_val_${val.as_of_date}`,
        },
        { onConflict: 'entity,as_of_date' }
      );
    }

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
