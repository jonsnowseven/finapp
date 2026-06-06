'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { entityHex, typeSign, defaultReturn, defaultTax, defaultTer, DEFAULT_MONTHLY_BUY } from '../../lib/entities';

interface Assumption {
  entity: string;
  start: number;        // current value (€)
  monthly: number;      // recurring monthly contribution (€)
  annualPct: number;    // assumed annual return (%)
  terPct: number;       // fund fee / TER (% per year) — subtracted from return
  taxPct: number;       // PT tax (%) on gains at withdrawal
}

// Net-of-fees annual return: assumed return minus the fund's TER.
const netReturn = (r: Assumption) => r.annualPct - r.terPct;

// Project one entity's gross value forward `months` (monthly compounding, after fees).
function projectGross(r: Assumption, months: number): number {
  let v = r.start;
  const rate = netReturn(r) / 100 / 12;
  for (let m = 0; m < months; m++) v = v * (1 + rate) + r.monthly;
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
const PT_RETIREMENT_AGE = 66 + 7 / 12; // Portugal legal retirement age 2026: 66y 7m
const PROFILE_KEY = 'finapp_profile';

// Age in years from an ISO birth date (YYYY-MM-DD); null if invalid.
function ageFrom(birthDate: string): number | null {
  if (!birthDate) return null;
  const t = new Date(birthDate).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / (365.25 * 24 * 3600 * 1000);
}

interface Mortgage {
  balance: number;    // outstanding principal (€)
  annualPct: number;  // annual interest rate (PT: Euribor + spread)
  payment: number;    // monthly payment / prestação (€)
}
const MORTGAGE_KEY = 'finapp_mortgage';

interface Fire {
  amount: number;            // expenses
  period: 'month' | 'year';  // expenses period
  swr: number;               // safe withdrawal rate (%)
  inflation: number;         // annual inflation (%)
  retYears: number;          // years to traditional retirement (for Coast FIRE)
}
const FIRE_KEY = 'finapp_fire';

function monthLabel(m: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function ForecastPage() {
  const [rows, setRows] = useState<Assumption[]>([]);
  const [years, setYears] = useState(20);
  const [loading, setLoading] = useState(true);
  const [mortgage, setMortgage] = useState<Mortgage>({ balance: 0, annualPct: 3.5, payment: 0 });

  // Mortgage has no DB source — persist its inputs locally.
  useEffect(() => {
    const s = localStorage.getItem(MORTGAGE_KEY);
    if (s) { try { setMortgage(JSON.parse(s)); } catch { /* ignore */ } }
  }, []);
  function updateMortgage(field: keyof Mortgage, value: number) {
    setMortgage((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem(MORTGAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const [fire, setFire] = useState<Fire>({ amount: 0, period: 'month', swr: 4, inflation: 2, retYears: 30 });
  useEffect(() => {
    const s = localStorage.getItem(FIRE_KEY);
    if (s) { try { setFire(JSON.parse(s)); } catch { /* ignore */ } }
  }, []);
  function updateFire<K extends keyof Fire>(field: K, value: Fire[K]) {
    setFire((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem(FIRE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const [birthDate, setBirthDate] = useState('');
  useEffect(() => {
    const s = localStorage.getItem(PROFILE_KEY);
    if (s) {
      try {
        const { birthDate: bd } = JSON.parse(s);
        if (bd) {
          setBirthDate(bd);
          const age = ageFrom(bd);
          if (age != null) setYears(Math.min(40, Math.max(1, Math.round(PT_RETIREMENT_AGE - age))));
        }
      } catch { /* ignore */ }
    }
  }, []);
  function updateBirthDate(bd: string) {
    setBirthDate(bd);
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ birthDate: bd }));
    const age = ageFrom(bd);
    if (age != null) setYears(Math.min(40, Math.max(1, Math.round(PT_RETIREMENT_AGE - age))));
  }

  const age = ageFrom(birthDate);
  const yearsToRet = age != null ? Math.round(PT_RETIREMENT_AGE - age) : null;

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
      monthly: DEFAULT_MONTHLY_BUY[e] ?? Math.round(((recent[e] ?? 0) / MONTHS_BACK) * 100) / 100,
      annualPct: defaultReturn(e),
      terPct: defaultTer(e),
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
        cur[r.entity] = cur[r.entity] * (1 + netReturn(r) / 100 / 12) + r.monthly;
      }
    }
    return { series, entities: ents };
  }, [rows, years]);

  // Mortgage amortization vs after-tax investments. Finds:
  //  - payoffMonth: loan balance reaches 0 (scheduled payoff)
  //  - crossoverMonth: investments (net of tax) ≥ remaining balance (could clear it)
  const mort = useMemo(() => {
    const months = years * 12;
    const i = mortgage.annualPct / 100 / 12;
    const combined: any[] = [];
    let bal = mortgage.balance;
    let payoffMonth = -1;
    let crossoverMonth = -1;

    for (let m = 0; m <= months; m++) {
      const net = rows.reduce((a, r) => a + netAt(r, m), 0);
      const curBal = Math.max(0, bal);
      combined.push({ label: monthLabel(m).slice(-4), net: Math.round(net), mortgage: Math.round(curBal) });
      if (payoffMonth < 0 && curBal <= 0 && mortgage.balance > 0) payoffMonth = m;
      if (crossoverMonth < 0 && mortgage.balance > 0 && net >= curBal) crossoverMonth = m;
      bal = bal > 0 ? bal * (1 + i) - mortgage.payment : 0;
    }
    // payment must exceed first month's interest, else it never amortizes
    const neverPayoff = mortgage.balance > 0 && mortgage.payment <= mortgage.balance * i;
    const totalInterest = payoffMonth > 0 ? mortgage.payment * payoffMonth - mortgage.balance : 0;
    return { combined, payoffMonth, crossoverMonth, neverPayoff, totalInterest };
  }, [rows, years, mortgage]);

  // FIRE — Financial Independence, Retire Early.
  //  - FIRE number = annual expenses / SWR (4% rule ⇒ 25×; Trinity study).
  //  - Target is inflation-adjusted (real terms); compared to after-tax investments.
  //  - FI date: first month net investments ≥ inflated target.
  //  - Coast FIRE: current portfolio, with NO further contributions, reaches the
  //    (inflated) target by traditional retirement on its own growth.
  const fireCalc = useMemo(() => {
    const annual = fire.period === 'year' ? fire.amount : fire.amount * 12;
    const swr = fire.swr / 100;
    const infl = fire.inflation / 100;
    const fireNumber = swr > 0 ? annual / swr : 0;          // in today's money
    const months = years * 12;

    const netTotal = (t: number) => rows.reduce((a, r) => a + netAt(r, t), 0);

    // Portfolio-value-weighted blended return for the coast phase
    const totalStart = rows.reduce((a, r) => a + r.start, 0);
    const blended = totalStart > 0
      ? rows.reduce((a, r) => a + r.start * netReturn(r), 0) / totalStart
      : 7;

    let fiMonth = -1;
    for (let t = 0; t <= months; t++) {
      const target = fireNumber * Math.pow(1 + infl, t / 12);
      if (netTotal(t) >= target && fireNumber > 0) { fiMonth = t; break; }
    }

    // Coast FIRE: target at the traditional-retirement date
    const retMonths = fire.retYears * 12;
    const targetAtRet = fireNumber * Math.pow(1 + infl, fire.retYears);
    let coastMonth = -1;
    for (let t = 0; t <= Math.min(months, retMonths); t++) {
      const grown = netTotal(t) * Math.pow(1 + blended / 100, (retMonths - t) / 12);
      if (grown >= targetAtRet && fireNumber > 0) { coastMonth = t; break; }
    }

    const multiple = swr > 0 ? 1 / swr : 0;       // e.g. 25× at 4%
    const monthlyIncome = (fireNumber * swr) / 12; // safe monthly draw at FI (today's money)
    return { annual, fireNumber, fiMonth, coastMonth, multiple, monthlyIncome, blended };
  }, [rows, years, fire]);

  const fmt = (n: number) =>
    `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const startTotal = rows.reduce((a, r) => a + r.start, 0);
  const monthlyTotal = rows.reduce((a, r) => a + r.monthly, 0);
  const contributed = startTotal + monthlyTotal * years * 12;
  const endNet = rows.reduce((a, r) => a + netAt(r, years * 12), 0);   // after PT tax
  const growthNet = endNet - contributed;

  // Sortable table. Default = horizon-net column (20y, or the custom year), descending.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const horizonKey = years !== 20 ? 'netN' : 'net20';
  const activeKey = sortKey ?? horizonKey;
  const ACC: Record<string, (r: Assumption) => number> = {
    start: (r) => r.start,
    monthly: (r) => r.monthly,
    annualPct: (r) => r.annualPct,
    terPct: (r) => r.terPct,
    taxPct: (r) => r.taxPct,
    net20: (r) => netAt(r, 240),
    netN: (r) => netAt(r, years * 12),
  };
  const sortedRows = useMemo(() => {
    const f = ACC[activeKey] ?? ACC.net20;
    return [...rows].sort((a, b) => (sortDir === 'desc' ? f(b) - f(a) : f(a) - f(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeKey, sortDir, years]);
  function sortBy(key: string) {
    if (activeKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }
  const arrow = (key: string) => (activeKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '');

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold">Forecast</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          See where your money could end up if you keep investing the way you do now. Where you
          buy regularly, those monthly buys carry on; everything else simply grows at its assumed
          rate. Every number below is an editable assumption — change any of them to explore.
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
              <p className="text-[11px] text-gray-400 normal-case mt-1">How far into the future to project.</p>
              <input
                type="range" min={1} max={40} value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className="w-full mt-2 accent-indigo-600 dark:accent-gold-500"
              />
              <p className="text-2xl font-bold dark:text-white">{years}y</p>

              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/60">
                <label className="text-[11px] text-gray-400 normal-case">Birth date (sets default horizon)</label>
                <input
                  type="date" value={birthDate}
                  onChange={(e) => updateBirthDate(e.target.value)}
                  className="w-full mt-1 bg-gray-50 dark:bg-[#111] border border-gray-300 dark:border-gold-500/30 rounded-lg px-2 py-1 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500"
                />
                {age != null && (
                  <p
                    className="text-[11px] text-gray-400 normal-case mt-1 cursor-help"
                    title={`Born ${birthDate} · age ${age.toFixed(1)} today · Portugal retirement age 66y7m → ${yearsToRet} years to retirement (capped at 40 on the slider).`}
                  >
                    Age {Math.floor(age)} · {yearsToRet}y to PT retirement (66y7m) ⓘ
                  </p>
                )}
              </div>
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
          <div className="bg-white dark:bg-[#0a0a0a] rounded-2xl border border-gray-200 dark:border-gold-500/20 overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#111] border-b border-gray-200 dark:border-gold-500/20 text-xs font-bold text-gray-400 dark:text-gold-500 uppercase tracking-wider">
                  <th className="p-4">Institution</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('start')} title="What this holding is worth today. Pre-filled from your latest valuation or amount invested — editable. Click to sort.">Start value (€){arrow('start')}</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('monthly')} title="Your typical monthly contribution here — editable. Click to sort.">Monthly buy (€){arrow('monthly')}</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('annualPct')} title="Assumed yearly growth rate for this holding, before fees. Click to sort.">Annual return (%){arrow('annualPct')}</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('terPct')} title="Fund's yearly fee (Total Expense Ratio), subtracted from the return. 0 for direct stocks, savings and crypto. Click to sort.">Fees / TER (%){arrow('terPct')}</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('taxPct')} title="Portuguese tax paid on the profit when you cash out (gains only, not the money you put in). Click to sort.">Tax on gains (%){arrow('taxPct')}</th>
                  <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('net20')} title="Projected value after 20 years, after tax. Click to sort.">20y net{arrow('net20')}</th>
                  {years !== 20 && <th className="p-4 text-right cursor-pointer select-none" onClick={() => sortBy('netN')} title={`Projected value after ${years} years, after tax. Click to sort.`}>{years}y net{arrow('netN')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                {sortedRows.map((r) => (
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
                    <td className="p-4 text-right"><NumInput value={r.terPct} step={0.05} onChange={(v) => update(r.entity, 'terPct', v)} /></td>
                    <td className="p-4 text-right"><NumInput value={r.taxPct} step={0.5} onChange={(v) => update(r.entity, 'taxPct', v)} /></td>
                    <td className="p-4 text-right font-bold dark:text-white">{fmt(netAt(r, 240))}</td>
                    {years !== 20 && <td className="p-4 text-right font-bold dark:text-white">{fmt(netAt(r, years * 12))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FIRE — Financial Independence */}
          <div className="mt-8 mb-3 flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="text-lg font-bold">FIRE — Financial Independence</h3>
            <span className="text-xs text-gray-400">When you could live off your investments. Saved on this device.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Expenses (€)</label>
                <button
                  onClick={() => updateFire('period', fire.period === 'month' ? 'year' : 'month')}
                  className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gold-500/30 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]"
                >
                  / {fire.period}
                </button>
              </div>
              <NumInput value={fire.amount} step={fire.period === 'year' ? 1000 : 100} onChange={(v) => updateFire('amount', v)} />
              <p className="text-[11px] text-gray-400 normal-case mt-2">What you spend to live. Use the toggle for monthly or yearly.</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Withdrawal rate (%)</label>
              <div className="mt-2"><NumInput value={fire.swr} step={0.25} onChange={(v) => updateFire('swr', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">% of your pot you'd draw each year in retirement. 4% is the common rule.</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Inflation (%)</label>
              <div className="mt-2"><NumInput value={fire.inflation} step={0.1} onChange={(v) => updateFire('inflation', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">Expected yearly rise in prices — keeps the target realistic.</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Retire in (years)</label>
              <div className="mt-2"><NumInput value={fire.retYears} step={1} onChange={(v) => updateFire('retYears', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">Years until your normal retirement — used for Coast FIRE.</p>
            </div>
          </div>

          {fire.amount > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card label={`FIRE number (${fireCalc.multiple.toFixed(0)}× annual)`} accent value={fmt(fireCalc.fireNumber)} />
              <Card
                label="FI date (full FIRE)"
                value={fireCalc.fiMonth >= 0 ? `${monthLabel(fireCalc.fiMonth)} · ${(fireCalc.fiMonth / 12).toFixed(1)}y` : `> ${years}y`}
              />
              <Card
                label="Coast FIRE reached"
                value={fireCalc.coastMonth >= 0 ? `${monthLabel(fireCalc.coastMonth)} · ${(fireCalc.coastMonth / 12).toFixed(1)}y` : `> horizon`}
              />
              <Card label="Safe income at FI /mo" value={`${fmt(fireCalc.monthlyIncome)} (today)`} />
            </div>
          )}

          <div className="text-sm text-gray-500 dark:text-gray-400 -mt-2 mb-6 leading-relaxed space-y-2 max-w-3xl">
            <p>How these numbers work:</p>
            <ul className="space-y-1.5 list-disc pl-5">
              <li><strong>FIRE number</strong> — how much you need invested to live off it. It's your yearly expenses divided by the withdrawal rate (at 4%, that's 25× your yearly spending).</li>
              <li><strong>FI date</strong> — when your investments (after tax) first cover that target. The target rises with inflation, so it reflects real purchasing power.</li>
              <li><strong>Coast FIRE</strong> — the moment you could stop investing entirely and still reach the target by your retirement year, just from growth on what you already have.</li>
            </ul>
            <p className="text-xs">Tip: 4% suits a ~30-year retirement. For an early retirement of 40+ years, a safer 3.25–3.5% withdrawal rate guards against a bad run of early market returns.</p>
          </div>

          {/* Mortgage — Crédito Habitação */}
          <div className="mt-8 mb-3 flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="text-lg font-bold">Crédito Habitação</h3>
            <span className="text-xs text-gray-400">When your home loan is paid off — and when your investments could clear it. Saved on this device.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Outstanding balance (€)</label>
              <div className="mt-2"><NumInput value={mortgage.balance} step={1000} onChange={(v) => updateMortgage('balance', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">How much you still owe on the loan today.</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Annual rate (%)</label>
              <div className="mt-2"><NumInput value={mortgage.annualPct} step={0.1} onChange={(v) => updateMortgage('annualPct', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">Yearly interest rate — usually Euribor plus your bank's spread.</p>
            </div>
            <div className="bg-white dark:bg-[#0a0a0a] p-5 rounded-2xl border border-gray-200 dark:border-gold-500/20">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Monthly payment (€)</label>
              <div className="mt-2"><NumInput value={mortgage.payment} step={50} onChange={(v) => updateMortgage('payment', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">Your monthly instalment (prestação).</p>
            </div>
          </div>

          {mortgage.balance > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card
                  label="Scheduled payoff"
                  accent
                  value={
                    mort.neverPayoff ? 'Never (payment ≤ interest)'
                      : mort.payoffMonth > 0 ? `${monthLabel(mort.payoffMonth)} · ${(mort.payoffMonth / 12).toFixed(1)}y`
                      : `> ${years}y (raise horizon)`
                  }
                />
                <Card
                  label="Could clear with investments"
                  value={
                    mort.crossoverMonth >= 0 ? `${monthLabel(mort.crossoverMonth)} · ${(mort.crossoverMonth / 12).toFixed(1)}y`
                      : `> ${years}y`
                  }
                />
                <Card
                  label="Total interest (to payoff)"
                  value={mort.payoffMonth > 0 ? fmt(mort.totalInterest) : '—'}
                />
              </div>

              <div className="bg-white dark:bg-[#0a0a0a] p-6 rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm mb-6">
                <div className="flex items-center gap-4 mb-4 text-xs">
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#10b981' }} />Investments (net)</span>
                  <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />Mortgage balance</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={mort.combined} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} interval={11} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<ForecastTooltip fmt={fmt} />} />
                    <Line type="monotone" dataKey="net" name="Investments (net)" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mortgage" name="Mortgage balance" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 leading-relaxed max-w-3xl">
            A few things to keep in mind: these are estimates, not promises. Growth is added month
            by month, with your monthly buys counted at each month's end. The big chart shows value
            <em> before</em> tax (you haven't sold yet); the "net" figures subtract Portuguese tax
            you'd pay when you cash out — roughly 28% on shares and crypto, about 8% on a PPR held
            5+ years, 28% on Aforro interest, and nothing extra on Revolut (already taxed). The
            return rates are guesses you can change, and real markets can go down as well as up.
            This isn't tax or investment advice.
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
      {total > 0 && (
        <p className="text-gray-500 dark:text-gray-400 mb-2">Total <span className="font-semibold text-indigo-600 dark:text-gold-400">{fmt(total)}</span></p>
      )}
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
