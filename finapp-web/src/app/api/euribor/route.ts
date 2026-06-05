import { NextResponse } from 'next/server';
import { fetchEuribor3M } from '../../../lib/euribor';

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  try {
    const data = await fetchEuribor3M(fresh);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
