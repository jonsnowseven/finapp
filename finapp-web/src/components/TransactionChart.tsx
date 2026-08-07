'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { entityHex } from '../lib/entities';

interface Transaction {
  date: string;
  entity: string;
  asset_name: string;
}

interface ChartDataPoint {
  date: string;
  count: number;
  [entity: string]: number | string;
}

function buildChartData(transactions: Transaction[]): { data: ChartDataPoint[]; entities: string[] } {
  const byDate: Record<string, ChartDataPoint> = {};
  const entitySet = new Set<string>();

  for (const tx of transactions) {
    const d = tx.date.slice(0, 10);
    entitySet.add(tx.entity);
    if (!byDate[d]) byDate[d] = { date: d, count: 0 };
    byDate[d].count = (byDate[d].count as number) + 1;
    byDate[d][tx.entity] = ((byDate[d][tx.entity] as number) ?? 0) + 1;
  }

  // Ensure every entity key exists on every point (recharts stacking needs 0, not undefined)
  const entities = Array.from(entitySet).sort();
  const data = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  for (const point of data) {
    for (const e of entities) {
      if (point[e] === undefined) point[e] = 0;
    }
  }

  return { data, entities };
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point: ChartDataPoint = payload[0].payload;

  const rows = payload
    .filter((p: any) => (p.value as number) > 0)
    .sort((a: any, b: any) => b.value - a.value);

  return (
    <div className="bg-white dark:bg-surface-2 border border-gray-200 dark:border-line rounded-xl shadow-lg p-4 text-xs min-w-[180px]">
      <p className="font-bold text-gray-900 dark:text-white mb-2">{label}</p>
      <p className="text-gray-500 dark:text-gray-400 mb-3">
        <span className="font-semibold text-indigo-600 dark:text-brand-400">{point.count}</span> transaction{point.count !== 1 ? 's' : ''}
      </p>

      <p className="text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">By Institution</p>
      {rows.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4 text-gray-700 dark:text-gray-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.dataKey}
          </span>
          <span className="font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

interface ChartProps {
  transactions: Transaction[];
  legendEntities?: string[];          // full entity set for the legend (filter control)
  activeEntity?: string;              // currently selected filter ('All' = none)
  onEntityClick?: (entity: string) => void;
}

export default function TransactionChart({ transactions, legendEntities, activeEntity, onEntityClick }: ChartProps) {
  const { data, entities } = buildChartData(transactions);

  if (data.length === 0) return null;

  // Legend shows the full set when provided, so filtering to one entity still
  // lets you switch to another.
  const legend = legendEntities ?? entities;
  const hasFilter = !!activeEntity && activeEntity !== 'All';

  return (
    <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm mb-6 transition-colors duration-200">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="label-caps text-gray-400 dark:text-ink-muted">
          Transaction Activity
        </p>
        {/* Legend — clickable to filter by entity */}
        <div className="flex items-center gap-3 flex-wrap">
          {legend.map((e) => {
            const active = activeEntity === e;
            const dimmed = hasFilter && !active;
            return (
              <button
                key={e}
                type="button"
                onClick={() => onEntityClick?.(active ? 'All' : e)}
                title={onEntityClick ? (active ? 'Clear filter' : `Filter to ${e}`) : undefined}
                className={`flex items-center gap-1.5 text-xs transition-opacity ${onEntityClick ? 'cursor-pointer hover:opacity-100' : 'cursor-default'} ${dimmed ? 'opacity-40' : 'opacity-100'} ${active ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'}`}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entityHex(e) }} />
                {e}
              </button>
            );
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            {entities.map((e) => (
              <linearGradient key={e} id={`grad-${e.replace(/\s+/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={entityHex(e)} stopOpacity={0.5} />
                <stop offset="95%" stopColor={entityHex(e)} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-line" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v.slice(0, 7)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {entities.map((e) => (
            <Area
              key={e}
              type="monotone"
              dataKey={e}
              stackId="1"
              stroke={entityHex(e)}
              strokeWidth={1.5}
              fill={`url(#grad-${e.replace(/\s+/g, '-')})`}
              dot={false}
              isAnimationActive
              animationDuration={800}
              animationEasing="ease-out"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
