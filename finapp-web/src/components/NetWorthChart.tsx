'use client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useBrandColor } from '../lib/useBrandColor';
import Card from './Card';

export default function NetWorthChart({ data }: { data: { as_of: string; total: number }[] }) {
  const brand = useBrandColor('500');

  return (
    <Card hover={false}>
      <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Net worth over time</p>
      {data.length < 2 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          Building history — a point is saved each day you open the dashboard. Come back tomorrow.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={brand} stopOpacity={0.4} />
                <stop offset="95%" stopColor={brand} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis dataKey="as_of" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              tickFormatter={(v: string) => v.slice(0, 7)} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={70}
              tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: any) => [`€${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 0 })}`, 'Net worth']}
              contentStyle={{ background: '#111', border: `1px solid ${brand}66`, borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: '#e5e7eb' }}
            />
            <Area type="monotone" dataKey="total" stroke={brand} strokeWidth={2.5} fill="url(#nwGrad)" dot={false}
              isAnimationActive animationDuration={800} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
