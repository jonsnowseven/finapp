'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityHex, typeSign, cryptoSymbol, TR_EUR_SYMBOL, defaultReturn, defaultTer, defaultTax, DEFAULT_MONTHLY_BUY } from '../lib/entities';
import { xirr, type CashFlow } from '../lib/finance';
import { summarizeExpenses, type ExpenseRow } from '../lib/expenses';
import { useHideBalance } from '../lib/useHideBalance';
import { useCountUp } from '../lib/useCountUp';
import { useInView } from '../lib/useInView';
import { useBrandColor } from '../lib/useBrandColor';
import AllocationPie from '../components/AllocationPie';
import NetWorthChart from '../components/NetWorthChart';
import Card from '../components/Card';
import Tooltip from '../components/Tooltip';
import { reportError } from '../lib/devError';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { RefreshCw, Eye, EyeOff } from 'lucide-react';

interface EntityBalance {
  entity: string;
  balance: number;
  count: number;
  valuation?: number;     // current market value (if a statement valuation exists)
  valuationDate?: string;
  info?: string;          // how the valuation was calculated (tooltip)
}

export default function HomePage() {
  const [metrics, setMetrics] = useState({ totalValue: 0, transactionCount: 0, totalFees: 0 });
  const [entityBalances, setEntityBalances] = useState<EntityBalance[]>([]);
  const [xirrRate, setXirrRate] = useState<number | null>(null);
  const [snapshots, setSnapshots] = useState<{ as_of: string; total: number }[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const isDev = process.env.NODE_ENV !== 'production';

  const fmt = (n: number) =>
    `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Shared hide-balance state (synced with the Navbar toggle and other tabs).
  const { hidden: hideBalance, toggle: toggleHide, money } = useHideBalance();

  const brand = useBrandColor('500');
  const animatedTotal = useCountUp(metrics.totalValue);
  const animatedFees = useCountUp(metrics.totalFees);
  const animatedOps = useCountUp(metrics.transactionCount);
  const animatedXirr = useCountUp(xirrRate == null ? 0 : xirrRate * 100, { decimals: 1 });
  const { ref: chartsRef, inView: chartsInView } = useInView<HTMLDivElement>();
  const { ref: entitiesRef, inView: entitiesInView } = useInView<HTMLDivElement>();

  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // PII-free Markdown summary (institutions + product themes only; no names,
  // accounts, IBANs or emails) to paste into an AI assistant. Goals come from the
  // Forecast page's locally-saved inputs; the AI can do the projections itself.
  function buildReport(): string {
    const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
    const profile = read('finapp_profile'), fireP = read('finapp_fire'), mort = read('finapp_mortgage');

    const monthlyNet = profile.salaryPeriod === 'year' ? (profile.netSalary || 0) / 12 : (profile.netSalary || 0);
    const monthlyInvested = entityBalances.reduce((a, b) => a + (DEFAULT_MONTHLY_BUY[b.entity] ?? 0), 0);
    const rate = monthlyNet > 0 ? (monthlyInvested / monthlyNet) * 100 : null;
    const age = profile.birthDate ? Math.floor((Date.now() - new Date(profile.birthDate).getTime()) / (365.25 * 864e5)) : null;
    const totalInvested = entityBalances.reduce((a, b) => a + b.balance, 0);

    const L: string[] = [];
    L.push('# Investment Portfolio Summary');
    L.push(`_Generated ${new Date().toISOString().slice(0, 10)} · figures in EUR · no personal identifiers._`);
    L.push('', '## Profile');
    if (age != null && !isNaN(age)) L.push(`- Age: ~${age}`);
    if (monthlyNet > 0) L.push(`- Net salary: ${fmt(monthlyNet)}/month`);
    L.push(`- Monthly invested (recurring): ${fmt(monthlyInvested)}${rate != null ? ` (${rate.toFixed(1)}% of net salary)` : ''}`);
    L.push('', '## Holdings (current value)');
    L.push('| Institution | Current value | Invested | Assumed return% | TER% | Tax% |');
    L.push('|---|--:|--:|--:|--:|--:|');
    for (const b of entityBalances) {
      const value = b.valuation ?? b.balance;
      L.push(`| ${b.entity} | ${fmt(value)} | ${fmt(b.balance)} | ${defaultReturn(b.entity)} | ${defaultTer(b.entity)} | ${defaultTax(b.entity)} |`);
    }
    L.push('');
    L.push(`- Total portfolio value: ${fmt(metrics.totalValue)}`);
    L.push(`- Total invested (cost basis): ${fmt(totalInvested)}`);
    L.push(`- Total fees paid: ${fmt(metrics.totalFees)}`);
    if (fireP.amount > 0) {
      const annual = fireP.period === 'year' ? fireP.amount : fireP.amount * 12;
      const swr = (fireP.swr || 4) / 100;
      L.push('', '## FIRE');
      L.push(`- Annual expenses: ${fmt(annual)}`);
      if (swr > 0) L.push(`- FIRE number (${(1 / swr).toFixed(0)}×): ${fmt(annual / swr)}`);
      L.push(`- Withdrawal rate: ${fireP.swr ?? 4}% · Inflation: ${fireP.inflation ?? 2}% · Retire in: ${fireP.retYears ?? 30}y`);
    }
    if (mort.balance > 0) {
      L.push('', '## Mortgage (Crédito Habitação)');
      L.push(`- Outstanding: ${fmt(mort.balance)} · Rate: ${mort.annualPct}% · Payment: ${fmt(mort.payment)}/month`);
    }
    const liquid = entityBalances
      .filter((b) => b.entity === 'Aforro' || b.entity === 'Revolut')
      .reduce((a, b) => a + (b.valuation ?? b.balance), 0);
    const ex = summarizeExpenses(expenseRows, { liquidSavings: liquid });
    if (ex) {
      L.push('', `## Cashflow (avg over last ${ex.months} full month${ex.months > 1 ? 's' : ''}, from imported statements)`);
      L.push(`- Avg monthly expenses: ${fmt(ex.avgMonthlyExpenses)}`);
      L.push(`- Avg monthly income: ${fmt(ex.avgMonthlyIncome)}`);
      if (ex.savingsRate != null) L.push(`- Savings rate: ${(ex.savingsRate * 100).toFixed(1)}%`);
      if (ex.fixedPct != null) L.push(`- Fixed vs discretionary: ${(ex.fixedPct * 100).toFixed(0)}% fixed / ${((ex.discretionaryPct ?? 0) * 100).toFixed(0)}% discretionary`);
      if (ex.runwayMonths != null) L.push(`- Emergency runway (liquid savings ÷ monthly expenses): ${ex.runwayMonths.toFixed(1)} months`);
      if (ex.trendPct != null) L.push(`- Expense trend (recent 3mo vs prior 3mo): ${ex.trendPct >= 0 ? '+' : ''}${(ex.trendPct * 100).toFixed(1)}%`);
      const top = ex.categories.slice(0, 6);
      if (top.length) {
        L.push('- Top spend categories (share of spend):');
        for (const c of top) L.push(`  - ${c.label}: ${(c.pct * 100).toFixed(0)}% (${fmt(c.avg)}/mo)`);
      }
      if (ex.incomeCategories.length) {
        L.push('- Income by source (avg/mo):');
        for (const c of ex.incomeCategories) L.push(`  - ${c.label}: ${fmt(c.avg)}/mo`);
      }
      if (ex.movements.length) {
        L.push('- Movements excluded from spend/income (avg/mo, + in / − out):');
        for (const m of ex.movements) L.push(`  - ${m.label}: ${m.avgMonthly >= 0 ? '+' : '−'}${fmt(Math.abs(m.avgMonthly))}/mo`);
      }
    }

    L.push('', '## Goals', '- Buy / pay off a home; reach financial independence (FIRE).');
    L.push('', '## Request');
    L.push('Analyse this portfolio against my income and goals. Give specific, prioritised ' +
      'recommendations on allocation & diversification, fees (TER) and taxes, the ' +
      'mortgage-vs-invest trade-off, savings rate, and progress toward the FIRE number. ' +
      'You may project growth using the assumed returns. Flag risks and quick wins. ' +
      'This is general information, not regulated advice.');
    return L.join('\n');
  }

  function copyReport() {
    if (!report) return;
    navigator.clipboard?.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  function downloadReport() {
    if (!report) return;
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'portfolio-report.md'; a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchDashboardData(fresh = false) {
    const q = fresh ? '?fresh=1' : '';
    const { data, error } = await supabase.from('transactions').select('*');
    if (error) reportError('dashboard: transactions load', error);
    if (!error && data) {
      const fees = data.reduce((acc, curr) => acc + Number(curr.fees || 0), 0);

      // Net contributed/invested balance per entity:
      // buy/deposit/interest/dividend add, sell subtracts.
      const byEntity: Record<string, EntityBalance> = {};
      for (const tx of data) {
        const e = tx.entity;
        if (!byEntity[e]) byEntity[e] = { entity: e, balance: 0, count: 0 };
        byEntity[e].balance += typeSign(tx.transaction_type) * Number(tx.amount);
        byEntity[e].count += 1;
      }

      // Overlay latest statement valuations (e.g. Aforro w/ accrued interest).
      // Gracefully ignored if the valuations table doesn't exist yet.
      const { data: vals } = await supabase
        .from('valuations')
        .select('*')
        .order('as_of_date', { ascending: true });
      if (vals) {
        for (const v of vals) {
          if (!byEntity[v.entity]) byEntity[v.entity] = { entity: v.entity, balance: 0, count: 0 };
          // ascending order → last write wins = most recent valuation
          byEntity[v.entity].valuation = Number(v.value);
          byEntity[v.entity].valuationDate = v.as_of_date;
        }
      }

      // Live(ish) valuation for Aforro: accrue the last statement TOTAL forward to
      // today at the current Euribor-3M-derived rate. The unit value is path-dependent
      // cumulative interest, so this is an estimate between statements (statement = truth).
      const aforro = byEntity['Aforro'];
      if (aforro?.valuation && aforro.valuationDate) {
        const stmtValue = aforro.valuation;
        const stmtDate = aforro.valuationDate;
        try {
          const res = await fetch(`/api/euribor${q}`);
          const j = await res.json();
          const eur = Number(j.rate); // percent
          if (isFinite(eur)) {
            // Série F: Euribor 3M + 1.00% spread, capped at 2.50% gross.
            // (Permanence premium omitted — slight underestimate.)
            const uncapped = eur + 1.0;
            const annualPct = Math.min(uncapped, 2.5);
            const annual = annualPct / 100;
            const start = new Date(stmtDate).getTime();
            const days = Math.max(0, (Date.now() - start) / 86_400_000);
            aforro.valuation = stmtValue * (1 + annual * days / 365);
            aforro.valuationDate = `est. · Euribor3M ${eur.toFixed(3)}%`;
            aforro.info =
              `ESTIMATE — Certificados de Aforro Série F.\n\n` +
              `Base: last statement TOTAL of ${fmt(stmtValue)} on ${stmtDate}, ` +
              `grown to today over ~${Math.round(days)} days.\n\n` +
              `Rate: Euribor 3M (${eur.toFixed(3)}%) + 1.00% spread = ${uncapped.toFixed(3)}%, ` +
              `capped at 2.50% gross → applied ${annualPct.toFixed(3)}%` +
              `${uncapped > 2.5 ? ' (CAP active)' : ''}.\n\n` +
              `Permanence premium: Série F adds a premium that grows the longer you hold ` +
              `(from the 2nd year onward). It is NOT included here, so the figure is slightly ` +
              `conservative.\n\n` +
              `Method: real interest resets monthly and capitalises quarterly; this uses simple ` +
              `daily accrual at the current rate as an approximation. Re-import a newer statement ` +
              `for an exact base.`;
          }
        } catch {
          // Euribor unavailable — keep the raw statement valuation
        }
      }

      // Live(ish) valuation for Revolut Boosted: accrue the statement balance
      // forward at 2.50%/yr (TANB), interest credited daily.
      const rev = byEntity['Revolut'];
      if (rev?.valuation && rev.valuationDate) {
        const base = rev.valuation;
        const baseDate = rev.valuationDate;
        // 2.50% gross TANB, less 28% PT withholding tax → 1.80% net.
        const annual = 0.025 * (1 - 0.28);
        const start = new Date(baseDate).getTime();
        const days = Math.max(0, (Date.now() - start) / 86_400_000);
        rev.valuation = base * (1 + annual * days / 365);
        rev.valuationDate = 'est. · 1.8% net/yr';
        rev.info =
          `ESTIMATE — Revolut Boosted (Poupança de Acesso Imediato).\n\n` +
          `Base: statement balance ${fmt(base)} on ${baseDate}, accrued ~${Math.round(days)} ` +
          `days at 1.80%/yr NET (2.50% gross TANB − 28% PT withholding tax), daily crediting.\n\n` +
          `Re-import a newer statement for an exact base.`;
      }

      // Live valuation for Kraken: net crypto holdings × current EUR price.
      const krakenHoldings: Record<string, number> = {};
      for (const tx of data) {
        if (tx.entity !== 'Kraken' || !tx.quantity) continue;
        krakenHoldings[tx.asset_name] =
          (krakenHoldings[tx.asset_name] ?? 0) + typeSign(tx.transaction_type) * Number(tx.quantity);
      }
      const heldAssets = Object.entries(krakenHoldings).filter(([, units]) => units > 1e-9);
      if (heldAssets.length) {
        try {
          const symbolMap = heldAssets.map(([asset]) => ({ asset, symbol: cryptoSymbol(asset) }));
          const res = await fetch(`/api/marketdata?symbols=${symbolMap.map(s => s.symbol).join(',')}${fresh ? '&fresh=1' : ''}`);
          const json = await res.json();
          const priceBySymbol: Record<string, number> = {};
          for (const q of json.quotes ?? []) priceBySymbol[q.symbol] = Number(q.price);

          let krakenValue = 0;
          for (const { asset, symbol } of symbolMap) {
            const price = priceBySymbol[symbol];
            if (price) krakenValue += krakenHoldings[asset] * price;
          }
          if (krakenValue > 0) {
            if (!byEntity['Kraken']) byEntity['Kraken'] = { entity: 'Kraken', balance: 0, count: 0 };
            byEntity['Kraken'].valuation = krakenValue;
            byEntity['Kraken'].valuationDate = 'live';
            const holdingsStr = symbolMap
              .filter(({ asset }) => krakenHoldings[asset] > 1e-9)
              .map(({ asset, symbol }) => `${asset}: ${krakenHoldings[asset].toFixed(6)} × ${priceBySymbol[symbol] ? fmt(priceBySymbol[symbol]) : 'n/a'}`)
              .join('\n');
            byEntity['Kraken'].info =
              `LIVE — crypto holdings valued at current market price.\n\n` +
              `Holdings = buys − sells per coin, from imported Kraken trades only ` +
              `(transfers/staking outside the trade history are not counted).\n\n` +
              `Prices: Yahoo Finance EUR pairs (e.g. BTC-EUR). Coins without an EUR quote are skipped.\n\n` +
              `${holdingsStr}\n\n` +
              `Updates on each Refresh.`;
          }
        } catch {
          // market data unavailable — fall back to net invested
        }
      }

      // Live valuation for Trade Republic: net ETF holdings × current EUR price.
      const trHoldings: Record<string, number> = {};
      for (const tx of data) {
        if (tx.entity !== 'Trade Republic' || !tx.quantity) continue;
        trHoldings[tx.asset_name] =
          (trHoldings[tx.asset_name] ?? 0) + typeSign(tx.transaction_type) * Number(tx.quantity);
      }
      const trHeld = Object.entries(trHoldings).filter(([, u]) => u > 1e-9);
      if (trHeld.length) {
        try {
          // Only assets with a known Yahoo ticker can be priced
          const mapped = trHeld
            .map(([asset]) => ({ asset, symbol: TR_EUR_SYMBOL[asset] }))
            .filter((m): m is { asset: string; symbol: string } => !!m.symbol);
          const unmapped = trHeld.filter(([asset]) => !TR_EUR_SYMBOL[asset]).map(([a]) => a);

          let trValue = 0;
          const lines: string[] = [];
          if (mapped.length) {
            const res = await fetch(`/api/marketdata?symbols=${mapped.map(s => s.symbol).join(',')}${fresh ? '&fresh=1' : ''}`);
            const json = await res.json();
            const bySymbol: Record<string, { price: number; currency: string }> = {};
            for (const q of json.quotes ?? []) bySymbol[q.symbol] = { price: Number(q.price), currency: q.currency };

            for (const { asset, symbol } of mapped) {
              const q = bySymbol[symbol];
              if (q && q.currency === 'EUR') {
                trValue += trHoldings[asset] * q.price;
                lines.push(`${asset}: ${trHoldings[asset].toFixed(4)} × ${fmt(q.price)} (${symbol})`);
              } else {
                lines.push(`${asset}: skipped (${q ? `${q.currency} quote` : 'no quote'}, ${symbol})`);
              }
            }
          }
          for (const a of unmapped) lines.push(`${a}: skipped (no ticker mapping)`);

          if (trValue > 0) {
            if (!byEntity['Trade Republic']) byEntity['Trade Republic'] = { entity: 'Trade Republic', balance: 0, count: 0 };
            byEntity['Trade Republic'].valuation = trValue;
            byEntity['Trade Republic'].valuationDate = 'live';
            byEntity['Trade Republic'].info =
              `LIVE — ETF holdings valued at current market price.\n\n` +
              `Holdings = buys − sells per fund, from imported Trade Republic transactions.\n\n` +
              `Prices: Yahoo Finance EUR-quoted listings (Xetra/Euronext) of each ISIN. ` +
              `Only EUR quotes are counted; non-EUR or unmapped funds are skipped.\n\n` +
              `${lines.join('\n')}\n\n` +
              `Tickers are a best-effort map — verify them in src/lib/entities.ts. ` +
              `Updates on each Refresh.`;
          }
        } catch {
          // market data unavailable — fall back to net invested
        }
      }

      // Trade Republic cash-at-interest (statement ending balance) — tracked as its
      // own line like Revolut Boosted, and accrued forward at the live Euribor rate
      // (net of 28% PT withholding) so the Overview stays up to date between statements.
      const trCashEntity = byEntity['Trade Republic Cash'];
      if (trCashEntity?.valuation && trCashEntity.valuationDate) {
        const base = trCashEntity.valuation;
        const baseDate = trCashEntity.valuationDate;
        const days = Math.max(0, (Date.now() - new Date(baseDate).getTime()) / 86_400_000);

        // Ledger movements dated AFTER the statement snapshot (e.g. a manual
        // withdrawal to fund a trade) aren't in `base` yet — apply them on top so
        // the estimate doesn't silently ignore activity until the next import.
        const postBaseDelta = data
          .filter((tx) => tx.entity === 'Trade Republic Cash' && tx.date > baseDate)
          .reduce((sum, tx) => sum + typeSign(tx.transaction_type) * Number(tx.amount), 0);

        let eur = NaN;
        try { const r = await fetch(`/api/euribor${q}`); eur = Number((await r.json()).rate); } catch { /* keep raw */ }
        if (isFinite(eur)) {
          const net = eur * (1 - 0.28);           // 28% PT withholding on interest
          trCashEntity.valuation = base * (1 + (net / 100) * days / 365) + postBaseDelta;
          trCashEntity.valuationDate = `est. · Euribor3M ${eur.toFixed(3)}% net`;
          trCashEntity.info =
            `Trade Republic cash at interest — checking-account balance (escrow + money-market fund).\n\n` +
            `Base: statement balance ${fmt(base)} on ${baseDate}, accrued ~${Math.round(days)} days at ` +
            `${net.toFixed(2)}%/yr NET (Euribor 3M ${eur.toFixed(3)}% − 28% PT tax)` +
            (postBaseDelta ? `, plus ${fmt(postBaseDelta)} in ledger activity recorded since the statement.` : '.') +
            `\n\nImport a newer statement PDF to reset the base.`;
        } else {
          trCashEntity.valuation = base + postBaseDelta;
          trCashEntity.info =
            `Trade Republic cash at interest — statement balance ${fmt(base)} on ${baseDate}` +
            (postBaseDelta ? `, plus ${fmt(postBaseDelta)} in ledger activity recorded since.` : '.') +
            ` Euribor unavailable, showing the raw balance. Import a newer statement PDF to update.`;
        }
      }

      // Live valuation for DeGiro: net holdings × current price, auto-resolved by ISIN.
      // ISIN is embedded in source_document: "degiro_web_<ISIN>_<date>_<time>_<idx>".
      const dgHoldings: Record<string, number> = {};   // isin -> units
      const dgName: Record<string, string> = {};        // isin -> product name
      for (const tx of data) {
        if (tx.entity !== 'DeGiro' || !tx.quantity) continue;
        const m = String(tx.source_document ?? '').match(/^degiro_web_([A-Z0-9]{12})_/);
        if (!m) continue;
        const isin = m[1];
        dgHoldings[isin] = (dgHoldings[isin] ?? 0) + typeSign(tx.transaction_type) * Number(tx.quantity);
        dgName[isin] = tx.asset_name;
      }
      const dgHeld = Object.entries(dgHoldings).filter(([, u]) => u > 1e-9);
      if (dgHeld.length) {
        try {
          const isins = dgHeld.map(([isin]) => isin);
          const res = await fetch(`/api/valuate?isins=${isins.join(',')}${fresh ? '&fresh=1' : ''}`);
          const json = await res.json();
          const byIsin: Record<string, any> = {};
          for (const r of json.results ?? []) byIsin[r.isin] = r;

          let dgValue = 0;
          const lines: string[] = [];
          for (const [isin, units] of dgHeld) {
            const r = byIsin[isin];
            const name = dgName[isin] ?? isin;
            if (r && r.priceEur > 0) {
              dgValue += units * r.priceEur;
              const conv = r.currency === 'EUR' ? '' : ` ${r.currency}→EUR`;
              lines.push(`${name}: ${units} × ${fmt(r.priceEur)} (${r.symbol}${conv})`);
            } else {
              lines.push(`${name}: unpriced (ISIN ${isin})`);
            }
          }

          if (dgValue > 0) {
            if (!byEntity['DeGiro']) byEntity['DeGiro'] = { entity: 'DeGiro', balance: 0, count: 0 };
            byEntity['DeGiro'].valuation = dgValue;
            byEntity['DeGiro'].valuationDate = 'live';
            byEntity['DeGiro'].info =
              `LIVE — holdings valued at current market price.\n\n` +
              `Holdings = buys − sells per position, from imported DeGiro transactions.\n\n` +
              `Each ISIN is auto-resolved to a Yahoo ticker; non-EUR prices are converted ` +
              `to EUR at the current FX rate. Positions that can't be resolved are unpriced.\n\n` +
              `${lines.join('\n')}\n\n` +
              `Updates on each Refresh.`;
          }
        } catch {
          // market data unavailable — fall back to net invested
        }
      }

      // LEGO investments (separate table): current value as valuation, paid as invested.
      const { data: lego, error: legoError } = await supabase.from('lego_sets').select('paid, value');
      if (legoError) reportError('dashboard: lego_sets load', legoError);
      if (lego && lego.length) {
        const paid = lego.reduce((a, r) => a + Number(r.paid ?? 0), 0);
        const value = lego.reduce((a, r) => a + Number(r.value ?? 0), 0);
        if (value > 0) {
          byEntity['Lego'] = {
            entity: 'Lego',
            balance: paid,
            count: lego.length,
            valuation: value,
            valuationDate: 'BrickEconomy',
            info:
              `LEGO sets at current market value (from the last import).\n\n` +
              `${lego.length} set${lego.length !== 1 ? 's' : ''} · paid ${fmt(paid)} · value ${fmt(value)}.\n\n` +
              `Managed in the Lego tab.`,
          };
        }
      }

      // Card display value = valuation when present, else net invested
      const displayVal = (b: EntityBalance) => b.valuation ?? b.balance;
      const balances = Object.values(byEntity).sort((a, b) => displayVal(b) - displayVal(a));
      const total = balances.reduce((acc, b) => acc + displayVal(b), 0);

      setMetrics({ totalValue: total, transactionCount: data.length, totalFees: fees });
      setEntityBalances(balances);

      // XIRR: contributions (buy/deposit) negative, withdrawals (sell) positive,
      // plus current total as a final inflow today. interest/dividend are internal.
      const cfs: CashFlow[] = [];
      for (const tx of data) {
        // TR cash pot is internal (funds ETF buys, which already count as
        // contributions) — skip so contributions aren't double-counted.
        if (tx.entity === 'Trade Republic Cash') continue;
        const t = (tx.transaction_type ?? '').toLowerCase();
        const amt = Number(tx.amount);
        if (t === 'buy' || t === 'deposit') cfs.push({ date: new Date(tx.date), amount: -amt });
        else if (t === 'sell') cfs.push({ date: new Date(tx.date), amount: amt });
      }
      if (total > 0) cfs.push({ date: new Date(), amount: total });
      setXirrRate(xirr(cfs));

      // Persist today's snapshot (daily upsert), then load the history.
      if (total > 0) {
        const by_entity = Object.fromEntries(balances.map((b) => [b.entity, Math.round(displayVal(b))]));
        try {
          await fetch('/api/snapshot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ as_of: new Date().toISOString().slice(0, 10), total: Math.round(total), by_entity }),
          });
        } catch { /* ignore */ }
      }
      const { data: snaps, error: snapsError } = await supabase.from('snapshots').select('as_of, total').order('as_of', { ascending: true });
      if (snapsError) reportError('dashboard: snapshots load', snapsError);
      if (snaps) setSnapshots(snaps.map((s) => ({ as_of: s.as_of, total: Number(s.total) })));

      // Expenses ledger (for the AI report's cashflow section). Ignored if table absent.
      const { data: exp, error: expError } = await supabase.from('expenses').select('date, amount, tag, tag_label');
      if (expError) reportError('dashboard: expenses load', expError);
      if (exp) setExpenseRows(exp as ExpenseRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchDashboardData(true); // bypass price/Euribor caches
    setRefreshing(false);
  }

  async function handleReset() {
    if (!confirm('Delete ALL transactions? This cannot be undone.')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/dev/reset', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        alert(`Reset failed: ${json.error ?? 'unknown error'}`);
      } else {
        await fetchDashboardData();
      }
    } catch {
      alert('Reset failed: network error.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Welcome Back</h2>
          <p className="text-gray-500 dark:text-ink-muted text-sm mt-1">Summary of your aggregated portfolio assets.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <button
            onClick={toggleHide}
            title={hideBalance ? 'Show balances' : 'Hide balances'}
            className="flex items-center px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 transition-colors"
          >
            {hideBalance ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh balances & live prices"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          {isDev && (
            <button
              onClick={handleReset}
              disabled={resetting}
              title="Local dev only — deletes all transactions"
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-300 dark:border-red-500/40 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              {resetting ? 'Clearing…' : '⚠ Clear DB (dev)'}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-brand-500/50 animate-pulse">Loading portfolio insights...</div>
      ) : (
        <>
          {/* Hero: total value + inline sparkline, stat chips along the bottom edge */}
          <Card accent={brand} hover={false} className="mb-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <p className="label-caps text-gray-400 dark:text-ink-muted">Total Portfolio Value</p>
                <p className="font-num text-5xl mt-3 text-indigo-600 dark:text-brand-500">
                  {hideBalance ? '••••••' : `€${animatedTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
                <p className="text-xs text-gray-400 dark:text-ink-faint mt-2">Valuation where available, else net invested</p>
              </div>
              {snapshots.length >= 2 && !hideBalance && (
                <div className="w-full md:w-56 h-16 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={snapshots} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                      <defs>
                        <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={brand} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={brand} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="total" stroke={brand} strokeWidth={2} fill="url(#heroGrad)" dot={false}
                        isAnimationActive animationDuration={800} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="mt-6 pt-5 border-t border-gray-100 dark:border-line flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <p className="label-caps text-gray-400 dark:text-ink-muted">Return (XIRR)</p>
                <p className={`font-num text-xl mt-1.5 ${xirrRate == null ? 'text-gray-400 dark:text-ink-faint' : xirrRate >= 0 ? 'text-green-600 dark:text-gain' : 'text-red-500 dark:text-loss'}`}>
                  {xirrRate == null ? '—' : `${animatedXirr.toFixed(1)}%`}
                </p>
              </div>
              <div>
                <p className="label-caps text-gray-400 dark:text-ink-muted">Tracked Operations</p>
                <p className="font-num text-xl mt-1.5 dark:text-ink">{Math.round(animatedOps)} <span className="text-sm text-gray-400 dark:text-ink-muted font-sans">items</span></p>
              </div>
              <div>
                <p className="label-caps text-gray-400 dark:text-ink-muted">Total Fees Paid</p>
                <p className="font-num text-xl mt-1.5 text-red-500 dark:text-loss">
                  {hideBalance ? '••••••' : `€${animatedFees.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </div>
            </div>
          </Card>

          <div
            ref={chartsRef}
            className={`relative grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 transition-all duration-500 ${chartsInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'} ${hideBalance ? 'blur-sm select-none pointer-events-none' : ''}`}
          >
            <NetWorthChart data={snapshots} />
            <AllocationPie data={entityBalances.map((b) => ({ name: b.entity, value: b.valuation ?? b.balance }))} />
          </div>

          {/* Per-entity balance widgets */}
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-3">Balance by Institution</p>
          <div ref={entitiesRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {entityBalances.map(({ entity, balance, count, valuation, valuationDate, info }, i) => (
              <Card
                key={entity}
                accent={entityHex(entity)}
                glow
                className={`p-5 pl-6 ${entitiesInView ? 'animate-fade-in-up' : 'opacity-0'}`}
                style={{ '--delay': `${i * 60}ms` } as React.CSSProperties}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: entityHex(entity) }} />
                  <p className="label-caps text-gray-600 dark:text-ink-muted" style={{ letterSpacing: '0.06em' }}>{entity}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="font-num text-2xl dark:text-ink">{money(valuation ?? balance)}</p>
                  {info && (
                    <Tooltip text={info}>
                      <span
                        className="text-gray-300 dark:text-ink-faint hover:text-gray-500 dark:hover:text-brand-400 transition-colors text-sm"
                        aria-label="How this valuation is calculated"
                      >
                        ⓘ
                      </span>
                    </Tooltip>
                  )}
                </div>
                {valuation !== undefined ? (
                  <p className="text-xs text-gray-400 dark:text-ink-faint mt-1.5">
                    Valuation · {valuationDate} · invested {money(balance)}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-ink-faint mt-1.5">{count} operation{count !== 1 ? 's' : ''}</p>
                )}
              </Card>
            ))}
          </div>

          {/* Portfolio report for AI */}
          <Card hover={false} className="mt-8">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-bold">Portfolio report</h3>
                <p className="text-xs text-gray-400">A PII-free summary (no names, accounts or emails) to paste into any AI assistant for advice.</p>
              </div>
              <button
                onClick={() => { setReport(buildReport()); setCopied(false); }}
                className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 transition-colors"
              >
                {report ? 'Regenerate' : 'Generate report'}
              </button>
            </div>

            {report && (
              <>
                <textarea
                  readOnly value={report} rows={14}
                  className="w-full mt-4 font-mono text-xs bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg p-3 text-gray-800 dark:text-gray-200 outline-none"
                />
                <div className="flex gap-3 mt-3">
                  <button onClick={copyReport} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3">{copied ? 'Copied ✓' : 'Copy'}</button>
                  <button onClick={downloadReport} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3">Download .md</button>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
