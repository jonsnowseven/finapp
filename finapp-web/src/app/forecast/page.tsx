'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { entityHex, typeSign, defaultReturn, defaultTax, defaultTer, DEFAULT_MONTHLY_BUY } from '../../lib/entities';
import { useHideBalance } from '../../lib/useHideBalance';
import EyeToggle from '../../components/EyeToggle';

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
const ROWS_KEY = 'finapp_forecast_rows';   // per-entity assumption overrides

function monthLabel(m: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Fractional months between two ISO dates (a → b).
function monthsBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()) + (db.getDate() - da.getDate()) / 30;
}

export default function ForecastPage() {
  const { hidden } = useHideBalance();
  // Base rows are derived from the ledger; user edits are stored as per-entity
  // overrides (persisted + synced) and merged over the base.
  const [baseRows, setBaseRows] = useState<Assumption[]>([]);
  const [rowOverrides, setRowOverrides] = useState<Record<string, Partial<Assumption>>>({});
  const rows = useMemo(
    () => baseRows.map((r) => ({ ...r, ...rowOverrides[r.entity] })),
    [baseRows, rowOverrides],
  );
  const [years, setYears] = useState(20);
  const [history, setHistory] = useState<{ date: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [mortgage, setMortgage] = useState<Mortgage>({ balance: 0, annualPct: 3.5, payment: 0 });

  // Sync forecast inputs (profile/fire/mortgage) to Supabase so they follow the
  // user across devices. localStorage is kept as a same-device cache.
  const postSettings = (patch: { profile?: unknown; fire?: unknown; mortgage?: unknown; rows?: unknown }) => {
    fetch('/api/forecast-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).catch(() => { /* offline — localStorage still holds it */ });
  };

  useEffect(() => {
    const s = localStorage.getItem(MORTGAGE_KEY);
    if (s) { try { setMortgage(JSON.parse(s)); } catch { /* ignore */ } }
  }, []);
  function updateMortgage(field: keyof Mortgage, value: number) {
    setMortgage((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem(MORTGAGE_KEY, JSON.stringify(next));
      postSettings({ mortgage: next });
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
      postSettings({ fire: next });
      return next;
    });
  }

  // State pension scenarios (from the Pension tab) — reduce the FIRE target.
  const [pensionRows, setPensionRows] = useState<{ scenario: string; gross: number | null; title: string | null }[]>([]);
  const [pensionUse, setPensionUse] = useState<'none' | 'early' | 'personal' | 'legal'>('none');

  const [birthDate, setBirthDate] = useState('');
  const [netSalary, setNetSalary] = useState(0);
  const [salaryPeriod, setSalaryPeriod] = useState<'month' | 'year'>('month');
  const [pensionTaxPct, setPensionTaxPct] = useState(25); // effective IRS on pension
  useEffect(() => {
    const s = localStorage.getItem(PROFILE_KEY);
    if (s) {
      try {
        const p = JSON.parse(s);
        if (p.birthDate) {
          setBirthDate(p.birthDate);
          const age = ageFrom(p.birthDate);
          if (age != null) setYears(Math.min(40, Math.max(1, Math.round(PT_RETIREMENT_AGE - age))));
        }
        if (typeof p.netSalary === 'number') setNetSalary(p.netSalary);
        if (p.salaryPeriod === 'month' || p.salaryPeriod === 'year') setSalaryPeriod(p.salaryPeriod);
        if (typeof p.pensionTaxPct === 'number') setPensionTaxPct(p.pensionTaxPct);
      } catch { /* ignore */ }
    }
  }, []);
  function persistProfile(next: { birthDate: string; netSalary: number; salaryPeriod: 'month' | 'year'; pensionTaxPct: number }) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    postSettings({ profile: next });
  }

  // Seed row overrides from localStorage immediately (same-device cache).
  useEffect(() => {
    const s = localStorage.getItem(ROWS_KEY);
    if (s) { try { setRowOverrides(JSON.parse(s)); } catch { /* ignore */ } }
  }, []);

  // Authoritative load from Supabase (overrides the localStorage seed above).
  useEffect(() => {
    supabase.from('forecast_settings').select('profile,fire,mortgage,rows').limit(1).maybeSingle()
      .then(({ data }) => {
        if (!data) {
          // First run: seed the DB from this device's localStorage (if any).
          const read = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
          const profile = read(PROFILE_KEY), fire = read(FIRE_KEY), mortgage = read(MORTGAGE_KEY), rows = read(ROWS_KEY);
          if (profile || fire || mortgage || rows) postSettings({ ...(profile && { profile }), ...(fire && { fire }), ...(mortgage && { mortgage }), ...(rows && { rows }) });
          return;
        }
        if (data.rows) setRowOverrides((p) => ({ ...p, ...data.rows }));
        if (data.fire) setFire((p) => ({ ...p, ...data.fire }));
        if (data.mortgage) setMortgage((p) => ({ ...p, ...data.mortgage }));
        const p = data.profile;
        if (p) {
          if (p.birthDate) {
            setBirthDate(p.birthDate);
            const age = ageFrom(p.birthDate);
            if (age != null) setYears(Math.min(40, Math.max(1, Math.round(PT_RETIREMENT_AGE - age))));
          }
          if (typeof p.netSalary === 'number') setNetSalary(p.netSalary);
          if (p.salaryPeriod === 'month' || p.salaryPeriod === 'year') setSalaryPeriod(p.salaryPeriod);
          if (typeof p.pensionTaxPct === 'number') setPensionTaxPct(p.pensionTaxPct);
        }
      });
  }, []);
  function updateBirthDate(bd: string) {
    setBirthDate(bd);
    persistProfile({ birthDate: bd, netSalary, salaryPeriod, pensionTaxPct });
    const age = ageFrom(bd);
    if (age != null) setYears(Math.min(40, Math.max(1, Math.round(PT_RETIREMENT_AGE - age))));
  }
  function updateSalary(v: number) { setNetSalary(v); persistProfile({ birthDate, netSalary: v, salaryPeriod, pensionTaxPct }); }
  function updateSalaryPeriod(p: 'month' | 'year') { setSalaryPeriod(p); persistProfile({ birthDate, netSalary, salaryPeriod: p, pensionTaxPct }); }
  function updatePensionTax(v: number) { setPensionTaxPct(v); persistProfile({ birthDate, netSalary, salaryPeriod, pensionTaxPct: v }); }

  const age = ageFrom(birthDate);
  const yearsToRet = age != null ? Math.round(PT_RETIREMENT_AGE - age) : null;

  const load = useCallback(async () => {
    const { data: txs } = await supabase.from('transactions').select('*');
    const { data: vals } = await supabase
      .from('valuations').select('*').order('as_of_date', { ascending: true });
    // Snapshot history = actual net worth over time; the latest one holds today's
    // LIVE market value per entity (valuation-or-invested) for the Start values.
    const { data: snaps } = await supabase
      .from('snapshots').select('as_of, total, by_entity').order('as_of', { ascending: true });
    setHistory((snaps ?? []).map((s) => ({ date: s.as_of as string, total: Number(s.total) })));
    const live: Record<string, number> = (snaps?.length ? (snaps[snaps.length - 1].by_entity as Record<string, number>) : {}) ?? {};

    // Pension scenarios (optional) — default to the legal-age value if present
    const { data: pen } = await supabase.from('pension_sim').select('scenario, gross, title');
    if (pen?.length) {
      setPensionRows(pen);
      const has = (s: string) => pen.some((p) => p.scenario === s && p.gross);
      setPensionUse(has('legal') ? 'legal' : has('personal') ? 'personal' : has('early') ? 'early' : 'none');
    }

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

    // Live Euribor-3M net of 28% PT tax — the TR cash / MMF return assumption,
    // matching the Overview accrual. Falls back to the static default if offline.
    let cashNet = NaN;
    try { const r = await fetch('/api/euribor'); const e = Number((await r.json()).rate); if (isFinite(e)) cashNet = Math.round(e * (1 - 0.28) * 100) / 100; } catch { /* use static default */ }

    // Union of ledger entities AND latest-snapshot entities. Snapshot-only holdings
    // (e.g. LEGO, valued from its own table with no transactions) must be rows too —
    // otherwise the projection start omits them while the actual/plan lines (built
    // from snapshot totals) include them, causing a cliff at today and a false
    // "behind plan".
    const entities = Array.from(new Set([...txs.map((t) => t.entity), ...Object.keys(live)])).sort();
    setBaseRows(entities.map((e) => ({
      entity: e,
      // Prefer live market value (latest snapshot), then statement valuation, then cost basis.
      start: Math.round(((live[e] ?? valByEntity[e] ?? net[e]) || 0) * 100) / 100,
      monthly: DEFAULT_MONTHLY_BUY[e] ?? Math.round(((recent[e] ?? 0) / MONTHS_BACK) * 100) / 100,
      annualPct: e === 'Trade Republic Cash' && isFinite(cashNet) ? cashNet : defaultReturn(e),
      terPct: defaultTer(e),
      taxPct: defaultTax(e),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  // Edits are live (recompute the projection) but NOT persisted — Save does that.
  const [rowsDirty, setRowsDirty] = useState(false);
  const [rowsSaved, setRowsSaved] = useState(false);
  function update(entity: string, field: keyof Assumption, value: number) {
    setRowOverrides((prev) => ({ ...prev, [entity]: { ...prev[entity], [field]: value } }));
    setRowsDirty(true); setRowsSaved(false);
  }
  function saveRows() {
    localStorage.setItem(ROWS_KEY, JSON.stringify(rowOverrides));
    postSettings({ rows: rowOverrides });
    setRowsDirty(false); setRowsSaved(true);
    setTimeout(() => setRowsSaved(false), 2000);
  }
  function resetRows() {
    setRowOverrides({});
    localStorage.removeItem(ROWS_KEY);
    postSettings({ rows: {} });
    setRowsDirty(false);
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
    const fireNumber = swr > 0 ? annual / swr : 0;          // in today's money (pension excluded)
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
      if (fireNumber > 0 && netTotal(t) >= target) { fiMonth = t; break; }
    }

    // Coast FIRE: target at the traditional-retirement date
    const retMonths = fire.retYears * 12;
    const targetAtRet = fireNumber * Math.pow(1 + infl, fire.retYears);
    let coastMonth = -1;
    for (let t = 0; t <= Math.min(months, retMonths); t++) {
      const grown = netTotal(t) * Math.pow(1 + blended / 100, (retMonths - t) / 12);
      if (fireNumber > 0 && grown >= targetAtRet) { coastMonth = t; break; }
    }

    const multiple = swr > 0 ? 1 / swr : 0;       // e.g. 25× at 4%
    const monthlyIncome = (fireNumber * swr) / 12; // safe monthly draw at FI (today's money)
    return { annual, fireNumber, fiMonth, coastMonth, multiple, monthlyIncome, blended };
  }, [rows, years, fire]);

  // State pension as EXTRA retirement income (not part of the FIRE target).
  const pensionGross = pensionUse !== 'none'
    ? Number(pensionRows.find((p) => p.scenario === pensionUse)?.gross ?? 0) : 0;
  const pensionNet = pensionGross * (1 - pensionTaxPct / 100);   // after PT IRS
  const retirementIncome = fireCalc.monthlyIncome + pensionNet;  // safe draw + net pension

  const fmt = (n: number) =>
    hidden ? '••••••' : `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const startTotal = rows.reduce((a, r) => a + r.start, 0);
  const monthlyTotal = rows.reduce((a, r) => a + r.monthly, 0);

  // "Plan" baseline: project the EARLIEST snapshot forward at the blended net return
  // + current monthly contributions. Overlaid on the actual history so the gap between
  // where the plan expected you to be and where you actually are is visible.
  const planOrigin = useMemo(() => {
    if (!history.length) return null;
    const first = [...history].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    return { date: first.date, value: first.total };
  }, [history]);
  const planMonthly = fireCalc.blended / 100 / 12;   // blended net monthly rate
  const planAt = useCallback((dateStr: string): number | undefined => {
    if (!planOrigin) return undefined;
    const k = monthsBetween(planOrigin.date, dateStr);
    if (k < 0) return undefined;
    const g = Math.pow(1 + planMonthly, k);
    const v = planMonthly > 1e-9
      ? planOrigin.value * g + monthlyTotal * (g - 1) / planMonthly
      : planOrigin.value + monthlyTotal * k;
    return Math.round(v);
  }, [planOrigin, planMonthly, monthlyTotal]);

  // Continuous timeline: actual net worth (snapshots) → today → projection.
  const todayIso = new Date().toISOString().slice(0, 10);
  const timeline = useMemo(() => {
    const pts: { date: string; actual?: number; forecast?: number; plan?: number }[] =
      history.map((s) => ({ date: s.date, actual: s.total, plan: planAt(s.date) }));
    const now = new Date();
    for (let m = 0; m <= years * 12; m += m < 12 ? 1 : 3) {   // monthly first year, then quarterly
      const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
      pts.push({ date: d.toISOString().slice(0, 10), forecast: Math.round(rows.reduce((a, r) => a + projectGross(r, m), 0)) });
    }
    // Bridge: anchor the projection start to today's actual value.
    pts.push({ date: todayIso, actual: Math.round(startTotal), forecast: Math.round(startTotal), plan: planAt(todayIso) });
    return pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [history, rows, years, startTotal, todayIso, planAt]);

  // Metric: today's actual value vs where the plan (from the first snapshot) expected
  // you to be. Positive = ahead of plan. Needs ≥1 month of history to be meaningful.
  const vsPlan = useMemo(() => {
    if (!planOrigin) return null;
    const months = monthsBetween(planOrigin.date, todayIso);
    if (months < 1) return null;
    const expected = planAt(todayIso);
    if (expected == null || expected <= 0) return null;
    const delta = Math.round(startTotal - expected);
    return { fromDate: planOrigin.date, months: Math.round(months), expected, delta, pct: (delta / expected) * 100 };
  }, [planOrigin, planAt, startTotal, todayIso]);

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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Forecast</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            See where your money could end up if you keep investing the way you do now. Where you
            buy regularly, those monthly buys carry on; everything else simply grows at its assumed
            rate. Every number below is an editable assumption — change any of them to explore.
          </p>
        </div>
        <div className="shrink-0 mt-1"><EyeToggle /></div>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-brand-500/50 animate-pulse">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-400">No transactions yet — import some first.</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card label={`Net value · ${years}y (after tax)`} value={fmt(endNet)} accent />
            <Card label="Total contributed" value={fmt(contributed)} />
            <Card label="Net growth (after tax)" value={fmt(growthNet)} />
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <label className="text-sm font-medium text-gray-400 uppercase tracking-wider">Horizon (years)</label>
              <p className="text-[11px] text-gray-400 normal-case mt-1">How far into the future to project.</p>
              <input
                type="range" min={1} max={40} value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                className="w-full mt-2 accent-indigo-600 dark:accent-brand-500"
              />
              <p className="text-2xl font-bold dark:text-white">{years}y</p>

              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/60">
                <label className="text-[11px] text-gray-400 normal-case">Birth date (sets default horizon)</label>
                <input
                  type="date" value={birthDate}
                  onChange={(e) => updateBirthDate(e.target.value)}
                  className="w-full mt-1 bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500"
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

          {/* History + Forecast timeline */}
          <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm mb-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="label-caps text-gray-400 dark:text-ink-muted">Net worth · history &amp; forecast</p>
                {vsPlan && (
                  <p className="text-xs mt-1 text-gray-500 dark:text-ink-muted cursor-help"
                    title={`Plan projects your first snapshot (${fmt(planOrigin!.value)} on ${vsPlan.fromDate}, ${vsPlan.months} mo ago) forward at the blended net return (${fireCalc.blended.toFixed(1)}%/yr) plus ${fmt(monthlyTotal)}/mo of contributions. Expected today: ${fmt(vsPlan.expected)} · Actual today: ${fmt(Math.round(startTotal))}.`}>
                    vs plan:{' '}
                    <span className={vsPlan.delta >= 0 ? 'text-gain font-semibold' : 'text-loss font-semibold'}>
                      {vsPlan.delta >= 0 ? '+' : ''}{fmt(vsPlan.delta)} ({vsPlan.pct >= 0 ? '+' : ''}{vsPlan.pct.toFixed(1)}%)
                    </span>
                    <span className="text-gray-400 dark:text-ink-faint"> {vsPlan.delta >= 0 ? 'ahead' : 'behind'} · since {vsPlan.fromDate} ⓘ</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-ink-muted shrink-0">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: '#3ce36a' }} />Actual</span>
                {planOrigin && <span className="flex items-center gap-1.5"><span className="inline-block w-3 border-t border-dotted" style={{ borderColor: '#9a9488' }} />Plan</span>}
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded border-t border-dashed" style={{ borderColor: 'rgb(var(--brand-500))' }} />Forecast</span>
              </div>
            </div>
            <div className={`relative ${hidden ? 'blur-sm select-none pointer-events-none' : ''}`}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={timeline} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    minTickGap={48} tickFormatter={(d) => String(d).slice(0, 7)} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#171717', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmt(v)} labelFormatter={(l) => String(l)} />
                  <ReferenceLine x={todayIso} stroke="#6b7280" strokeDasharray="4 4" label={{ value: 'today', fontSize: 10, fill: '#9a9488', position: 'insideTopRight' }} />
                  <Line type="monotone" dataKey="plan" name="Plan" stroke="#9a9488" strokeWidth={1.5} strokeDasharray="2 3" dot={false} connectNulls />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="#3ce36a" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="forecast" name="Forecast" stroke="rgb(var(--brand-500))" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-entity projection */}
          <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm mb-6">
            <div className={`relative ${hidden ? 'blur-sm select-none pointer-events-none' : ''}`}>
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
          </div>

          {/* Savings rate */}
          {(() => {
            const monthlyNet = salaryPeriod === 'year' ? netSalary / 12 : netSalary;
            const rate = monthlyNet > 0 ? (monthlyTotal / monthlyNet) * 100 : null;
            // Savings-rate benchmarks: 20% "pay yourself first" rule; 50%+ = FIRE pace.
            const tier =
              rate == null ? { cls: 'text-indigo-600 dark:text-brand-400', label: '' }
              : rate < 10  ? { cls: 'text-red-500 dark:text-red-400',       label: 'low' }
              : rate < 20  ? { cls: 'text-amber-500 dark:text-amber-400',   label: 'fair' }
              : rate < 30  ? { cls: 'text-green-600 dark:text-green-400',   label: 'on track (20% rule)' }
              : rate < 50  ? { cls: 'text-emerald-600 dark:text-emerald-400', label: 'great' }
              :              { cls: 'text-teal-500 dark:text-teal-300',     label: 'FIRE pace' };
            return (
              <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2">
                  <label className="label-caps text-gray-400 dark:text-ink-muted">Net salary (€)</label>
                  <NumInput value={netSalary} step={50} onChange={updateSalary} />
                  <button
                    onClick={() => updateSalaryPeriod(salaryPeriod === 'month' ? 'year' : 'month')}
                    className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-line text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3"
                  >
                    / {salaryPeriod}
                  </button>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Investing <strong className="dark:text-white">{fmt(monthlyTotal)}/mo</strong>
                  {rate != null ? (
                    <> = <strong className={tier.cls}>{rate.toFixed(1)}%</strong> of net salary
                      <span className={`ml-2 text-xs font-medium ${tier.cls}`}>· {tier.label}</span>
                    </>
                  ) : (
                    <span className="text-gray-400"> — enter your net salary to see the %</span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Assumptions table */}
          <div className="flex items-center justify-between gap-3 mt-6 mb-3">
            <p className="label-caps text-gray-400 dark:text-ink-muted">
              Assumptions{rowsDirty && <span className="ml-2 normal-case tracking-normal text-amber-500">· unsaved changes</span>}
            </p>
            <div className="flex items-center gap-2">
              {Object.keys(rowOverrides).length > 0 && (
                <button onClick={resetRows} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-line text-sm text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3">Reset</button>
              )}
              <button onClick={saveRows} disabled={!rowsDirty}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 disabled:opacity-50">
                {rowsSaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          </div>
          <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-surface-2 border-b border-gray-200 dark:border-line label-caps text-gray-500 dark:text-brand-500">
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
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <div className="flex items-center justify-between mb-2">
                <label className="label-caps text-gray-400 dark:text-ink-muted">Expenses (€)</label>
                <button
                  onClick={() => updateFire('period', fire.period === 'month' ? 'year' : 'month')}
                  className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-line text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3"
                >
                  / {fire.period}
                </button>
              </div>
              <NumInput value={fire.amount} step={fire.period === 'year' ? 1000 : 100} onChange={(v) => updateFire('amount', v)} />
              <p className="text-[11px] text-gray-400 normal-case mt-2">What you spend to live. Use the toggle for monthly or yearly.</p>
            </div>
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <label className="label-caps text-gray-400 dark:text-ink-muted">Withdrawal rate (%)</label>
              <div className="mt-2"><NumInput value={fire.swr} step={0.25} onChange={(v) => updateFire('swr', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">% of your pot you'd draw each year in retirement. 4% is the common rule.</p>
            </div>
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <label className="label-caps text-gray-400 dark:text-ink-muted">Inflation (%)</label>
              <div className="mt-2"><NumInput value={fire.inflation} step={0.1} onChange={(v) => updateFire('inflation', v)} /></div>
              <p className="text-[11px] text-gray-400 normal-case mt-2">Expected yearly rise in prices — keeps the target realistic.</p>
            </div>
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <label className="label-caps text-gray-400 dark:text-ink-muted">Retire in (years)</label>
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

          {/* Retirement income = investment safe withdrawal + state pension (extra) */}
          <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line mb-6">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="label-caps text-gray-400 dark:text-ink-muted">Add state pension</label>
                  <select
                    value={pensionUse}
                    onChange={(e) => setPensionUse(e.target.value as typeof pensionUse)}
                    className="bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg p-2 text-gray-900 dark:text-white outline-none"
                  >
                    <option value="none">None</option>
                    {(['early', 'personal', 'legal'] as const).map((s) => {
                      const g = Number(pensionRows.find((p) => p.scenario === s)?.gross ?? 0);
                      return g > 0 ? <option key={s} value={s}>{s} · {fmt(g)}/mo</option> : null;
                    })}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="label-caps text-gray-400 dark:text-ink-muted">IRS %</label>
                  <NumInput value={pensionTaxPct} step={0.5} onChange={updatePensionTax} />
                </div>
              </div>
              {pensionRows.length === 0 ? (
                <p className="text-sm text-gray-400">No pension saved — add it in the <strong>Pension</strong> tab.</p>
              ) : (
                <div className="flex items-center gap-6 text-sm flex-wrap">
                  <span className="text-gray-500 dark:text-gray-400">Investment draw <strong className="dark:text-white">{fmt(fireCalc.monthlyIncome)}/mo</strong></span>
                  <span className="text-gray-500 dark:text-gray-400">+ Pension (net) <strong className="dark:text-white">{fmt(pensionNet)}/mo</strong> <span className="text-gray-400">(gross {fmt(pensionGross)})</span></span>
                  <span className="text-gray-700 dark:text-gray-200">= Total retirement income <strong className="text-indigo-600 dark:text-brand-400">{fmt(retirementIncome)}/mo</strong></span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 normal-case mt-2">
              Pension is added on top of your FIRE safe withdrawal — it does <em>not</em> change the FIRE
              number or FI date above. Net pension = gross × (1 − IRS%). PT pensions are taxed as income
              (progressive IRS); set the effective rate here. Investment draw is in today&apos;s money.
            </p>
          </div>

          <div className="text-sm text-gray-500 dark:text-gray-400 -mt-2 mb-6 leading-relaxed space-y-2 max-w-3xl">
            <p>How these numbers work:</p>
            <ul className="space-y-1.5 list-disc pl-5">
              <li><strong>FIRE number</strong> — how much you need invested to live off it. It's your yearly expenses divided by the withdrawal rate (at 4%, that's 25× your yearly spending).</li>
              <li><strong>FI date</strong> — when your investments (after tax) first cover that target. The target rises with inflation, so it reflects real purchasing power.</li>
              <li><strong>Coast FIRE</strong> — the moment you could stop investing entirely and still reach the target by your retirement year, just from growth on what you already have.</li>
            </ul>
            <p className="text-xs">Tip: 4% suits a ~30-year retirement. For an early retirement of 40+ years, a safer 3.25–3.5% withdrawal rate guards against a bad run of early market returns.</p>
          </div>


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
    <div className="bg-white dark:bg-surface p-5 rounded-xl border border-gray-200 dark:border-line">
      <p className="label-caps text-gray-400 dark:text-ink-muted">{label}</p>
      <p className={`font-num text-2xl mt-2.5 ${accent ? 'text-indigo-600 dark:text-brand-500' : 'dark:text-ink'}`}>{value}</p>
    </div>
  );
}

function NumInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number" value={value} step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28 text-right bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500"
    />
  );
}

function ForecastTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value > 0).sort((a: any, b: any) => b.value - a.value);
  const total = payload[0]?.payload?.total ?? 0;
  return (
    <div className="bg-white dark:bg-surface-2 border border-gray-200 dark:border-line rounded-xl shadow-lg p-4 text-xs min-w-[200px]">
      <p className="font-bold text-gray-900 dark:text-white mb-2">{label}</p>
      {total > 0 && (
        <p className="text-gray-500 dark:text-gray-400 mb-2">Total <span className="font-semibold text-indigo-600 dark:text-brand-400">{fmt(total)}</span></p>
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
