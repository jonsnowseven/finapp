'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { entityHex, typeSign, defaultReturn, defaultTax } from '../../lib/entities';

interface Assumption {
  entity: string;
  start: number;        // current value (€)
  monthly: number;      // recurring monthly contribution (€)
  annualPct: number;    // assumed annual return (%)
  taxPct: number;       // PT tax (%) on gains at withdrawal
}

// Project one entity's gross value forward `months` (monthly compounding).
function projectGross(r: Assumption, months: number): number {
  let v = r.start;
  for (let m = 0; m < months; m++) v = v * (1 + r.annualPct / 100 / 12) + r.monthly;
  return v;
}

// After-tax value at `months`: tax applies to gains only (value − contributions).
function netAt(r: Assumption, months: number): number {
  const gross = projectGross(r, months);
  const contributed = r.start + r.monthly * months;
  const gain = Math.max(0, gross - contributed);
  return gross - gain * (r.taxPct / 100);
}

const MONTHS_BACK = 12; // window for detecting recurring contributions

export default function ForecastPage() {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [years, setYears] = useState(20);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: txs } = await supabase.from('transactions').select('*');
    const { data: vals } = await supabase
      .from('valuations').select('*').order('as_of_date', { ascending: true });

    if (!txs) { setLoading(false); return; }

    // Net contributed (cost basis) per entity
    const net: Record<string, number> = {};
    // Recurring monthly contribution: avg of buys+deposits over the trailing window
    const recent: Record<string, number> = {};
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);

    for (const tx of txs) {
      const e = tx.entity;
      net[e] = (net[e] ?? 0) + typeSign(tx.transaction_type) * Number(tx.amount);
      const t = (tx.transaction_type ?? '').toLowerCase();
      if ((t === 'buy' || t === 'deposit') && new Date(tx.date) >= cutoff) {
        recent[e] = (recent[e] ?? 0) + Number(tx.amount);
      }
    }

    // Latest stored valuation per entity (overrides cost basis as starting value)
    const valByEntity: Record<string, number> = {};
    for (const v of vals ?? []) valByEntity[v.entity] = Number(v.value); // ascending → last wins

    const entities = Array.from(new Set(txs.map((t) => t.entity))).sort();
    setRows(entities.map((e) => ({
      entity: e,
      start: Math.round((valByEntity[e] ?? net[e] ?? 0) * 100) / 100,
      monthly: Math.round(((recent[e] ?? 0) / MONTHS_BACK) * 100) / 100,
      annualPct: defaultReturn(e),
      taxPct: defaultTax(e),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  function update(entity: string, field: keyof Assumption, value: number) {
    setRows((prev) => prev.map((r) => (r.entity === entity ? { ...r, [field]: value } : r)));
  }

  // Month-by-month projection. value_{m+1} = value_m * (1 + r/12) + monthly
  const { series, entities } = useMemo(() => {
    const months = years * 12;
    const ents = rows.map((r) => r.entity);
    const cur: Record<string, number> = {};
    rows.forEach((r) => { cur[r.entity] = r.start; });

    const series: any[] = [];
    const now = new Date();
    for (let m = 0; m <= months; m++) {
      const point: any = { m };
      // label every 12 months
      const d = new Date(now); d.setMonth(d.getMonth() + m);
      point.label = `${d.getFullYear()}`;
      let total = 0;
      for (const r of rows) {
        point[r.entity] = Math.round(cur[r.entity] * 100) / 100;
        total += cur[r.entity];
      }
      point.total = Math.round(total * 100) / 100;
      series.push(point);
      // advance one month
      for (const r of rows) {
        cur[r.entity] = cur[r.entity] * (1 + r.annualPct / 100 / 12) + r.monthly;
      }
    }
    return { series, entities: ents };
  }, [rows, years]);

  const fmt = (n: number) =>
    `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const startTotal = rows.reduce((a, r) => a + r.start, 0);
  const monthlyTotal = rows.reduce((a, r) => a + r.monthly, 0);
  const contributed = startTotal + monthlyTotal * years * 12;
  const endNet = rows.reduce((a, r) => a + netAt(r, years * 12), 0);   // after PT tax
  const growthNet = endNet - contributed;

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold">Forecast</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          Projected growth assuming recurring monthly buys continue. Entities with no recent
          recurring buys just grow at their assumed rate. All assumptions are editable.
        </p>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gold-500/50 animate-pulse">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-400">No transactions yet — import some first.</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card label={`Net value · ${years}y (after tax)`} value={fmt(endNet)} accent />
            <Card label="Total contributed" value={fmt(contributed)} />
            <Card label="Net growth (after tax)" value={fmt(growthNet)} />
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Horizon (years)</label>
              <input
                type="range" min={1} max={40} value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className="w-full mt-3 accent-indigo-600 dark:accent-gold-500"
              />
              <p className="text-2xl font-bold dark:text-white">{years}y</p>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white dark:bg-[#0a0a0a] p-6 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm mb-6">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  {entities.map((e) => (
                    <linearGradient key={e} id={`f-${e.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={entityHex(e)} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={entityHex(e)} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false}
                  axisLine={false} interval={11} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                  width={70} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ForecastTooltip fmt={fmt} />} />
                {entities.map((e) => (
                  <Area key={e} type="monotone" dataKey={e} stackId="1"
                    stroke={entityHex(e)} strokeWidth={1.5} fill={`url(#f-${e.replace(/\s+/g, '-')})`} dot={false} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Assumptions table */}
          <div className="bg-white dark:bg-[#0a0a0a] rounded-2xl border border-gray-200 dark:border-gold-500/20 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#111] border-b border-gray-200 dark:border-gold-500/20 text-xs font-bold text-gray-400 dark:text-gold-500 uppercase tracking-wider">
                  <th className="p-4">Institution</th>
                  <th className="p-4 text-right">Start value (€)</th>
                  <th className="p-4 text-right">Monthly buy (€)</th>
                  <th className="p-4 text-right">Annual return (%)</th>
                  <th className="p-4 text-right">Tax on gains (%)</th>
                  <th className="p-4 text-right">20y net</th>
                  {years !== 20 && <th className="p-4 text-right">{years}y net</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                {rows.map((r) => (
                  <tr key={r.entity}>
                    <td className="p-4">
                      <span className="flex items-center gap-2 font-semibold text-gray-700 dark:text-gray-300">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entityHex(r.entity) }} />
                        {r.entity}
                      </span>
                    </td>
                    <td className="p-4 text-right"><NumInput value={r.start} onChange={(v) => update(r.entity, 'start', v)} /></td>
                    <td className="p-4 text-right"><NumInput value={r.monthly} onChange={(v) => update(r.entity, 'monthly', v)} /></td>
                    <td className="p-4 text-right"><NumInput value={r.annualPct} step={0.1} onChange={(v) => update(r.entity, 'annualPct', v)} /></td>
                    <td className="p-4 text-right"><NumInput value={r.taxPct} step={0.5} onChange={(v) => update(r.entity, 'taxPct', v)} /></td>
                    <td className="p-4 text-right font-bold dark:text-white">{fmt(netAt(r, 240))}</td>
                    {years !== 20 && <td className="p-4 text-right font-bold dark:text-white">{fmt(netAt(r, years * 12))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
            Estimates only. Compounded monthly; contributions added at month end. The chart shows
            gross (unrealised) value; net columns apply Portuguese tax on gains at withdrawal
            (28% equities/crypto, ~8% PPR ≥5y, Aforro 28%; Revolut already net). Defaults are
            editable and not tax advice. Market returns are assumptions — actual results vary and
            can be negative.
          </p>
        </>
      )}
    </main>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
      <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-2 ${accent ? 'text-indigo-600 dark:text-gold-400' : 'dark:text-white'}`}>{value}</p>
    </div>
  );
}

function NumInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number" value={value} step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28 text-right bg-gray-50 dark:bg-[#111] border border-gray-300 dark:border-gold-500/30 rounded-lg px-2 py-1 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500"
    />
  );
}

function ForecastTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value > 0).sort((a: any, b: any) => b.value - a.value);
  const total = payload[0]?.payload?.total ?? 0;
  return (
    <div className="bg-white dark:bg-[#111] border border-gray-200 dark:border-gold-500/30 rounded-xl shadow-lg p-4 text-xs min-w-[200px]">
      <p className="font-bold text-gray-900 dark:text-white mb-2">{label}</p>
      <p className="text-gray-500 dark:text-gray-400 mb-2">Total <span className="font-semibold text-indigo-600 dark:text-gold-400">{fmt(total)}</span></p>
      {rows.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4 text-gray-700 dark:text-gray-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />{p.dataKey}
          </span>
          <span className="font-medium">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
