'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ShieldAlert, Copy, Check, Trash2, RefreshCw } from 'lucide-react';

interface LegacyRow {
  id: string;
  category: string | null;
  name: string;
  platform: string | null;
  password_location: string | null;
  two_fa: string | null;
  is_physical: boolean | null;
  storage: string | null;
  notes: string | null;
}

const CATEGORIES = ['Investments', 'Banking', 'Crypto', 'Insurance', 'Government', 'Documents', 'Other'];
const COLS: { key: keyof LegacyRow; label: string }[] = [
  { key: 'platform', label: 'Site / Platform' },
  { key: 'password_location', label: 'Password location' },
  { key: 'two_fa', label: '2FA' },
  { key: 'notes', label: 'Notes' },
];

// Copy-table output is Portuguese (PT-PT) — the report is meant for family,
// not for the app's own UI. Only our own labels get translated; free-text
// row content (names, notes, password hints) is copied verbatim as typed.
const PT_HEADER = ['Categoria', 'Nome', 'Site / Plataforma', 'Localização da Password', 'Autenticação de Dois Fatores (2FA)', 'Notas', 'Físico?', 'Armazenamento'];
const PT_CATEGORY: Record<string, string> = {
  Investments: 'Investimentos',
  Banking: 'Banca',
  Crypto: 'Criptomoedas',
  Insurance: 'Seguros',
  Government: 'Estado',
  Documents: 'Documentos',
  Other: 'Outro',
};

const inp = 'bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg px-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function LegacyPage() {
  const [rows, setRows] = useState<LegacyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Add form
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase.from('legacy_accounts').select('*').order('category').order('name');
    if (!error && data) setRows(data);
  }, []);

  useEffect(() => { fetchRows().finally(() => setLoading(false)); }, [fetchRows]);

  async function addRow() {
    setErr(null);
    if (!name.trim()) { setErr('Name required.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, name, platform }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'Add failed.'); return; }
      setName(''); setPlatform('');
      await fetchRows();
    } catch {
      setErr('Network error.');
    } finally {
      setSaving(false);
    }
  }

  async function patchRow(id: string, field: string, value: string | boolean) {
    const stored = typeof value === 'boolean' ? value : value || null;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: stored } : r)));
    await fetch('/api/legacy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [field]: value }),
    });
  }

  async function deleteRow(id: string) {
    if (!confirm('Remove this row from the legacy report?')) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/legacy?id=${id}`, { method: 'DELETE' });
  }

  // Pulls in platforms already tracked elsewhere in FinApp (transactions +
  // valuations entities, plus LEGO if any sets are held) that aren't in the
  // report yet, so you don't have to retype what the app already knows about.
  async function syncTracked() {
    setSyncing(true);
    try {
      const [{ data: tx }, { data: val }, { data: lego }] = await Promise.all([
        supabase.from('transactions').select('entity'),
        supabase.from('valuations').select('entity'),
        supabase.from('lego_sets').select('id').limit(1),
      ]);
      const tracked = new Set<string>([
        ...(tx ?? []).map((r: any) => r.entity),
        ...(val ?? []).map((r: any) => r.entity),
        ...((lego && lego.length > 0) ? ['LEGO'] : []),
      ]);
      const existing = new Set(rows.map((r) => r.name.toLowerCase()));
      const missing = Array.from(tracked).filter((e) => e && !existing.has(e.toLowerCase()));

      for (const entity of missing) {
        await fetch('/api/legacy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'Investments', name: entity }),
        });
      }
      if (missing.length) await fetchRows();
    } finally {
      setSyncing(false);
    }
  }

  async function copyTable() {
    const rowValues = (r: LegacyRow) => [
      (r.category && PT_CATEGORY[r.category]) || r.category || '',
      r.name,
      ...COLS.map((c) => (r[c.key] as string) ?? ''),
      r.is_physical ? 'Sim' : 'Não',
      r.storage ?? '',
    ];
    const html = `<table><thead><tr>${PT_HEADER.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${rowValues(r).map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
    // Markdown table for the plain-text payload — Google Docs still gets the
    // rendered HTML table above; markdown-aware apps (Notion, Obsidian, GitHub)
    // get real table syntax instead of a tab-separated dump.
    const mdCell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || ' ';
    const text = [
      `| ${PT_HEADER.map(mdCell).join(' | ')} |`,
      `| ${PT_HEADER.map(() => '---').join(' | ')} |`,
      ...rows.map((r) => `| ${rowValues(r).map(mdCell).join(' | ')} |`),
    ].join('\n');

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="max-w-6xl mx-auto p-6 md:p-8">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Digital Legacy Report</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">What your family would need to find your accounts if something happens to you.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncTracked} disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3 transition-colors disabled:opacity-50">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Add tracked platforms'}
          </button>
          <button onClick={copyTable} disabled={rows.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 transition-colors disabled:opacity-50">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy table'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-300 mb-6">
        <ShieldAlert size={18} className="shrink-0 mt-0.5" />
        <span>Only note <strong>where</strong> a password or 2FA method lives — a password manager entry, a physical safe, a lawyer. Never type an actual password or seed phrase into any field here; this table is stored in the database as plain text.</span>
      </div>

      {/* Add form */}
      <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <label className="text-xs block">
            <span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inp} w-full`}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs block">
            <span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Interactive Brokers" className={`${inp} w-full`} />
          </label>
          <label className="text-xs block">
            <span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">Site / Platform (optional)</span>
            <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. ibkr.com" className={`${inp} w-full`} />
          </label>
          <button onClick={addRow} disabled={saving} className="px-4 py-2 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add row'}
          </button>
        </div>
        {err && <p className="text-sm text-red-500 mt-3">{err}</p>}
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-brand-500/50 animate-pulse">Loading…</div>
      ) : (
        <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-surface-2 border-b border-gray-200 dark:border-line label-caps text-gray-500 dark:text-brand-500">
                  <th className="p-3">Category</th>
                  <th className="p-3">Name</th>
                  {COLS.map((c) => <th key={c.key} className="p-3">{c.label}</th>)}
                  <th className="p-3 text-center">Physical?</th>
                  <th className="p-3">Storage</th>
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50 text-sm">
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-gray-400 dark:text-gray-500">No rows yet. Add one above, or pull in tracked platforms.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-surface-3 transition-colors group">
                    <td className="p-3">
                      <select value={r.category ?? ''} onChange={(e) => patchRow(r.id, 'category', e.target.value)} className={`${inp} text-xs`}>
                        <option value="">—</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="p-3 font-semibold text-gray-900 dark:text-white whitespace-nowrap">{r.name}</td>
                    {COLS.map((c) => (
                      <td key={c.key} className="p-3">
                        <EditableCell value={(r[c.key] as string) ?? ''} onSave={(v) => patchRow(r.id, c.key, v)} />
                      </td>
                    ))}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!r.is_physical}
                        onChange={(e) => patchRow(r.id, 'is_physical', e.target.checked)}
                        className="accent-indigo-600 dark:accent-brand-500 cursor-pointer"
                      />
                    </td>
                    <td className="p-3">
                      <EditableCell value={r.storage ?? ''} onSave={(v) => patchRow(r.id, 'storage', v)} />
                    </td>
                    <td className="p-3">
                      <button onClick={() => deleteRow(r.id)} title="Remove row"
                        className="text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function EditableCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button onClick={() => { setDraft(value); setEditing(true); }}
        className="text-left w-full text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-2 rounded px-1.5 py-1 -mx-1.5 transition-colors min-h-[26px]">
        {value || <span className="text-gray-300 dark:text-gray-600">—</span>}
      </button>
    );
  }

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      className={`${inp} w-full`}
    />
  );
}
