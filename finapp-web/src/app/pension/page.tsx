'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useHideBalance } from '../../lib/useHideBalance';

interface Scenario {
  scenario: 'early' | 'personal' | 'legal';
  title: string;
  note: string;
  retirement_date: string;   // YYYY-MM-DD
  gross: string;             // kept as string for the input
  access_age: string;
}

const DEFAULTS: Scenario[] = [
  { scenario: 'early',    title: 'Pensão antecipada',      note: 'Com penalização', retirement_date: '', gross: '', access_age: '' },
  { scenario: 'personal', title: 'Pensão na idade pessoal', note: 'Sem penalização', retirement_date: '', gross: '', access_age: '' },
  { scenario: 'legal',    title: 'Pensão na idade legal',   note: 'Com bonificação', retirement_date: '', gross: '', access_age: '' },
];

const noteStyle = (note: string) => {
  const n = note.toLowerCase();
  if (n.includes('penaliza') && !n.includes('sem')) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300';
  if (n.includes('bonifica')) return 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300';
  return 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300';
};

const fmt = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;

export default function PensionPage() {
  const { hidden } = useHideBalance();
  const [rows, setRows] = useState<Scenario[]>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('pension_sim').select('*');
    if (data && data.length) {
      setRows(DEFAULTS.map((d) => {
        const r = data.find((x) => x.scenario === d.scenario);
        return r ? {
          scenario: d.scenario,
          title: r.title ?? d.title,
          note: r.note ?? d.note,
          retirement_date: r.retirement_date ?? '',
          gross: r.gross != null ? String(r.gross) : '',
          access_age: r.access_age ?? '',
        } : d;
      }));
    }
  }, []);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  function set(scenario: string, field: keyof Scenario, value: string) {
    setRows((prev) => prev.map((r) => (r.scenario === scenario ? { ...r, [field]: value } : r)));
    setSaved(false);
  }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/pension', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarios: rows.map((r) => ({ ...r, gross: r.gross === '' ? null : Number(r.gross) })) }),
      });
      if (res.ok) setSaved(true);
    } finally { setSaving(false); }
  }

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold">Retirement Pension (Segurança Social)</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Enter the values from your Social Security simulation. Three scenarios: early, personal age, legal age.
          </p>
        </div>
        <button
          onClick={save} disabled={saving}
          className="shrink-0 mt-1 px-4 py-2 rounded-xl bg-indigo-600 dark:bg-gold-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-gold-600 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gold-500/50 animate-pulse">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {rows.map((r) => (
            <div key={r.scenario} className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line shadow-sm">
              <input
                value={r.title} onChange={(e) => set(r.scenario, 'title', e.target.value)}
                className="w-full text-lg font-bold bg-transparent outline-none dark:text-white border-b border-transparent focus:border-gray-300 dark:focus:border-gold-500/40"
              />
              <input
                type="date" value={r.retirement_date} onChange={(e) => set(r.scenario, 'retirement_date', e.target.value)}
                className="mt-3 w-full bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500"
              />
              <input
                value={r.note} onChange={(e) => set(r.scenario, 'note', e.target.value)}
                className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold outline-none ${noteStyle(r.note)}`}
              />

              <p className="mt-5 label-caps text-gray-400 dark:text-ink-muted">Valor bruto da pensão (€)</p>
              <div className={`flex items-baseline gap-1 mt-1 ${hidden ? 'blur-sm select-none pointer-events-none' : ''}`}>
                <input
                  type="number" step="0.01" value={r.gross} onChange={(e) => set(r.scenario, 'gross', e.target.value)}
                  placeholder="0,00"
                  className="w-40 text-3xl font-bold bg-transparent outline-none dark:text-white border-b border-gray-200 dark:border-line focus:border-indigo-500 dark:focus:border-gold-500"
                />
                <span className="text-2xl font-bold dark:text-white">€</span>
              </div>

              <p className="mt-5 label-caps text-gray-400 dark:text-ink-muted">Idade de acesso</p>
              <input
                value={r.access_age} onChange={(e) => set(r.scenario, 'access_age', e.target.value)}
                placeholder="64 anos e 11 meses"
                className="mt-1 w-full bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500"
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-6 max-w-3xl leading-relaxed">
        Values are entered manually from the official Segurança Social simulator (gross monthly pension,
        before tax). They reflect that simulation's assumptions (e.g. projected salary growth).
        Image OCR auto-fill can be added later.
      </p>
    </main>
  );
}
