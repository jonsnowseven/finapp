import { requireApiUser } from "../../../lib/api-auth";
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  const { origin } = new URL(request.url);
  const results: Record<string, any> = {};

  const [krakenRes, revolutRes] = await Promise.allSettled([
    fetch(`${origin}/api/kraken`, { method: 'POST' }).then((r) => r.json()),
    fetch(`${origin}/api/revolut`, { method: 'POST' }).then((r) => r.json()),
  ]);

  results.kraken = krakenRes.status === 'fulfilled' ? krakenRes.value : { error: String(krakenRes.reason) };
  results.revolut = revolutRes.status === 'fulfilled' ? revolutRes.value : { error: String(revolutRes.reason) };

  return NextResponse.json({ message: 'Full sync complete', results });
}
