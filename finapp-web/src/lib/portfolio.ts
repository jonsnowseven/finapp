import { createClient } from '@supabase/supabase-js';
import { typeSign, cryptoSymbol, TR_EUR_SYMBOL } from './entities';
import { fetchMultipleQuotes, valuateIsins } from './marketdata';
import { fetchEuribor3M } from './euribor';

// Server-side portfolio valuation — mirrors the dashboard's per-entity live
// valuation so a cron can snapshot without a browser. Uses the service-role
// client + the market-data / euribor libs directly.
export async function computeSnapshot(fresh = true): Promise<{ total: number; byEntity: Record<string, number> }> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: txs } = await db.from('transactions').select('*');
  const rows = txs ?? [];

  // Net invested (cost basis) per entity.
  const bal: Record<string, number> = {};
  for (const tx of rows) bal[tx.entity] = (bal[tx.entity] ?? 0) + typeSign(tx.transaction_type) * Number(tx.amount);

  // Latest statement valuation per entity.
  const val: Record<string, number> = {};
  const valDate: Record<string, string> = {};
  const { data: vals } = await db.from('valuations').select('*').order('as_of_date', { ascending: true });
  for (const v of vals ?? []) { val[v.entity] = Number(v.value); valDate[v.entity] = v.as_of_date; }

  const daysSince = (d: string) => Math.max(0, (Date.now() - new Date(d).getTime()) / 86_400_000);

  // Aforro: accrue the statement TOTAL at Euribor-3M + 1% (cap 2.5%).
  if (val['Aforro'] && valDate['Aforro']) {
    try {
      const { rate } = await fetchEuribor3M(fresh);
      const eur = Number(rate);
      if (isFinite(eur)) {
        const annual = Math.min(eur + 1.0, 2.5) / 100;
        val['Aforro'] = val['Aforro'] * (1 + annual * daysSince(valDate['Aforro']) / 365);
      }
    } catch { /* keep raw statement value */ }
  }
  // Revolut Boosted: accrue at 1.8% net/yr.
  if (val['Revolut'] && valDate['Revolut']) {
    const annual = 0.025 * (1 - 0.28);
    val['Revolut'] = val['Revolut'] * (1 + annual * daysSince(valDate['Revolut']) / 365);
  }

  const holdings = (entity: string, key: (tx: any) => string | null) => {
    const h: Record<string, number> = {};
    for (const tx of rows) {
      if (tx.entity !== entity || !tx.quantity) continue;
      const k = key(tx);
      if (!k) continue;
      h[k] = (h[k] ?? 0) + typeSign(tx.transaction_type) * Number(tx.quantity);
    }
    return Object.entries(h).filter(([, u]) => u > 1e-9);
  };

  // Kraken — crypto × live EUR price.
  const kr = holdings('Kraken', (tx) => tx.asset_name);
  if (kr.length) {
    try {
      const map = kr.map(([a]) => ({ a, s: cryptoSymbol(a) }));
      const q = await fetchMultipleQuotes(map.map((m) => m.s), fresh);
      const price: Record<string, number> = {};
      for (const x of q) price[x.symbol] = Number(x.price);
      let v = 0;
      const units = Object.fromEntries(kr);
      for (const { a, s } of map) if (price[s]) v += (units[a] as number) * price[s];
      if (v > 0) val['Kraken'] = v;
    } catch { /* fall back to net invested */ }
  }

  // Trade Republic — ETF × live EUR price (mapped tickers only).
  const tr = holdings('Trade Republic', (tx) => tx.asset_name);
  if (tr.length) {
    try {
      const units = Object.fromEntries(tr);
      const map = tr.map(([a]) => ({ a, s: TR_EUR_SYMBOL[a] })).filter((m) => !!m.s);
      if (map.length) {
        const q = await fetchMultipleQuotes(map.map((m) => m.s), fresh);
        const by: Record<string, { price: number; currency: string }> = {};
        for (const x of q) by[x.symbol] = { price: Number(x.price), currency: x.currency };
        let v = 0;
        for (const { a, s } of map) { const qq = by[s]; if (qq && qq.currency === 'EUR') v += (units[a] as number) * qq.price; }
        if (v > 0) val['Trade Republic'] = v;
      }
    } catch { /* fall back */ }
  }

  // DeGiro — ISIN (from source_document) × live EUR price.
  const dg = holdings('DeGiro', (tx) => {
    const m = String(tx.source_document ?? '').match(/^degiro_web_([A-Z0-9]{12})_/);
    return m ? m[1] : null;
  });
  if (dg.length) {
    try {
      const res = await valuateIsins(dg.map(([i]) => i), fresh);
      const by: Record<string, any> = {};
      for (const r of res) by[r.isin] = r;
      let v = 0;
      for (const [isin, u] of dg) { const r = by[isin]; if (r && r.priceEur > 0) v += (u as number) * r.priceEur; }
      if (v > 0) val['DeGiro'] = v;
    } catch { /* fall back */ }
  }

  // LEGO — current value from its table.
  const { data: lego } = await db.from('lego_sets').select('value');
  if (lego?.length) {
    const value = lego.reduce((a, r) => a + Number(r.value ?? 0), 0);
    if (value > 0) val['Lego'] = value;
  }

  // displayVal = valuation ?? net invested.
  const seen: Record<string, 1> = {};
  Object.keys(bal).forEach((k) => (seen[k] = 1));
  Object.keys(val).forEach((k) => (seen[k] = 1));
  const byEntity: Record<string, number> = {};
  let total = 0;
  for (const e of Object.keys(seen)) {
    const v = val[e] ?? bal[e] ?? 0;
    byEntity[e] = Math.round(v);
    total += v;
  }
  return { total: Math.round(total), byEntity };
}
