# FinApp

Personal investment portfolio tracker. Imports transactions from broker/bank
statements (PDF/CSV), stores them in Supabase, and shows balances + live/estimated
valuations per institution.

- **`finapp-web/`** — Next.js 14 app (dashboard, transaction ledger, statement importers).
- **`finapp-parser/`** — optional Python CLI to load statements from the command line.
- **`database/schema.sql`** — Postgres schema (run once in Supabase).

Supported imports: Kraken, DeGiro, Trade Republic, Banco Invest PPR, Golden SGF PPR,
Revolut Boosted, Certificados de Aforro.

---

## 1. Prerequisites

- **Node.js ≥ 18.18** (Next.js 14) and npm.
- A free **Supabase** account — <https://supabase.com>.
- A **Google** account (for OAuth login).
- *(optional)* **uv** + Python ≥ 3.10 for the CLI parser — <https://docs.astral.sh/uv/>.

---

## 2. Set up Supabase (database + auth)

1. Create a new project at <https://supabase.com/dashboard>.
2. **Database**: open *SQL Editor* → paste the contents of [`database/schema.sql`](database/schema.sql) → **Run**.
   This creates the `transactions` and `valuations` tables (RLS disabled, open via API).
3. **Auth → Providers → Google**: enable it. Create OAuth credentials in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (OAuth client → *Web application*), and:
   - **Authorized redirect URI** = the value Supabase shows under the Google provider
     (looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
   - Paste the Google **Client ID/Secret** back into Supabase.
4. **Auth → URL Configuration**:
   - *Site URL* = `http://localhost:3000` (for local dev).
   - *Redirect URLs* → add `http://localhost:3000/auth/callback`.
5. **Project Settings → API**: copy the **Project URL**, the **anon** key, and the
   **service_role** key (keep the service_role key secret).

---

## 3. Configure environment

Create `finapp-web/.env.local`:

```bash
# Supabase (from Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # server-only: imports, valuations, dev reset

# Access control — comma-separated allowlist of permitted emails
ALLOWED_EMAILS=you@example.com

# Optional: only needed for the live API connectors (/api/sync). PDF/CSV imports don't need these.
KRAKEN_API_KEY=
KRAKEN_API_SECRET=
NORDIGEN_SECRET_ID=
NORDIGEN_SECRET_KEY=
REVOLUT_ACCOUNT_ID=

# Optional: force a 3-month Euribor rate if the ECB endpoint is unreachable (Aforro valuation)
# EURIBOR_3M_RATE=2.2
```

> `.env.local` is git-ignored — never commit it.

---

## 4. Run locally

```bash
cd finapp-web
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with a Google account whose email is in
`ALLOWED_EMAILS`. Other emails get the access-denied page.

Then go to **Transactions → Import** and upload a statement (each option's tooltip
says where to export it). The dashboard shows balances and valuations per institution;
use **Refresh** to re-fetch live prices.

Production build locally:

```bash
npm run build && npm start
```

---

## 5. (Optional) CLI parser

Load statements from the terminal instead of the web UI. Reuses the same Supabase env.

```bash
cd finapp-parser
cp ../finapp-web/.env.local .env        # or create .env with the SUPABASE_* vars
uv run main.py --type aforro --file data/extrato.pdf
# types: aforro | sgf | fidelidade | bancoinvest | degiro | traderepublic | kraken
```

---

## 6. Deploy online (free)

Free tier: **Vercel** (web hosting) + **Supabase** (database/auth), both no-cost for personal use.

1. **Push to GitHub** (private repo recommended). Confirm `.env.local` is *not* committed.
2. **Import to Vercel** — <https://vercel.com/new>:
   - Select the repo.
   - **Root Directory** = `finapp-web`.
   - Framework preset auto-detects **Next.js**.
   - **Environment Variables**: add the same keys as `.env.local`
     (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_EMAILS`, and any optional ones).
   - **Deploy**. You get a URL like `https://your-app.vercel.app`.
3. **Point auth at the live URL** — back in Supabase **Auth → URL Configuration**:
   - *Site URL* = `https://your-app.vercel.app`.
   - *Redirect URLs* → add `https://your-app.vercel.app/auth/callback`
     (keep the localhost one too for local dev).
   - The Google *Authorized redirect URI* stays the Supabase `…/auth/v1/callback`
     (unchanged — Supabase brokers the OAuth).
4. Visit the Vercel URL and sign in. Done.

Notes:
- The **dev-only** buttons ("Clear DB", "Delete \<entity\>") are hidden in production
  (`NODE_ENV=production`) and their API routes return `403`.
- Vercel auto-redeploys on every push to the default branch.
- Free-tier Supabase projects pause after inactivity — the first request after a pause
  may be slow while it wakes.
