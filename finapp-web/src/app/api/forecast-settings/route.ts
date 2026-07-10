import { requireApiUser } from '../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Persist forecast inputs (single shared row). Body may contain any of
// { profile, fire, mortgage }; only the provided keys are updated.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const b = await request.json();
    const payload: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
    if (b?.profile !== undefined) payload.profile = b.profile;
    if (b?.fire !== undefined) payload.fire = b.fire;
    if (b?.mortgage !== undefined) payload.mortgage = b.mortgage;
    if (b?.rows !== undefined) payload.rows = b.rows;
    const { error } = await db().from('forecast_settings').upsert(payload, { onConflict: 'id' });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
