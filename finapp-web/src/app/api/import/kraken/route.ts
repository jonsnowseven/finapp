import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ASSET_MAP: Record<string, string> = {
  BTC: 'Bitcoin', XBT: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  ADA: 'Cardano', DOT: 'Polkadot', MATIC: 'Polygon', LINK: 'Chainlink',
  AVAX: 'Avalanche', XRP: 'Ripple', LTC: 'Litecoin', ATOM: 'Cosmos',
  UNI: 'Uniswap', ALGO: 'Algorand',
};
const QUOTE_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'USDT', 'USDC']);

function parsePair(pair: string): { asset: string; currency: string } {
  pair = pair.trim().toUpperCase();
  const [base, quote] = pair.includes('/') ? pair.split('/') : [pair.slice(0, -3), pair.slice(-3)];
  return {
    asset: ASSET_MAP[base] ?? base,
    currency: QUOTE_CURRENCIES.has(quote) ? quote : 'EUR',
  };
}

// pdf-parse extracts this PDF column-by-column, not row-by-row.
// Strategy: split into named column sections, then zip them into rows.
function parseKrakenPdf(text: string) {
  const HEADERS = ['Unique ID', 'Time (UTC)', 'Pair', 'Type', 'Subtype', 'Price', 'Cost', 'Volume', 'Fee', 'Margin'];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const sections: Record<string, string[]> = {};
  let current = '';
  for (const line of lines) {
    if (HEADERS.includes(line)) { current = line; sections[current] = []; }
    else if (current && !line.startsWith('Page ')) sections[current].push(line);
  }

  const ids    = (sections['Unique ID'] ?? []).filter(l => /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/.test(l));
  const times  = sections['Time (UTC)'] ?? [];
  const pairs  = sections['Pair'] ?? [];
  const types  = sections['Type'] ?? [];
  const prices = sections['Price'] ?? [];
  const costs  = sections['Cost'] ?? [];
  const vols   = sections['Volume'] ?? [];
  const fees   = sections['Fee'] ?? [];

  // Time column alternates: HH:MM:SS then YYYY-MM-DD for each row
  const dates = times
    .filter(l => /^\d{4}-\d{2}-\d{2}$/.test(l));

  return ids.flatMap((txId, i) => {
    const date = dates[i] ?? '';
    if (!date) return [];
    const pair = pairs[i] ?? '';
    if (!pair) return [];
    const { asset, currency } = parsePair(pair);
    const type = (types[i] ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    const cost = parseFloat(costs[i] ?? '0');
    const vol  = parseFloat(vols[i]  ?? '0');
    const fee  = parseFloat(fees[i]  ?? '0');
    const price = parseFloat(prices[i] ?? '0');
    if (cost === 0 && vol === 0) return [];
    return [{
      date,
      entity: 'Kraken',
      asset_name: asset,
      transaction_type: type,
      quantity: vol || null,
      price: price || null,
      amount: cost,
      currency,
      fees: fee,
      source_document: `kraken_${txId}`,
    }];
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdf = await pdfParse(buffer);
    const records = parseKrakenPdf(pdf.text);

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
