'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { EXPENSE_TAGS, validateTag, countsInTotals, tagColor, merchantKey } from '../../lib/expenses';
import ImportModal from '../../components/ImportModal';
import ExpensesOverview from '../../components/ExpensesOverview';
import EyeToggle from '../../components/EyeToggle';
import { useHideBalance } from '../../lib/useHideBalance';
import { Search } from 'lucide-react';

interface Expense {
  id: string;
  date: string;
  amount: number;
  currency: string;
  tag: string;
  tag_label: string | null;
  merchant: string | null;
  note: string | null;
  institution: string | null;
}

type SortKey = 'date' | 'tag' | 'merchant' | 'institution' | 'amount';

// Alphabetically-sorted presets for dropdowns only (does not change EXPENSE_TAGS order elsewhere).
const SORTED_TAGS = [...EXPENSE_TAGS].sort((a, b) => a.localeCompare(b));

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
// Shift a 'YYYY-MM' by n months (empty = all → start from the current month).
const shiftMonth = (m: string, n: number) => {
  const base = /^\d{4}-\d{2}$/.test(m) ? m : thisMonth();
  const [y, mo] = base.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function ExpensesPage() {
  const { money, hidden } = useHideBalance();
  const [view, setView] = useState<'list' | 'overview'>('list');
  const [showDel, setShowDel] = useState(false);
  const [delFrom, setDelFrom] = useState('');
  const [delTo, setDelTo] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(thisMonth());
  const [tagFilter, setTagFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [similarFor, setSimilarFor] = useState<Expense | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulking, setBulking] = useState(false);

  // Add form
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [tagSel, setTagSel] = useState<string>(EXPENSE_TAGS[0]);
  const [customTag, setCustomTag] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imp, setImp] = useState<'santander' | 'activobank' | null>(null);

  const fetchRows = useCallback(async () => {
    const { data } = await supabase.from('expenses').select('*').order('date', { ascending: false });
    if (data) setRows(data as Expense[]);
  }, []);
  useEffect(() => { fetchRows().finally(() => setLoading(false)); }, [fetchRows]);

  const monthRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!r.date.startsWith(month)) return false;
      if (tagFilter !== 'All' && r.tag !== tagFilter) return false;
      if (!q) return true;
      const abs = Math.abs(Number(r.amount));
      const hay = [
        r.merchant, r.tag_label ?? r.tag, r.note, r.date, r.institution,
        String(r.amount), abs.toFixed(2), abs.toFixed(2).replace('.', ','),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, month, tagFilter, query]);
  const counted = monthRows.filter((r) => countsInTotals(r.tag));
  const expensesTotal = counted.reduce((a, r) => a + (Number(r.amount) < 0 ? -Number(r.amount) : 0), 0);
  const incomeTotal = counted.reduce((a, r) => a + (Number(r.amount) > 0 ? Number(r.amount) : 0), 0);
  // Sum of every currently-shown row (respects month + tag filter, ignores exclusions).
  const filteredOut = monthRows.reduce((a, r) => a + (Number(r.amount) < 0 ? -Number(r.amount) : 0), 0);
  const byTag = useMemo(() => {
    const m: Record<string, { label: string; total: number }> = {};
    for (const r of rows.filter((x) => x.date.startsWith(month) && Number(x.amount) < 0 && countsInTotals(x.tag))) {
      const k = r.tag;
      if (!m[k]) m[k] = { label: r.tag_label ?? r.tag, total: 0 };
      m[k].total += -Number(r.amount);
    }
    return Object.entries(m).map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.total - a.total);
  }, [rows, month]);
  const maxTag = byTag[0]?.total ?? 0;
  const labelOf = (tag: string) => rows.find((r) => r.tag === tag)?.tag_label ?? tag;
  const allTags = ['All', ...Array.from(new Set(rows.map((r) => r.tag)))
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)))];

  const sortedRows = useMemo(() => {
    const arr = [...monthRows];
    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number, bv: string | number;
      if (key === 'amount') { av = Number(a.amount); bv = Number(b.amount); }
      else if (key === 'tag') { av = (a.tag_label ?? a.tag).toLowerCase(); bv = (b.tag_label ?? b.tag).toLowerCase(); }
      else if (key === 'merchant') { av = (a.merchant ?? '').toLowerCase(); bv = (b.merchant ?? '').toLowerCase(); }
      else if (key === 'institution') { av = (a.institution ?? 'Manual').toLowerCase(); bv = (b.institution ?? 'Manual').toLowerCase(); }
      else { av = a.date; bv = b.date; }
      return av < bv ? -mul : av > bv ? mul : 0;
    });
    return arr;
  }, [monthRows, sort]);

  const toggleSort = (k: SortKey) =>
    setSort((s) => s.key === k
      ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: k, dir: k === 'amount' || k === 'date' ? 'desc' : 'asc' });

  async function add() {
    setErr(null);
    const rawTag = tagSel === '__custom' ? customTag : tagSel;
    const v = validateTag(rawTag);
    if (!v.ok) { setErr(v.error ?? 'Invalid tag'); return; }
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt === 0) { setErr('Enter a non-zero amount.'); return; }
    // negative = expense, positive = income
    setSaving(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, amount: amt, tag: rawTag, merchant, note }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? 'Failed'); return; }
      setAmount(''); setMerchant(''); setCustomTag(''); setNote('');
      fetchRows();
    } finally { setSaving(false); }
  }

  async function updateTag(id: string, rawTag: string) {
    const v = validateTag(rawTag);
    if (!v.ok) { setErr(v.error ?? 'Invalid tag'); return; }
    const res = await fetch('/api/expenses', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, tag: rawTag }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error ?? 'Failed to re-tag'); return; }
    setErr(null); setEditingId(null); fetchRows();
  }

  function toggleRow(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function updateNote(id: string, text: string) {
    const res = await fetch('/api/expenses', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, note: text }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error ?? 'Failed to save note'); return; }
    setErr(null); setEditingNoteId(null); fetchRows();
  }

  async function bulkTag(rawTag: string) {
    const v = validateTag(rawTag);
    if (!v.ok) { setErr(v.error ?? 'Invalid tag'); return; }
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulking(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tag: rawTag }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? 'Bulk re-tag failed'); return; }
      setErr(null); setSelected(new Set()); fetchRows();
    } finally { setBulking(false); }
  }

  async function deleteRange() {
    if (!delFrom || !delTo) { setErr('Pick both a From and To date.'); return; }
    if (delFrom > delTo) { setErr('From date must be before To date.'); return; }
    const n = rows.filter((r) => r.date >= delFrom && r.date <= delTo).length;
    if (n === 0) { setErr('No expenses in that range.'); return; }
    if (!confirm(`Delete ${n} expense${n !== 1 ? 's' : ''} dated ${delFrom} to ${delTo}? This cannot be undone.`)) return;
    setDelBusy(true);
    try {
      const res = await fetch(`/api/expenses?from=${delFrom}&to=${delTo}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? 'Delete failed'); return; }
      setErr(null); setShowDel(false); setSelected(new Set()); fetchRows();
    } finally { setDelBusy(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/expenses?id=${id}`, { method: 'DELETE' });
    fetchRows();
  }

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      {imp === 'santander' && (
        <ImportModal title="Import Santander" description="Upload a Santander statement (PDF) or movements CSV"
          endpoint="/api/import/expenses/santander" accept=".pdf,.csv"
          hint="Santander → Conta → Extrato (PDF) or Movimentos → export as CSV. PDF consolidated statement supported."
          onClose={() => setImp(null)} onImported={() => { setImp(null); fetchRows(); }} />
      )}
      {imp === 'activobank' && (
        <ImportModal title="Import ActivoBank" description="Upload an ActivoBank statement (PDF) or history CSV"
          endpoint="/api/import/expenses/activobank" accept=".pdf,.csv"
          hint="ActivoBank → Conta → Extrato (PDF) or Histórico → export as CSV. PDF combined statement supported."
          onClose={() => setImp(null)} onImported={() => { setImp(null); fetchRows(); }} />
      )}
      {similarFor && (
        <SimilarExpensesPanel
          row={similarFor} rows={rows} money={money}
          onClose={() => setSimilarFor(null)}
          onRetag={(tag) => { updateTag(similarFor.id, tag); setSimilarFor(null); }}
          onSearch={(q) => { setQuery(q); setMonth(''); setTagFilter('All'); setSimilarFor(null); }}
        />
      )}

      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold">Expenses</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Track cashflow by tag. Import bank CSVs — all rows kept; transfers/investments/savings excluded from totals. Click a tag to re-assign it.</p>
        </div>
        <div className="flex items-center gap-2 mt-1 shrink-0">
          <EyeToggle />
          <div className="flex rounded-xl border border-gray-300 dark:border-line overflow-hidden mr-1">
            {(['list', 'overview'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${view === v ? 'bg-indigo-600 dark:bg-brand-500 text-white dark:text-black' : 'text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3'}`}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={() => setImp('santander')} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3">Import Santander</button>
          <button onClick={() => setImp('activobank')} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-line text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-3">Import ActivoBank</button>
        </div>
      </div>

      {view === 'overview' && <ExpensesOverview rows={rows} money={money} hidden={hidden} />}

      {view === 'list' && (<>
      {/* Add form */}
      <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></Field>
          <Field label="Amount (€ · negative = expense)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="-30,00" className={inp} /></Field>
          <Field label="Tag">
            <select value={tagSel} onChange={(e) => setTagSel(e.target.value)} className={inp}>
              {SORTED_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__custom">Custom…</option>
            </select>
          </Field>
          {tagSel === '__custom'
            ? <Field label="Custom tag"><input value={customTag} onChange={(e) => setCustomTag(e.target.value)} maxLength={30} placeholder="e.g. Gym" className={inp} /></Field>
            : <Field label="Merchant (optional)"><input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inp} /></Field>}
          <button onClick={add} disabled={saving} className="px-4 py-2 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add expense'}
          </button>
        </div>
        {tagSel === '__custom' && <Field label="Merchant (optional)"><input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={`${inp} mt-3 max-w-xs`} /></Field>}
        <div className="mt-3"><Field label="Comment (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Split with friends, birthday gift…" className={`${inp} w-full`} /></Field></div>
        {err && <p className="text-sm text-red-500 mt-3">{err}</p>}
      </div>

      {/* Filters + totals */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="label-caps text-gray-400 dark:text-ink-muted">Month</span>
          <div className="flex items-center">
            <button onClick={() => setMonth((m) => shiftMonth(m, -1))} title="Previous month"
              className="px-2 py-1.5 rounded-l-lg border border-gray-300 dark:border-line text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3">‹</button>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${inp} rounded-none border-x-0`} />
            <button onClick={() => setMonth((m) => shiftMonth(m, 1))} title="Next month"
              className="px-2 py-1.5 rounded-r-lg border border-gray-300 dark:border-line text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3">›</button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="label-caps text-gray-400 dark:text-ink-muted">Tag</span>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className={inp}>
            {allTags.map((t) => <option key={t} value={t}>{t === 'All' ? 'All' : labelOf(t)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm relative">
          <span className="label-caps text-gray-400 dark:text-ink-muted">Search</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Merchant, amount, comment…" className={`${inp} w-56`} />
          {query && <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs" title="Clear">✕</button>}
        </label>
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-4">
          {tagFilter !== 'All' && (
            <span title="Sum of outflows in the current filter (includes excluded tags)">
              Filtered ({monthRows.length}) <strong className="text-indigo-600 dark:text-brand-400">{money(filteredOut)}</strong>
            </span>
          )}
          <span>Expenses <strong className="font-num text-red-500 dark:text-loss">{money(expensesTotal)}</strong></span>
          <span>Income <strong className="font-num text-green-600 dark:text-gain">{money(incomeTotal)}</strong></span>
          <span>Net <strong className="font-num text-gray-900 dark:text-ink">{money(incomeTotal - expensesTotal)}</strong></span>
        </span>
      </div>

      {/* Delete a date range */}
      <div className="flex justify-end mb-4 -mt-1">
        {!showDel ? (
          <button onClick={() => { setShowDel(true); setErr(null); setDelFrom(''); setDelTo(''); }}
            className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-loss">Delete a date range…</button>
        ) : (
          <div className="flex flex-wrap items-end gap-2 p-3 rounded-xl border border-red-300 dark:border-loss/40 bg-red-50/60 dark:bg-loss/5">
            <label className="text-xs"><span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">From</span><input type="date" value={delFrom} onChange={(e) => setDelFrom(e.target.value)} className={inp} /></label>
            <label className="text-xs"><span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">To</span><input type="date" value={delTo} onChange={(e) => setDelTo(e.target.value)} className={inp} /></label>
            <button onClick={deleteRange} disabled={delBusy}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">{delBusy ? 'Deleting…' : 'Delete range'}</button>
            <button onClick={() => { setShowDel(false); setErr(null); }}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-line text-sm text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3">Cancel</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-brand-500/50 animate-pulse">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* By-tag breakdown */}
          <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line">
            <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">By tag · {month}</p>
            {byTag.length === 0 ? <p className="text-sm text-gray-400">No expenses this month.</p> : byTag.map((t) => (
              <button key={t.tag} onClick={() => setTagFilter((f) => f === t.tag ? 'All' : t.tag)}
                className={`w-full text-left mb-2 rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-surface-3 ${tagFilter === t.tag ? 'bg-gray-100 dark:bg-surface-3 ring-1 ring-indigo-400 dark:ring-brand-500/40' : ''}`}
                title={tagFilter === t.tag ? 'Click to clear filter' : `Filter by ${t.label}`}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: tagColor(t.tag).fg }} />
                    {t.label}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">{money(t.total)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-1.5 rounded-full" style={{ width: `${maxTag ? (t.total / maxTag) * 100 : 0}%`, backgroundColor: tagColor(t.tag).fg }} /></div>
              </button>
            ))}
          </div>

          {/* List */}
          <div className="lg:col-span-2 bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line overflow-hidden">
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-indigo-50 dark:bg-brand-500/10 border-b border-gray-200 dark:border-line text-sm">
                <span className="font-medium text-gray-700 dark:text-brand-200">{selected.size} selected</span>
                <span className="text-gray-400">Re-tag as</span>
                <TagEditor current={EXPENSE_TAGS[0]} onSave={bulkTag} onCancel={() => setSelected(new Set())} saveLabel={bulking ? '…' : 'Apply'} />
                <button onClick={() => setSelected(new Set())} className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs">Clear</button>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[820px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-surface-2 border-b border-gray-200 dark:border-line label-caps text-gray-500 dark:text-brand-500">
                  <th className="p-3 w-8">
                    <input type="checkbox" aria-label="Select all"
                      checked={sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(sortedRows.map((r) => r.id)) : new Set())}
                      className="accent-indigo-600 dark:accent-brand-500 cursor-pointer" />
                  </th>
                  <Th k="date" sort={sort} onSort={toggleSort}>Date</Th>
                  <Th k="tag" sort={sort} onSort={toggleSort}>Tag</Th>
                  <Th k="merchant" sort={sort} onSort={toggleSort}>Merchant</Th>
                  <Th k="institution" sort={sort} onSort={toggleSort}>Bank</Th>
                  <th className="p-3">Comment</th>
                  <Th k="amount" sort={sort} onSort={toggleSort} align="right">Amount</Th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
                {sortedRows.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-gray-400">No expenses.</td></tr>
                ) : sortedRows.map((r) => {
                  const c = tagColor(r.tag);
                  const sel = selected.has(r.id);
                  return (
                  <tr key={r.id} className={`group hover:bg-gray-50 dark:hover:bg-surface-3 ${sel ? 'bg-indigo-50/60 dark:bg-brand-500/5' : ''} ${countsInTotals(r.tag) ? '' : 'opacity-45'}`} title={countsInTotals(r.tag) ? undefined : 'Excluded from expense/income totals'}>
                    <td className="p-3">
                      <input type="checkbox" aria-label="Select row" checked={sel} onChange={() => toggleRow(r.id)}
                        className="accent-indigo-600 dark:accent-brand-500 cursor-pointer" />
                    </td>
                    <td className="p-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.date}</td>
                    <td className="p-3">
                      {editingId === r.id ? (
                        <TagEditor current={r.tag_label ?? r.tag} onSave={(t) => updateTag(r.id, t)} onCancel={() => setEditingId(null)} />
                      ) : (
                        <button onClick={() => { setEditingId(r.id); setErr(null); }} title="Click to re-tag"
                          className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap hover:ring-1 hover:ring-current"
                          style={{ color: c.fg, backgroundColor: c.bg }}>
                          {r.tag_label ?? r.tag}
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{r.merchant ?? '—'}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.institution ?? 'Manual'}</td>
                    <td className="p-3 align-middle">
                      {editingNoteId === r.id ? (
                        <NoteEditor current={r.note ?? ''} onSave={(t) => updateNote(r.id, t)} onCancel={() => setEditingNoteId(null)} />
                      ) : r.note ? (
                        <button onClick={() => { setEditingNoteId(r.id); setErr(null); }} title={`${r.note} — click to edit`}
                          className="block max-w-[180px] truncate text-left text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">{r.note}</button>
                      ) : (
                        <button onClick={() => { setEditingNoteId(r.id); setErr(null); }} title="Add comment"
                          className="text-xs text-gray-300 dark:text-gray-600 hover:text-indigo-500 dark:hover:text-brand-400">＋ note</button>
                      )}
                    </td>
                    <td className={`p-3 text-right font-num whitespace-nowrap ${Number(r.amount) < 0 ? 'text-gray-900 dark:text-ink' : 'text-green-600 dark:text-gain'}`}>
                      {Number(r.amount) < 0 ? `−${money(-Number(r.amount))}` : `+${money(Number(r.amount))}`}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button onClick={() => setSimilarFor(r)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-300 dark:text-gray-600 hover:text-indigo-500 dark:hover:text-brand-400 mr-2 transition-opacity"
                        title="Find similar expenses">
                        <Search size={14} className="inline" />
                      </button>
                      <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-red-500" title="Delete">✕</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
      </>)}
    </main>
  );
}

const inp = 'bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg px-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500';

// On-demand similar-expense finder. Operates on already-loaded rows (no DB query).
function SimilarExpensesPanel({ row, rows, money, onClose, onRetag, onSearch }: {
  row: Expense; rows: Expense[]; money: (n: number) => string;
  onClose: () => void; onRetag: (tag: string) => void; onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState(() => merchantKey(row.merchant));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const matches = useMemo(() => {
    const key = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (key && !(r.merchant ?? '').toLowerCase().includes(key)) return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    });
  }, [rows, q, from, to]);

  const breakdown = useMemo(() => {
    const m: Record<string, { label: string; count: number; total: number }> = {};
    for (const r of matches) {
      if (!m[r.tag]) m[r.tag] = { label: r.tag_label ?? r.tag, count: 0, total: 0 };
      m[r.tag].count++; m[r.tag].total += Math.abs(Number(r.amount));
    }
    return Object.entries(m).map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.count - a.count);
  }, [matches]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white dark:bg-surface border border-gray-200 dark:border-line rounded-2xl p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-bold">Similar expenses</h3>
            <p className="text-xs text-gray-400 dark:text-ink-muted">Tags used by matching merchants — no extra queries.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-ink">✕</button>
        </div>

        <label className="block mb-2">
          <span className="text-[11px] text-gray-400">Merchant contains</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. WWW.AMAZON" className={`${inp} w-full mt-1`} />
        </label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block"><span className="text-[11px] text-gray-400">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inp} w-full mt-1`} /></label>
          <label className="block"><span className="text-[11px] text-gray-400">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inp} w-full mt-1`} /></label>
        </div>

        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-500 dark:text-ink-muted">{matches.length} match{matches.length !== 1 ? 'es' : ''}</span>
          <button onClick={() => onSearch(q.trim())} className="label-caps px-2.5 py-1 rounded-md bg-indigo-600 dark:bg-brand-500 text-white dark:text-black">Show in list</button>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {breakdown.length === 0 ? (
            <p className="text-sm text-gray-400 p-2">No matches.</p>
          ) : breakdown.map((t) => {
            const col = tagColor(t.tag);
            return (
              <button key={t.tag} onClick={() => onRetag(t.label)} title={`Re-tag this expense as ${t.label}`}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-surface-3">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.fg }} />
                  <span className="truncate text-gray-700 dark:text-ink">{t.label}</span>
                </span>
                <span className="text-xs text-gray-400 dark:text-ink-muted whitespace-nowrap">{t.count}× · {money(t.total)}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-3">Click a tag to re-tag <strong>this</strong> expense. Refine merchant/dates if the name has a unique ID.</p>
      </div>
    </div>
  );
}

function TagEditor({ current, onSave, onCancel, saveLabel }: { current: string; onSave: (t: string) => void; onCancel: () => void; saveLabel?: string }) {
  const isPreset = (EXPENSE_TAGS as readonly string[]).includes(current);
  const [sel, setSel] = useState<string>(isPreset ? current : '__custom');
  const [custom, setCustom] = useState<string>(isPreset ? '' : current);
  const value = sel === '__custom' ? custom : sel;
  return (
    <span className="inline-flex items-center gap-1">
      <select autoFocus value={sel} onChange={(e) => setSel(e.target.value)} className={inp}>
        {SORTED_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        <option value="__custom">Custom…</option>
      </select>
      {sel === '__custom' && (
        <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={30} placeholder="Tag"
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(value); }} className={`${inp} w-28`} />
      )}
      {saveLabel
        ? <button onClick={() => onSave(value)} className="px-2.5 py-1 rounded-lg bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-xs font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600" title="Apply">{saveLabel}</button>
        : <button onClick={() => onSave(value)} className="text-green-600 dark:text-green-400 px-1" title="Save">✓</button>}
      <button onClick={onCancel} className="text-gray-400 hover:text-red-500 px-1" title="Cancel">✕</button>
    </span>
  );
}

function NoteEditor({ current, onSave, onCancel }: { current: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(current);
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} maxLength={200} placeholder="Comment"
        onKeyDown={(e) => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel(); }}
        className={`${inp} w-44`} />
      <button onClick={() => onSave(val)} className="text-green-600 dark:text-green-400 px-1" title="Save">✓</button>
      <button onClick={onCancel} className="text-gray-400 hover:text-red-500 px-1" title="Cancel">✕</button>
    </span>
  );
}

function Th({ k, sort, onSort, align, children }: {
  k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void;
  align?: 'right'; children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th className={`p-3 cursor-pointer select-none hover:text-gray-600 dark:hover:text-brand-300 ${align === 'right' ? 'text-right' : ''}`} onClick={() => onSort(k)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        <span className={active ? '' : 'opacity-0'}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
      </span>
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-400 normal-case">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
