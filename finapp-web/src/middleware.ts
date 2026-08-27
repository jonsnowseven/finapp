import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Comma-separated list of allowed emails in .env.local:
//   ALLOWED_EMAILS="you@gmail.com,partner@gmail.com"
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAllowed(email: string | undefined): boolean {
  if (!email) return false;
  // Fail CLOSED: an empty allowlist denies everyone. Set ALLOWED_EMAILS in every env.
  return ALLOWED_EMAILS.length > 0 && ALLOWED_EMAILS.includes(email.toLowerCase());
}

// Bounds every Supabase call this middleware makes so a slow/unreachable auth
// server fails fast instead of hanging past Vercel's ~25s middleware timeout
// (which kills the whole function and serves the visitor a raw 504).
function fetchWithTimeout(timeoutMs: number) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
  };
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout(8000) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Fail CLOSED on a timed-out/failed auth check too (same posture as
  // isAllowed below) — treat as unauthenticated rather than hang.
  let user;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    user = null;
  }

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api');
  const isPublicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/unauthorized') ||
    pathname.startsWith('/api/cron');   // self-authenticates via CRON_SECRET

  if (!user && !isPublicPath) {
    // API → JSON 401; pages → redirect to login
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  if (user && !isAllowed(user.email) && !isPublicPath) {
    // API → JSON 403 (no sign-out); pages → sign out and show the unauthorized page
    if (isApi) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/unauthorized';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
