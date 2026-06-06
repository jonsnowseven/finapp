import { requireApiUser } from "../../../lib/api-auth";
import { NextRequest, NextResponse } from 'next/server';
import { valuateIsins } from '../../../lib/marketdata';

// GET /api/valuate?isins=US0378331005,NL0000235190[&fresh=1]
// Resolves each ISIN to a Yahoo ticker, quotes it, converts price to EUR.
export async function GET(request: NextRequest) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const { searchParams } = new URL(request.url);
  const isins = (searchParams.get('isins') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (isins.length === 0) {
    return NextResponse.json({ error: 'Provide at least one ISIN via ?isins=...' }, { status: 400 });
  }

  const fresh = searchParams.get('fresh') === '1';

  try {
    const results = await valuateIsins(isins, fresh);
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
