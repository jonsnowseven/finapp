'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { entityHex } from '../lib/entities';

const fmt = (n: number) => `€${n.toLocaleString('pt-PT', { maximumFractionDigits: 0 })}`;

export default function AllocationPie({ data }: { data: { name: string; value: number }[] }) {
  const slices = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const total = slices.reduce((a, d) => a + d.value, 0);
  if (!slices.length || total <= 0) return null;

  return (
    <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm">
      <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Allocation</p>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <ResponsiveContainer width="100%" height={220} className="max-w-[260px]">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2} stroke="none">
              {slices.map((d) => <Cell key={d.name} fill={entityHex(d.name)} />)}
            </Pie>
            <Tooltip
              formatter={(v: any, n: any) => [`${fmt(Number(v))} (${((Number(v) / total) * 100).toFixed(1)}%)`, n]}
              contentStyle={{ background: '#111', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 12, fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 w-full space-y-1.5">
          {slices.map((d) => (
            <div key={d.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entityHex(d.name) }} />
                {d.name}
              </span>
              <span className="text-gray-500 dark:text-gray-400">{((d.value / total) * 100).toFixed(1)}% · {fmt(d.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
