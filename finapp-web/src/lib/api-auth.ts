import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Defense-in-depth authorization for API routes (on top of middleware).
// Returns a NextResponse to short-circuit when the caller is not a logged-in,
// allow-listed user; returns null when the request may proceed.
//
// Fails CLOSED: an empty ALLOWED_EMAILS denies everyone. Set ALLOWED_EMAILS
// in every environment (local + Vercel) or all API calls return 403.
export async function requireApiUser(): Promise<NextResponse | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => { /* read-only here */ },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = user.email?.toLowerCase();
  if (ALLOWED_EMAILS.length === 0 || !email || !ALLOWED_EMAILS.includes(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
