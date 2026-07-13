import { requireApiUser } from "../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { fetchEuribor3M, fetchEuriborSeries, TENORS, type Tenor } from '../../../lib/euribor';

// Default (no params): { rate, period } for 3M — used by the dashboard's Aforro accrual.
// With ?tenor=6M[&freq=M|B][&n=12]: { tenor, freq, observations: [{period, rate}] }.
export async function GET(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const { searchParams } = new URL(request.url);
  const fresh = searchParams.get('fresh') === '1';
  const tenor = searchParams.get('tenor') as Tenor | null;
  try {
    if (!tenor) return NextResponse.json(await fetchEuribor3M(fresh));
    if (!TENORS.includes(tenor)) return NextResponse.json({ error: 'invalid tenor' }, { status: 400 });
    const freq = (searchParams.get('freq') === 'B' ? 'B' : 'M') as 'M' | 'B';
    const n = Math.min(400, Math.max(1, Number(searchParams.get('n')) || 1));
    const observations = await fetchEuriborSeries(tenor, freq, n, fresh);
    return NextResponse.json({ tenor, freq, observations });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
