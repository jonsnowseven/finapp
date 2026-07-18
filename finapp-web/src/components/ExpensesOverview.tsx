'use client';
import { useMemo } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { countsInTotals, tagColor, merchantKey } from '../lib/expenses';

interface Row { date: string; amount: number; tag: string; tag_label: string | null; merchant: string | null }

const MONTHS = 12;
const TOP_TAGS = 5;

function monthKeys(n: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const label = (k: string) => {
  const [y, m] = k.split('-');
  const s = new Date(Number(y), Number(m) - 1).toLocaleString('en', { month: 'short' });
  return m === '01' ? `${s} ${y.slice(2)}` : s;
};
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

export default function ExpensesOverview({ rows, money, hidden }: {
  rows: Row[]; money: (n: number) => string; hidden: boolean;
}) {
  const keys = useMemo(() => monthKeys(MONTHS), []);
  const keySet = useMemo(() => new Set(keys), [keys]);

  // Monthly expense/income/net/savings-rate series.
  const series = useMemo(() => {
    const agg: Record<string, { exp: number; inc: number }> = {};
    keys.forEach((k) => (agg[k] = { exp: 0, inc: 0 }));
    for (const r of rows) {
      const k = r.date.slice(0, 7);
      if (!keySet.has(k) || !countsInTotals(r.tag)) continue;
      const a = Number(r.amount);
      if (a < 0) agg[k].exp += -a; else agg[k].inc += a;
    }
    return keys.map((k) => {
      const { exp, inc } = agg[k];
      return { month: label(k), exp: Math.round(exp), inc: Math.round(inc), net: Math.round(inc - exp), rate: inc > 0 ? Math.round(((inc - exp) / inc) * 100) : 0 };
    });
  }, [rows, keys, keySet]);

  // KPIs
  const kpi = useMemo(() => {
    const exp = series.map((s) => s.exp);
    const thisMo = exp[exp.length - 1] ?? 0;
    const prior3 = exp.slice(-4, -1);
    const avg3 = prior3.length ? prior3.reduce((a, b) => a + b, 0) / prior3.length : 0;
    const deltaPct = avg3 > 0 ? ((thisMo - avg3) / avg3) * 100 : null;
    const withData = exp.filter((e) => e > 0);
    const avgMo = withData.length ? withData.reduce((a, b) => a + b, 0) / withData.length : 0;
    const yr = new Date().getFullYear();
    let ytd = 0, incYtd = 0;
    for (const r of rows) {
      if (!countsInTotals(r.tag) || !r.date.startsWith(String(yr))) continue;
      const a = Number(r.amount);
      if (a < 0) ytd += -a; else incYtd += a;
    }
    const savings = incYtd > 0 ? ((incYtd - ytd) / incYtd) * 100 : null;
    return { thisMo, avg3, deltaPct, avgMo, ytd, savings };
  }, [series, rows]);

  // Category-over-time (top tags + Other) + top movers (this vs prev month).
  const cat = useMemo(() => {
    const totals: Record<string, { label: string; total: number }> = {};
    for (const r of rows) {
      const k = r.date.slice(0, 7);
      if (!keySet.has(k) || !countsInTotals(r.tag) || Number(r.amount) >= 0) continue;
      if (!totals[r.tag]) totals[r.tag] = { label: r.tag_label ?? r.tag, total: 0 };
      totals[r.tag].total += -Number(r.amount);
    }
    const ranked = Object.entries(totals).sort((a, b) => b[1].total - a[1].total);
    const top = ranked.slice(0, TOP_TAGS).map(([tag, v]) => ({ tag, label: v.label }));
    const topSet = new Set(top.map((t) => t.tag));

    const data = keys.map((k) => {
      const row: Record<string, number | string> = { month: label(k) };
      top.forEach((t) => (row[t.label] = 0));
      row['Other'] = 0;
      return row;
    });
    const idx: Record<string, number> = {};
    keys.forEach((k, i) => (idx[k] = i));
    for (const r of rows) {
      const k = r.date.slice(0, 7);
      if (!keySet.has(k) || !countsInTotals(r.tag) || Number(r.amount) >= 0) continue;
      const t = totals[r.tag];
      const bucket = topSet.has(r.tag) ? (t.label) : 'Other';
      (data[idx[k]][bucket] as number) += -Number(r.amount);
    }
    data.forEach((d) => Object.keys(d).forEach((kk) => { if (kk !== 'month') d[kk] = Math.round(d[kk] as number); }));

    const bars = [...top.map((t) => ({ key: t.label, color: tagColor(t.tag).fg })), { key: 'Other', color: '#6b7280' }];

    // top movers: current vs previous month per tag
    const cur = keys[keys.length - 1], prv = keys[keys.length - 2];
    const per = (mk: string) => {
      const m: Record<string, { label: string; v: number }> = {};
      for (const r of rows) {
        if (r.date.slice(0, 7) !== mk || !countsInTotals(r.tag) || Number(r.amount) >= 0) continue;
        if (!m[r.tag]) m[r.tag] = { label: r.tag_label ?? r.tag, v: 0 };
        m[r.tag].v += -Number(r.amount);
      }
      return m;
    };
    const c = per(cur), p = per(prv);
    const allTags = new Set(Object.keys(c).concat(Object.keys(p)));
    const movers = Array.from(allTags).map((tg) => ({
      tag: tg, label: (c[tg] ?? p[tg]).label, delta: (c[tg]?.v ?? 0) - (p[tg]?.v ?? 0),
    })).filter((x) => Math.abs(x.delta) >= 1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);

    return { data, bars, movers };
  }, [rows, keys, keySet]);

  // Recurring / subscriptions: same merchant-key, ~monthly, stable amount.
  const recurring = useMemo(() => {
    const g: Record<string, { label: string; amts: number[]; months: Set<string> }> = {};
    for (const r of rows) {
      if (!countsInTotals(r.tag) || Number(r.amount) >= 0) continue;
      const key = merchantKey(r.merchant);
      if (!key) continue;
      if (!g[key]) g[key] = { label: key, amts: [], months: new Set() };
      g[key].amts.push(-Number(r.amount));
      g[key].months.add(r.date.slice(0, 7));
    }
    return Object.values(g).map((v) => {
      const mean = v.amts.reduce((a, b) => a + b, 0) / v.amts.length;
      const sd = Math.sqrt(v.amts.reduce((a, b) => a + (b - mean) ** 2, 0) / v.amts.length);
      return { label: v.label, months: v.months.size, typical: median(v.amts), cv: mean > 0 ? sd / mean : 1 };
    }).filter((x) => x.months >= 3 && x.cv < 0.35)
      .sort((a, b) => b.typical - a.typical).slice(0, 10);
  }, [rows]);

  const eur0 = (v: number) => `€${Math.round(v).toLocaleString('pt-PT')}`;
  // `relative` contains recharts' absolute resize-detector so it can't overlay
  // (and intercept clicks on) the rest of the page.
  const blur = `relative ${hidden ? 'blur-sm select-none pointer-events-none' : ''}`;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="This month" value={money(kpi.thisMo)}
          sub={kpi.deltaPct == null ? 'vs 3-mo avg —' : `${kpi.deltaPct >= 0 ? '+' : ''}${kpi.deltaPct.toFixed(0)}% vs 3-mo avg`}
          bad={(kpi.deltaPct ?? 0) > 0} />
        <Kpi label="Avg / month" value={money(kpi.avgMo)} sub={`last ${MONTHS} mo`} />
        <Kpi label="YTD spend" value={money(kpi.ytd)} sub={`${new Date().getFullYear()}`} />
        <Kpi label="Savings rate" value={kpi.savings == null ? '—' : `${kpi.savings.toFixed(0)}%`} sub="YTD income vs spend"
          good={(kpi.savings ?? 0) >= 20} bad={(kpi.savings ?? 100) < 0} />
      </div>

      {/* Trend */}
      <Card title="Cashflow · last 12 months">
        <div className={blur}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={38} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number, n: string) => (n === 'Savings %' ? `${v}%` : eur0(v))}
                contentStyle={{ background: '#171717', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="exp" name="Expenses" fill="#ff6b6b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="inc" name="Income" fill="#3ce36a" radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="rate" name="Savings %" stroke="#ffd700" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category over time */}
        <Card title="Spend by category · 12 mo" className="lg:col-span-2">
          <div className={blur}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={cat.data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => eur0(v)}
                  contentStyle={{ background: '#171717', border: '1px solid #282828', borderRadius: 8, fontSize: 12 }} />
                {cat.bars.map((b) => (
                  <Bar key={b.key} dataKey={b.key} stackId="a" fill={b.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Top movers */}
          {cat.movers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="label-caps text-gray-400 dark:text-ink-muted self-center">Top movers vs last mo:</span>
              {cat.movers.map((m) => (
                <span key={m.tag} className={`text-xs px-2 py-0.5 rounded-full ${m.delta > 0 ? 'text-red-500 dark:text-loss bg-red-500/10' : 'text-green-600 dark:text-gain bg-green-500/10'}`}>
                  {m.label} {m.delta > 0 ? '+' : '−'}{money(Math.abs(m.delta))}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Recurring */}
        <Card title="Recurring / subscriptions">
          {recurring.length === 0 ? (
            <p className="text-sm text-gray-400">None detected yet (needs ≥3 months of data).</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {recurring.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-gray-700 dark:text-ink" title={r.label}>{r.label}</span>
                    <span className="font-num text-gray-500 dark:text-ink-muted whitespace-nowrap">{money(r.typical)}<span className="text-gray-400 dark:text-ink-faint">/mo · {r.months}×</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 pt-3 border-t border-gray-100 dark:border-line text-sm flex justify-between">
                <span className="label-caps text-gray-400 dark:text-ink-muted self-center">Est. committed</span>
                <strong className="font-num dark:text-ink">{money(recurring.reduce((a, r) => a + r.typical, 0))}/mo</strong>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, good, bad }: { label: string; value: string; sub?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="bg-white dark:bg-surface p-5 rounded-xl border border-gray-200 dark:border-line">
      <p className="label-caps text-gray-400 dark:text-ink-muted">{label}</p>
      <p className={`font-num text-2xl mt-2.5 ${good ? 'text-green-600 dark:text-gain' : bad ? 'text-red-500 dark:text-loss' : 'dark:text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-ink-faint mt-1">{sub}</p>}
    </div>
  );
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line ${className}`}>
      <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">{title}</p>
      {children}
    </div>
  );
}
