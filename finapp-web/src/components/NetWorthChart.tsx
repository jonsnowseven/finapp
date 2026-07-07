'use client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function NetWorthChart({ data }: { data: { as_of: string; total: number }[] }) {
  return (
    <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm">
      <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Net worth over time</p>
      {data.length < 2 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          Building history — a point is saved each day you open the dashboard. Come back tomorrow.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#D4AF37" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" />
            <XAxis dataKey="as_of" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
              tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={70}
              tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: any) => [`€${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 0 })}`, 'Net worth']}
              contentStyle={{ background: '#111', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, fontSize: 12 }}
            />
            <Area type="monotone" dataKey="total" stroke="#D4AF37" strokeWidth={2} fill="url(#nwGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
