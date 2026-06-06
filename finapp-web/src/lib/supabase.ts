import { createBrowserClient } from '@supabase/ssr';

// Session-aware browser client. Carries the logged-in user's JWT, so reads run
// as the `authenticated` role (not `anon`). Required once RLS is enabled and the
// `anon` role is revoked — see database/schema.sql.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
