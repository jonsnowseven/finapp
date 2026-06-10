-- Drop the existing table to start fresh
drop table if exists transactions;

-- Recreate with the new 'entity' field
create table transactions (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  date date not null,
  entity text not null, -- NEW FIELD: e.g., 'Degiro', 'AforroNet', 'SGF'
  asset_name text not null, 
  transaction_type text not null, 
  quantity numeric, 
  price numeric, 
  amount numeric not null, 
  currency text default 'EUR' not null,
  fees numeric default 0,
  source_document text,
  CONSTRAINT transactions_source_document_key UNIQUE (source_document)
);

-- SECURITY: Row Level Security ON. The anon key ships in the browser bundle, so
-- the DB must not be open to `anon`. Logged-in users (authenticated role) may read;
-- all writes go through API routes using the service_role key (bypasses RLS).
alter table transactions enable row level security;

-- Reads: any authenticated (logged-in) user. (App-level email allowlist is enforced
-- in middleware + API routes.) No insert/update/delete policy → only service_role writes.
drop policy if exists "authenticated read transactions" on public.transactions;
create policy "authenticated read transactions"
  on public.transactions for select to authenticated using (true);

-- Revoke the public/anon access granted by older versions of this schema.
revoke all on public.transactions from anon;
grant select on public.transactions to authenticated;
grant all on public.transactions to service_role;

-- Point-in-time portfolio valuations (e.g. Aforro statement TOTAL, which grows
-- with interest and is not derivable from the transaction ledger).
create table if not exists valuations (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  entity text not null,
  asset_name text,
  as_of_date date not null,
  units numeric,
  value numeric not null,
  currency text default 'EUR' not null,
  source_document text,
  -- one valuation per entity per statement date; re-import overwrites
  CONSTRAINT valuations_entity_date_key UNIQUE (entity, as_of_date)
);

-- LEGO investments (sets held for appreciation). One row per set number.
create table if not exists lego_sets (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  set_no text not null,
  name text not null,
  theme text,
  retail numeric,
  paid numeric,
  value numeric,
  qty_new integer default 0,
  qty_used integer default 0,
  growth_pct numeric,
  annual_pct numeric,            -- forecast appreciation override (null → theme default)
  source_document text,
  constraint lego_sets_set_no_key unique (set_no)
);
alter table lego_sets enable row level security;
drop policy if exists "authenticated read lego_sets" on public.lego_sets;
create policy "authenticated read lego_sets"
  on public.lego_sets for select to authenticated using (true);
revoke all on public.lego_sets from anon;
grant select on public.lego_sets to authenticated;
grant all on public.lego_sets to service_role;

alter table valuations enable row level security;
drop policy if exists "authenticated read valuations" on public.valuations;
create policy "authenticated read valuations"
  on public.valuations for select to authenticated using (true);
revoke all on public.valuations from anon;
grant select on public.valuations to authenticated;
grant all on public.valuations to service_role;
