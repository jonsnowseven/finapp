'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityHex, typeSign, cryptoSymbol, TR_EUR_SYMBOL } from '../lib/entities';
import { RefreshCw } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const isDev = process.env.NODE_ENV !== 'production';

  const fmt = (n: number) =>
    `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function fetchDashboardData(fresh = false) {
    const q = fresh ? '?fresh=1' : '';
    const { data, error } = await supabase.from('transactions').select('*');
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
      const { data: lego } = await supabase.from('lego_sets').select('paid, value');
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
          <h2 className="text-2xl font-bold">Welcome Back</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Here is a summary of your aggregated portfolio assets.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh balances & live prices"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-gold-500/30 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
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
        <div className="text-gray-500 dark:text-gold-500/50 animate-pulse">Loading portfolio insights...</div>
      ) : (
        <>
          {/* Top summary row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white dark:bg-[#0a0a0a] p-6 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm transition-colors duration-200">
              <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">Total Portfolio Value</p>
              <p className="text-3xl font-bold mt-2 dark:text-white">{fmt(metrics.totalValue)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Valuation where available, else net invested</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-6 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm transition-colors duration-200">
              <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">Tracked Operations</p>
              <p className="text-3xl font-bold mt-2 text-indigo-600 dark:text-gold-400">{metrics.transactionCount} items</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-6 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm transition-colors duration-200">
              <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">Total Fees Paid</p>
              <p className="text-3xl font-bold mt-2 text-red-500 dark:text-red-400/90">{fmt(metrics.totalFees)}</p>
            </div>
          </div>

          {/* Per-entity balance widgets */}
          <p className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Balance by Institution</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {entityBalances.map(({ entity, balance, count, valuation, valuationDate, info }) => (
              <div
                key={entity}
                className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm transition-colors duration-200 relative overflow-hidden"
              >
                {/* Color accent bar */}
                <span
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ backgroundColor: entityHex(entity) }}
                />
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entityHex(entity) }} />
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{entity}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-2xl font-bold dark:text-white">{fmt(valuation ?? balance)}</p>
                  {info && (
                    <span
                      title={info}
                      className="cursor-help text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors text-sm"
                      aria-label="How this valuation is calculated"
                    >
                      ⓘ
                    </span>
                  )}
                </div>
                {valuation !== undefined ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Valuation · {valuationDate} · invested {fmt(balance)}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{count} operation{count !== 1 ? 's' : ''}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
