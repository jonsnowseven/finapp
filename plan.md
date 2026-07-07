Project Blueprint: FinApp
Objective: Build a custom, 100% free, personalized financial portfolio monitoring application to track assets, including ETFs, crypto, savings accounts, and Portuguese-specific instruments (PPRs, Certificados de Aforro).

1. Architecture & Tech Stack
The application uses a Monorepo hybrid architecture to handle both the modern web interface and the heavy data extraction processes while keeping hosting costs at $0.

Frontend & UI: Next.js (React / TypeScript) with Tailwind CSS.
Design System: Custom Dark Mode (Black and Gold aesthetic) and Light Mode.
Authentication: Supabase Auth (Google Account OAuth).
Database: Supabase PostgreSQL (Free Tier).
Automated API Engine: Node.js / Serverless functions for Kraken (Crypto) and GoCardless/Nordigen (Revolut Open Banking).
Manual Data Engine (Local Loader): Python (pdfplumber, pandas) managed via uv for parsing local PDF statements without cloud memory limits.

2. Database Schema (Supabase)
The core relational structure to handle multi-asset tracking over time.

profiles: User profiles linked to authentication.

assets: Definitions of owned entities (e.g., VWCE, Certificados de Aforro Série F).

transactions: Granular ledger tracking.

Columns: id, created_at, date, entity (broker/institution), asset_name, transaction_type (buy/sell/deposit/interest/dividend), quantity, price, amount, currency, fees, source_document.

daily_balances: Snapshot table recording the aggregate value of the portfolio at specific timestamps for historical evolution charting.

3. Phased Implementation Plan
Phase 1: Database Architecture & Local Testing
Set up a free Supabase project and database instance.
Execute SQL schema to create the transactions table.
Set up the local Python environment using uv (PEP 723 inline dependencies).
Write a connection test script (database.py) using the service_role key to bypass RLS and securely push data to Supabase from the local machine.
Phase 2: Core Web Application (Next.js)
Scaffold the Next.js project using Tailwind CSS.
Configure the global ThemeProvider to support Light, Dark, and System modes.
Implement the custom Black & Gold UI theme.
Build the Global Navigation Bar and layout structures.
Build the Dashboard Overview, calculating total portfolio balance, tracked operations, and fees directly from the database.
Build the Transaction Ledger page with client-side filtering by entity and transaction_type.
Phase 3: External API Integrations (Automated)
Kraken Integration: Build a secure API connector to pull real-time crypto transactions using read-only API keys.
Revolut Integration: Connect to GoCardless Bank Account Data for a free Open Banking link to fetch balances and transactions.
Market Data: Integrate unofficial Yahoo Finance APIs to fetch daily closing prices for standard ETFs and stocks.

Phase 4: Python Data Engine & PDF Parsing (Manual)
Build the finapp-parser local ecosystem.

Write utils/formatters.py to standardize Portuguese financial formatting (converting 1.000,50 € to standard 1000.50 floats).

Develop specific extraction logic using Regex and pdfplumber for:

Certificados de Aforro (AforroNet)

Banco Invest (Alves Ribeiro PPR)

SGF PPR

Fidelidade MySavings

Develop quick CSV parsers for Degiro and Trade Republic native exports.
Phase 5: Authentication & Deployment
Configure Supabase to accept Google Account OAuth logins.
Wrap the Next.js application in an authentication guard to protect the dashboard and ledger routes.
Deploy the finapp-web folder to Vercel for free, continuous web hosting.
Transition from local service_role keys to authenticated session tokens for web-based data fetching.
