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

-- Disable Row Level Security (RLS) so the table is openly accessible via API
alter table transactions disable row level security;

-- Explicitly grant all permissions to your API roles
grant select, insert, update, delete on public.transactions to anon, authenticated, service_role;

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

alter table valuations disable row level security;
grant select, insert, update, delete on public.valuations to anon, authenticated, service_role;
