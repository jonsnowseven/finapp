import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Minimal RFC 4180 CSV parser
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

const TYPE_MAP: Record<string, string> = {
  BUY: 'buy',
  SELL: 'sell',
  DIVIDEND: 'dividend',
  INTEREST_PAYMENT: 'interest',
  SAVINGS_PLAN: 'buy',
};

function mapType(raw: string): string {
  return TYPE_MAP[raw.toUpperCase()] ?? 'buy';
}

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const rows = parseCsv(text);

    // Only import asset transactions (TRADING category or non-empty symbol)
    const assetRows = rows.filter(r =>
      r.category === 'TRADING' && r.symbol && r.symbol.trim() !== ''
    );

    if (assetRows.length === 0) {
      return NextResponse.json({ error: 'No asset transactions found. Only TRADING rows with a symbol are imported.' }, { status: 422 });
    }

    const records = assetRows.map(r => {
      const amount  = Math.abs(parseFloat(r.amount)  || 0);
      const fee     = Math.abs(parseFloat(r.fee)     || 0);
      const qty     = Math.abs(parseFloat(r.shares)  || 0);
      const price   = Math.abs(parseFloat(r.price)   || 0);

      return {
        date:             r.date,
        entity:           'Trade Republic',
        asset_name:       r.name || r.symbol,
        isin:             r.symbol || null,   // TR CSV "symbol" column holds the ISIN
        transaction_type: mapType(r.type),
        quantity:         qty || null,
        price:            price || null,
        amount,
        currency:         r.currency || 'EUR',
        fees:             fee,
        source_document:  `tr_${r.transaction_id}`,
      };
    });

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
