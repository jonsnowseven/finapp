import { NextRequest, NextResponse } from 'next/server';
import { fetchMultipleQuotes } from '../../../lib/marketdata';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols') ?? '';
  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'Provide at least one symbol via ?symbols=VWCE.DE,BTC-EUR' }, { status: 400 });
  }

  const fresh = searchParams.get('fresh') === '1';

  try {
    const quotes = await fetchMultipleQuotes(symbols, fresh);
    return NextResponse.json({ quotes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
