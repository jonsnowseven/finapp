'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ImportModal from '../../components/ImportModal';
import { legoRate } from '../../lib/lego';
import { RefreshCw, Upload, Plus } from 'lucide-react';
import { useHideBalance } from '../../lib/useHideBalance';

interface LegoSet {
  set_no: string;
  name: string;
  theme: string | null;
  retail: number | null;
  paid: number | null;
  value: number | null;
  qty_new: number;
  qty_used: number;
  growth_pct: number | null;
  annual_pct: number | null;
}

const fmt = (n: number) => `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateOf = (s: LegoSet) => s.annual_pct ?? legoRate(s.theme);
const forecast = (value: number, pct: number, years: number) => value * Math.pow(1 + pct / 100, years);

export default function LegoPage() {
  const { money: show } = useHideBalance();
  const [sets, setSets] = useState<LegoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [years, setYears] = useState(10);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const fetchSets = useCallback(async () => {
    const { data } = await supabase.from('lego_sets').select('*').order('value', { ascending: false });
    if (data) setSets(data as LegoSet[]);
  }, []);
  useEffect(() => { fetchSets().finally(() => setLoading(false)); }, [fetchSets]);

  async function handleRefresh() { setRefreshing(true); await fetchSets(); setRefreshing(false); }

  // Persist a per-set field edit (e.g. annual_pct override)
  async function saveField(set_no: string, field: keyof LegoSet, value: number) {
    setSets((prev) => prev.map((s) => (s.set_no === set_no ? { ...s, [field]: value } : s)));
    await fetch('/api/lego', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_no, [field]: value }),
    });
  }

  async function remove(set_no: string) {
    if (!confirm(`Remove ${set_no}?`)) return;
    await fetch(`/api/lego?set_no=${encodeURIComponent(set_no)}`, { method: 'DELETE' });
    fetchSets();
  }

  const totals = useMemo(() => {
    let paid = 0, value = 0, fc = 0;
    for (const s of sets) {
      paid += s.paid ?? 0;
      value += s.value ?? 0;
      fc += forecast(s.value ?? 0, rateOf(s), years);
    }
    return { paid, value, gain: value - paid, forecast: fc };
  }, [sets, years]);

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      {showImport && (
        <ImportModal
          title="Import LEGO sets"
          description="Upload a BrickEconomy-style portfolio PDF"
          endpoint="/api/import/lego"
          hint="Copy the table from your BrickEconomy collection/portfolio, paste it into Google Sheets (or Excel), then export/print that sheet as PDF (columns: Set, Name, Theme, Retail, Paid, Value, New, Used, Growth%)."
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); handleRefresh(); }}
        />
      )}
      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); handleRefresh(); }} />}

      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold">LEGO Investments</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Sets held for appreciation, with a research-based forecast per theme.</p>
        </div>
        <div className="flex items-center gap-2 mt-1 shrink-0">
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3"><Plus size={14} />Add set</button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3"><Upload size={14} />Import</button>
          <button onClick={handleRefresh} disabled={refreshing} title="Refresh" className="px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 disabled:opacity-50"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gold-500/50 animate-pulse">Loading…</div>
      ) : sets.length === 0 ? (
        <div className="text-gray-400">No sets yet — Import a PDF or Add a set.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card label="Paid" value={show(totals.paid)} />
            <Card label="Current value" value={show(totals.value)} accent />
            <Card label="Unrealised gain" value={`${show(totals.gain)} (${totals.paid ? ((totals.gain / totals.paid) * 100).toFixed(1) : '0'}%)`} />
            <div className="bg-white dark:bg-surface p-5 rounded-2xl border border-gray-200 dark:border-line">
              <p className="text-sm font-medium text-gray-400 uppercase tracking-wider">Forecast · {years}y</p>
              <p className="text-2xl font-bold mt-1 text-indigo-600 dark:text-gold-400">{show(totals.forecast)}</p>
              <input type="range" min={1} max={30} value={years} onChange={(e) => setYears(Number(e.target.value))} className="w-full mt-2 accent-indigo-600 dark:accent-gold-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[920px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-surface-2 border-b border-gray-200 dark:border-line label-caps text-gray-500 dark:text-gold-500">
                  <th className="p-3">Set</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Theme</th>
                  <th className="p-3 text-right">Retail</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3 text-right">Value</th>
                  <th className="p-3 text-right">New</th>
                  <th className="p-3 text-right">Used</th>
                  <th className="p-3 text-right">Growth%</th>
                  <th className="p-3 text-right" title="Assumed annual appreciation. Defaults from theme research — editable.">Annual%</th>
                  <th className="p-3 text-right">Forecast · {years}y</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                {sets.map((s) => (
                  <tr key={s.set_no} className="hover:bg-gray-50 dark:hover:bg-surface-3">
                    <td className="p-3 font-mono text-xs">
                      <a href={`https://www.brickeconomy.com/set/${s.set_no}/`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-gold-400 hover:underline" title="View on BrickEconomy">{s.set_no}</a>
                    </td>
                    <td className="p-3 font-semibold text-gray-900 dark:text-white">{s.name}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{s.theme}</td>
                    <td className="p-3 text-right text-gray-600 dark:text-gray-300">{s.retail != null ? show(s.retail) : '—'}</td>
                    <td className="p-3 text-right text-gray-600 dark:text-gray-300">{s.paid != null ? show(s.paid) : '—'}</td>
                    <td className="p-3 text-right font-medium dark:text-white">{s.value != null ? show(s.value) : '—'}</td>
                    <td className="p-3 text-right text-gray-600 dark:text-gray-300">{s.qty_new}</td>
                    <td className="p-3 text-right text-gray-600 dark:text-gray-300">{s.qty_used}</td>
                    <td className={`p-3 text-right ${(s.growth_pct ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{s.growth_pct != null ? `${s.growth_pct.toFixed(1)}%` : '—'}</td>
                    <td className="p-3 text-right">
                      <input
                        type="number" step={0.5} value={rateOf(s)}
                        onChange={(e) => saveField(s.set_no, 'annual_pct', Number(e.target.value))}
                        className="w-20 text-right bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500"
                        title={s.annual_pct == null ? 'Theme default (research) — type to override' : 'Custom override'}
                      />
                    </td>
                    <td className="p-3 text-right font-bold dark:text-white">{show(forecast(s.value ?? 0, rateOf(s), years))}</td>
                    <td className="p-3 text-right"><button onClick={() => remove(s.set_no)} className="text-gray-300 hover:text-red-500 transition-colors" title="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 max-w-3xl leading-relaxed">
            Forecast compounds the current value at the assumed annual rate. Per-theme defaults are
            rough aftermarket averages for retired sets (editable), not guarantees — condition,
            completeness and demand drive real prices, and sets can fall in value.
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
      <p className={`font-num text-2xl mt-2 ${accent ? 'text-indigo-600 dark:text-gold-500' : 'dark:text-ink'}`}>{value}</p>
    </div>
  );
}

// Manual add — with a live forecast preview (the "small component on import").
function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ set_no: '', name: '', theme: '', paid: '', value: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const value = parseFloat(f.value) || 0;
  const rate = legoRate(f.theme);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.set_no.trim()) { setErr('Set number required.'); return; }
    setSaving(true); setErr(null);
    const res = await fetch('/api/lego', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        set_no: f.set_no.trim(), name: f.name.trim() || f.set_no.trim(), theme: f.theme.trim() || null,
        paid: parseFloat(f.paid) || null, value: value || null, qty_new: 1,
      }),
    });
    if (!res.ok) { setErr((await res.json()).error ?? 'Failed'); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add LEGO set</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="space-y-3">
          <Field label="Set number" placeholder="75192-1" value={f.set_no} onChange={set('set_no')} />
          <Field label="Name" placeholder="Millennium Falcon" value={f.name} onChange={set('name')} />
          <Field label="Theme" placeholder="Star Wars / Ultimate Collector Series" value={f.theme} onChange={set('theme')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid (€)" type="number" value={f.paid} onChange={set('paid')} />
            <Field label="Value (€)" type="number" value={f.value} onChange={set('value')} />
          </div>

          {/* Live forecast preview */}
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-surface-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-600 dark:text-gray-300">Forecast preview</span> — theme rate ≈ <strong>{rate}%/yr</strong>{f.theme ? '' : ' (default)'}.
            {value > 0 ? <> In 10y ≈ <strong className="text-indigo-600 dark:text-gold-400">{fmt(forecast(value, rate, 10))}</strong>, 20y ≈ <strong className="text-indigo-600 dark:text-gold-400">{fmt(forecast(value, rate, 20))}</strong>.</> : <> Enter a value to preview.</>}
          </div>

          {err && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{err}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 dark:bg-gold-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-gold-600 disabled:opacity-50">{saving ? 'Saving…' : 'Add set'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-line text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-3">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-400 normal-case">{label}</span>
      <input {...props} className="w-full mt-1 bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500" />
    </label>
  );
}
