'use client';
import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../../lib/supabase';
import { useHideBalance } from '../../lib/useHideBalance';
import EyeToggle from '../../components/EyeToggle';
import { TENORS, type Tenor } from '../../lib/euribor';

interface Mortgage {
  balance: number;        // outstanding principal (€)
  annualPct: number;      // current effective rate (%)
  payment: number;        // current monthly payment / prestação (€)
  remainingMonths: number;
  spread: number;         // bank spread over Euribor (%)
  tenor: Tenor;           // Euribor tenor used for revisions
  resetMonth: string;     // next revision month, "YYYY-MM"
  totalTerm: number;      // total loan term in months (e.g. 444)
  paid: number;           // instalments paid so far (from import)
}
const DEFAULTS: Mortgage = { balance: 0, annualPct: 3.5, payment: 0, remainingMonths: 360, spread: 0.7, tenor: '6M', resetMonth: '', totalTerm: 0, paid: 0 };
const KEY = 'finapp_mortgage';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const prevMonth = (yyyymm: string) => { const [y, m] = yyyymm.split('-').map(Number); return ym(new Date(y, m - 2, 1)); };
const monthName = (yyyymm: string) => { const [y, m] = yyyymm.split('-').map(Number); return new Date(y, m - 1).toLocaleString('en', { month: 'long', year: 'numeric' }); };

// Monthly annuity payment for principal P at annual %, over n months.
const annuity = (P: number, annualPct: number, n: number) => {
  if (!(P > 0 && n > 0)) return 0;
  const r = annualPct / 1200;
  return r > 0 ? (P * r) / (1 - Math.pow(1 + r, -n)) : P / n;
};

export default function MortgagePage() {
  const { money, hidden } = useHideBalance();
  const [m, setM] = useState<Mortgage>(DEFAULTS);
  const [monthly, setMonthly] = useState<{ period: string; rate: number }[]>([]);   // ECB monthly averages

  // Load mortgage (localStorage cache → DB authoritative).
  useEffect(() => {
    const s = localStorage.getItem(KEY);
    if (s) { try { setM((p) => ({ ...p, ...JSON.parse(s) })); } catch { /* ignore */ } }
    supabase.from('forecast_settings').select('mortgage').limit(1).maybeSingle()
      .then(({ data }) => { if (data?.mortgage) setM((p) => ({ ...p, ...data.mortgage })); });
  }, []);

  const persist = (next: Mortgage) => {
    localStorage.setItem(KEY, JSON.stringify(next));
    fetch('/api/forecast-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mortgage: next }) }).catch(() => {});
  };
  const remainingFrom = (totalTerm: number, paid: number, fallback: number) =>
    totalTerm > 0 && paid > 0 ? Math.max(0, totalTerm - paid) : fallback;

  function update<K extends keyof Mortgage>(field: K, value: Mortgage[K]) {
    setM((prev) => {
      const next = { ...prev, [field]: value };
      // Total term + paid drive remaining months.
      if (field === 'totalTerm') next.remainingMonths = remainingFrom(value as number, prev.paid, prev.remainingMonths);
      persist(next);
      return next;
    });
  }

  const [importErr, setImportErr] = useState<string | null>(null);
  async function importLoan(file: File) {
    setImportErr(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/import/mortgage', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) { setImportErr(j.error ?? 'Import failed'); return; }
      setM((prev) => {
        const next = {
          ...prev, balance: j.balance, payment: j.payment, paid: j.paid,
          remainingMonths: remainingFrom(prev.totalTerm, j.paid, prev.remainingMonths),
        };
        persist(next);
        return next;
      });
    } catch { setImportErr('Network error'); }
  }

  // Euribor: ECB monthly averages (the ECB FM dataset has no daily frequency).
  useEffect(() => {
    fetch(`/api/euribor?tenor=${m.tenor}&freq=M&n=15`).then((r) => r.json())
      .then((j) => setMonthly(j.observations ?? [])).catch(() => setMonthly([]));
  }, [m.tenor]);

  const monthlyByPeriod = useMemo(() => Object.fromEntries(monthly.map((o) => [o.period, o.rate])), [monthly]);
  const latestMonthly = monthly.length ? monthly[monthly.length - 1] : null;

  // Reference month for the next reset = the month before the reset month.
  // Complete months use the ECB monthly average; otherwise fall back to the
  // latest published month as an estimate (no daily source is available).
  const reset = m.resetMonth || '';
  const refMonth = reset ? prevMonth(reset) : '';
  const refAvg: number | null = refMonth
    ? (monthlyByPeriod[refMonth] ?? latestMonthly?.rate ?? null)
    : null;
  const refComplete = !!refMonth && refMonth in monthlyByPeriod;

  // annualPct holds the Euribor component only; the effective loan rate adds the spread.
  const effRate = m.annualPct + m.spread;
  const projectedRate = refAvg != null ? refAvg + m.spread : null;
  const projectedPayment = projectedRate != null ? annuity(m.balance, projectedRate, m.remainingMonths) : null;
  const currentPayment = m.payment > 0 ? m.payment : annuity(m.balance, effRate, m.remainingMonths);
  const delta = projectedPayment != null ? projectedPayment - currentPayment : null;

  // Amortization at the effective rate (Euribor + spread) + payment.
  const amort = useMemo(() => {
    const r = effRate / 1200;
    let bal = m.balance;
    const pts: { m: number; balance: number }[] = [];
    let payoff = -1;
    const never = m.balance > 0 && m.payment > 0 && m.payment <= m.balance * r;
    for (let i = 0; i <= 600 && bal > 0; i++) {
      if (i % 3 === 0) pts.push({ m: i, balance: Math.round(bal) });
      bal = bal + bal * r - (m.payment > 0 ? m.payment : currentPayment);
      if (bal <= 0 && payoff < 0) { payoff = i + 1; pts.push({ m: i + 1, balance: 0 }); }
    }
    const pay = m.payment > 0 ? m.payment : currentPayment;
    const totalInterest = payoff > 0 ? pay * payoff - m.balance : 0;
    return { pts, payoff, never, totalInterest };
  }, [m.balance, effRate, m.payment, currentPayment]);

  const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(3)}%`);

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Crédito Habitação</h2>
          <p className="text-gray-500 dark:text-ink-muted text-sm mt-1">Track your mortgage and project the next Euribor rate reset.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <EyeToggle />
          <label className="cursor-pointer px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3"
            title="Santander → Empréstimos → Consulta Movimentos → export PDF">
            Import Santander PDF
            <input type="file" accept=".pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importLoan(f); e.currentTarget.value = ''; }} />
          </label>
        </div>
      </div>

      {/* Inputs */}
      <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Outstanding balance (€)"><div className={hidden ? 'blur-sm select-none pointer-events-none' : ''}><NumInput value={m.balance} step={1000} onChange={(v) => update('balance', v)} /></div></Field>
          <Field label="Current Euribor (%)"><NumInput value={m.annualPct} step={0.01} onChange={(v) => update('annualPct', v)} /></Field>
          <Field label="Current payment (€/mo)"><div className={hidden ? 'blur-sm select-none pointer-events-none' : ''}><NumInput value={m.payment} step={10} onChange={(v) => update('payment', v)} /></div></Field>
          <Field label="Total term (months)"><NumInput value={m.totalTerm} step={1} onChange={(v) => update('totalTerm', Math.round(v))} /></Field>
          <Field label={`Remaining months${m.paid ? ` (${m.paid} paid)` : ''}`}><NumInput value={m.remainingMonths} step={1} onChange={(v) => update('remainingMonths', Math.round(v))} /></Field>
          <Field label="Bank spread (%)"><NumInput value={m.spread} step={0.05} onChange={(v) => update('spread', v)} /></Field>
          <Field label="Euribor tenor">
            <select value={m.tenor} onChange={(e) => update('tenor', e.target.value as Tenor)} className={inp}>
              {TENORS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Next revision month">
            <input type="month" value={m.resetMonth} onChange={(e) => update('resetMonth', e.target.value)} className={inp} />
          </Field>
        </div>
        {importErr && <p className="text-sm text-red-500 mt-3">{importErr}</p>}
        <p className="text-[11px] text-gray-400 mt-3">
          Effective rate = Euribor + spread = <strong>{effRate.toFixed(3)}%</strong>. Revision rate uses the ECB monthly-average {m.tenor} Euribor of the month <strong>before</strong> the revision + spread; PT loans reset the payment the following month. (ECB has no daily Euribor, so incomplete months use the latest published month as an estimate.) Import pulls balance + payment from the latest instalment.
        </p>
      </div>

      {/* Reset projection */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card label={`Latest ${m.tenor} Euribor`} value={pct(latestMonthly?.rate ?? null)}
          sub={latestMonthly ? `ECB monthly avg · ${latestMonthly.period}` : '—'} />
        <Card label={refMonth ? `${monthName(refMonth)} avg${refComplete ? '' : ' (est.)'}` : 'Reference month'}
          value={pct(refAvg)} sub={refComplete ? 'ECB monthly' : 'latest published (est.)'} />
        <Card label="Projected rate" value={pct(projectedRate)} sub={`${m.tenor} + ${m.spread.toFixed(2)}% spread`} accent />
        <Card label={reset ? `Next payment · ${monthName(reset)}→` : 'Projected payment'}
          value={projectedPayment != null ? money(projectedPayment) : '—'}
          sub={delta != null ? `${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))}/mo vs now` : 'set balance + reset month'}
          good={(delta ?? 0) < 0} bad={(delta ?? 0) > 0} />
      </div>

      {/* Euribor trend (monthly averages) */}
      {monthly.length > 0 && (
        <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line mb-6">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">{m.tenor} Euribor · monthly average (ECB)</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthly} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} tickFormatter={(v) => `${v.toFixed(2)}%`} />
              <Tooltip contentStyle={{ background: '#171717', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v.toFixed(3)}%`} />
              <Line type="monotone" dataKey="rate" stroke="rgb(var(--brand-500))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Amortization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="grid grid-cols-2 gap-4 lg:col-span-1 lg:grid-cols-1 content-start">
          <Card label="Current payment" value={money(currentPayment)} sub="prestação now" />
          <Card label="Scheduled payoff"
            value={amort.never ? 'Never' : amort.payoff > 0 ? `${(amort.payoff / 12).toFixed(1)}y` : '—'}
            sub={amort.never ? 'payment ≤ interest' : amort.payoff > 0 ? `${amort.payoff} months` : ''} />
          <Card label="Total interest (to payoff)" value={amort.payoff > 0 ? money(amort.totalInterest) : '—'} />
        </div>
        <div className="lg:col-span-2 bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Balance over time (current rate)</p>
          <div className={`relative ${hidden ? 'blur-sm select-none pointer-events-none' : ''}`}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={amort.pts} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `${Math.round(v / 12)}y`} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#171717', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => money(v)} labelFormatter={(l) => `Month ${l}`} />
                <Line type="monotone" dataKey="balance" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </main>
  );
}

const inp = 'bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg px-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500 w-full';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-400 normal-case">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumInput({ value, step, onChange }: { value: number; step: number; onChange: (v: number) => void }) {
  return (
    <input type="number" step={step} value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className={inp} />
  );
}

function Card({ label, value, sub, accent, good, bad }: { label: string; value: string; sub?: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="bg-white dark:bg-surface p-5 rounded-xl border border-gray-200 dark:border-line">
      <p className="label-caps text-gray-400 dark:text-ink-muted">{label}</p>
      <p className={`font-num text-2xl mt-2.5 ${good ? 'text-green-600 dark:text-gain' : bad ? 'text-red-500 dark:text-loss' : accent ? 'text-indigo-600 dark:text-brand-500' : 'dark:text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-ink-faint mt-1">{sub}</p>}
    </div>
  );
}
