'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import TransactionChart from '../../components/TransactionChart';
import ImportModal from '../../components/ImportModal';
import { RefreshCw, Upload, ChevronDown } from 'lucide-react';
import { useHideBalance } from '../../lib/useHideBalance';

type ImportKey = 'kraken' | 'degiro' | 'tr' | 'bancoinvest' | 'sgf' | 'revolut' | 'aforro';

// Each import source + where to obtain the document. `hint` shows as a tooltip
// in the dropdown and as a help line inside the import modal.
const IMPORT_SOURCES: { key: ImportKey; label: string; hint: string }[] = [
  { key: 'kraken',      label: 'Kraken (PDF)',             hint: 'Kraken.com → History → Export → request a Ledgers/Trades statement, then download the PDF.' },
  { key: 'degiro',      label: 'DeGiro (PDF)',             hint: 'DeGiro → Activity (Atividade) → Account statement / Transactions → Export → PDF.' },
  { key: 'tr',          label: 'Trade Republic (CSV)',     hint: 'Trade Republic app → Profile → Transactions → Export, or the transactions CSV emailed to you.' },
  { key: 'bancoinvest', label: 'Banco Invest PPR (PDF)',   hint: 'Banco Invest (Alves Ribeiro) → PPR → Posição Atual → export/print the position report as PDF.' },
  { key: 'sgf',         label: 'SGF PPR (PDF)',            hint: 'Golden SGF portal → Recibos / Documentos → download the subscription receipt PDF.' },
  { key: 'revolut',     label: 'Revolut Boosted (PDF)',    hint: 'Revolut app → Account → Statement → generate the EUR account statement (PDF).' },
  { key: 'aforro',      label: 'Certificados Aforro (PDF)', hint: 'IGCP / Aforro Net → Conta Aforro → Extrato → download the statement PDF.' },
];

export default function TransactionsPage() {
  const { money, hidden } = useHideBalance();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showImport, setShowImport] = useState<'kraken' | 'degiro' | 'tr' | 'bancoinvest' | 'sgf' | 'revolut' | 'aforro' | null>(null);
  const [showImportMenu, setShowImportMenu] = useState(false);

  const [selectedEntity, setSelectedEntity] = useState('All');
  const [selectedType, setSelectedType] = useState('All');

  const fetchTransactions = useCallback(async () => {
    const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false });
    if (!error && data) {
      setTransactions(data);
      setFilteredTransactions(data);
    }
  }, []);

  useEffect(() => {
    fetchTransactions().finally(() => setLoading(false));
  }, [fetchTransactions]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchTransactions();
    setRefreshing(false);
  }

  const isDev = process.env.NODE_ENV !== 'production';
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteEntity() {
    if (selectedEntity === 'All') return;
    if (!confirm(`Delete ALL ${selectedEntity} transactions? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/dev/delete-entity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: selectedEntity }),
      });
      const json = await res.json();
      if (!res.ok) alert(`Delete failed: ${json.error ?? 'unknown error'}`);
      else { setSelectedEntity('All'); await fetchTransactions(); }
    } catch {
      alert('Delete failed: network error.');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let result = transactions;
    if (selectedEntity !== 'All') {
      result = result.filter(t => t.entity.toLowerCase() === selectedEntity.toLowerCase());
    }
    if (selectedType !== 'All') {
      result = result.filter(t => t.transaction_type.toLowerCase() === selectedType.toLowerCase());
    }
    setFilteredTransactions(result);
  }, [selectedEntity, selectedType, transactions]);

  const hintFor = (k: ImportKey) => IMPORT_SOURCES.find(s => s.key === k)?.hint;

  const entities = ['All', ...Array.from(new Set(transactions.map(t => t.entity)))];
  const types = ['All', 'deposit', 'buy', 'sell', 'interest', 'dividend'];

  // Per-entity badge colors (light + dark). Fallback to gold for unknown entities.
  const ENTITY_COLORS: Record<string, string> = {
    'Kraken':         'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
    'DeGiro':         'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
    'Trade Republic': 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
    'Banco Invest':   'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    'SGF':            'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    'Revolut':        'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30',
    'Aforro':         'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
  };
  const entityColor = (e: string) =>
    ENTITY_COLORS[e] ?? 'bg-gray-100 text-gray-800 dark:bg-gold-500/20 dark:text-gold-400 dark:border-gold-500/20';

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      {showImport === 'kraken' && (
        <ImportModal
          title="Import Kraken Trades"
          description="Upload a PDF trade history export from Kraken"
          endpoint="/api/import/kraken"
          hint={hintFor('kraken')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'degiro' && (
        <ImportModal
          title="Import DeGiro Transactions"
          description="Upload a PDF transactions export from DeGiro"
          endpoint="/api/import/degiro"
          hint={hintFor('degiro')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'tr' && (
        <ImportModal
          title="Import Trade Republic"
          description="Upload a CSV transaction export from Trade Republic"
          endpoint="/api/import/trade-republic"
          accept=".csv"
          hint={hintFor('tr')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'aforro' && (
        <ImportModal
          title="Import Certificados de Aforro"
          description="Upload an Extrato de Conta Aforro PDF (IGCP)"
          endpoint="/api/import/aforro"
          hint={hintFor('aforro')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'revolut' && (
        <ImportModal
          title="Import Revolut Boosted Account"
          description="Upload a Revolut EUR account statement PDF"
          endpoint="/api/import/revolut"
          hint={hintFor('revolut')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'sgf' && (
        <ImportModal
          title="Import SGF PPR"
          description="Upload a receipt PDF from Golden SGF (PPR SGF Stoik)"
          endpoint="/api/import/sgf"
          hint={hintFor('sgf')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}
      {showImport === 'bancoinvest' && (
        <ImportModal
          title="Import Banco Invest PPR"
          description="Upload a PDF position report from Banco Invest (Alves Ribeiro PPR)"
          endpoint="/api/import/banco-invest"
          hint={hintFor('bancoinvest')}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); handleRefresh(); }}
        />
      )}

      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold">Transaction Ledger</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Review, sort, and isolate operations recorded in your system.</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {/* Import dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowImportMenu(v => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-gold-500/30 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <Upload size={14} />
              Import
              <ChevronDown size={13} className={`transition-transform ${showImportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showImportMenu && (
              <>
                {/* backdrop to close on outside click */}
                <div className="fixed inset-0 z-10" onClick={() => setShowImportMenu(false)} />
                <div className="absolute right-0 mt-1 z-20 w-44 bg-white dark:bg-[#111] border border-gray-200 dark:border-gold-500/20 rounded-xl shadow-lg overflow-hidden">
                  {IMPORT_SOURCES.map(({ label, key, hint }) => (
                    <button
                      key={key}
                      title={hint}
                      onClick={() => { setShowImport(key as ImportKey); setShowImportMenu(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 dark:border-gold-500/30 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>

          {isDev && selectedEntity !== 'All' && (
            <button
              onClick={handleDeleteEntity}
              disabled={deleting}
              title={`Local dev only — delete all ${selectedEntity} transactions`}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-300 dark:border-red-500/40 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : `⚠ Delete ${selectedEntity}`}
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar Styled for Black/Gold */}
      <div className="bg-white dark:bg-[#0a0a0a] p-4 rounded-xl border border-gray-200 dark:border-gold-500/20 shadow-sm flex flex-wrap gap-4 mb-6 transition-colors duration-200">
        <div className="flex flex-col">
          <label className="text-xs font-semibold text-gray-400 uppercase mb-1">Filter by Entity</label>
          <select 
            value={selectedEntity} 
            onChange={(e) => setSelectedEntity(e.target.value)}
            className="bg-gray-50 dark:bg-[#111] border border-gray-300 dark:border-gold-500/30 text-sm rounded-lg p-2 focus:ring-indigo-500 dark:focus:ring-gold-500 focus:border-indigo-500 dark:focus:border-gold-500 text-gray-900 dark:text-white outline-none transition-colors"
          >
            {entities.map(ent => <option key={ent} value={ent}>{ent}</option>)}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs font-semibold text-gray-400 uppercase mb-1">Filter by Type</label>
          <select 
            value={selectedType} 
            onChange={(e) => setSelectedType(e.target.value)}
            className="bg-gray-50 dark:bg-[#111] border border-gray-300 dark:border-gold-500/30 text-sm rounded-lg p-2 focus:ring-indigo-500 dark:focus:ring-gold-500 focus:border-indigo-500 dark:focus:border-gold-500 text-gray-900 dark:text-white outline-none transition-colors"
          >
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Chart */}
      {!loading && (
        <div className={hidden ? 'blur-sm select-none pointer-events-none' : ''}>
        <TransactionChart
          transactions={filteredTransactions}
          legendEntities={entities.filter(e => e !== 'All')}
          activeEntity={selectedEntity}
          onEntityClick={(e) => setSelectedEntity(prev => (prev === e ? 'All' : e))}
        />
        </div>
      )}

      {/* Table Styled for Black/Gold */}
      {loading ? (
        <div className="text-gray-500 dark:text-gold-500/50 animate-pulse">Loading transaction database...</div>
      ) : (
        <div className="bg-white dark:bg-[#0a0a0a] rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm overflow-hidden transition-colors duration-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#111] border-b border-gray-200 dark:border-gold-500/20 text-xs font-bold text-gray-400 dark:text-gold-500 uppercase tracking-wider">
                  <th className="p-4">Date</th>
                  <th className="p-4">Institution</th>
                  <th className="p-4">Asset</th>
                  <th className="p-4">ISIN</th>
                  <th className="p-4">Type</th>
                  <th className="p-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50 text-sm">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400 dark:text-gray-500">No transactions match your filtering constraints.</td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors">
                      <td className="p-4 font-medium text-gray-600 dark:text-gray-300">{tx.date}</td>
                      <td className="p-4">
                        {/* Styled tag badge */}
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border border-transparent ${entityColor(tx.entity)}`}>
                          {tx.entity}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-gray-900 dark:text-white">{tx.asset_name}</td>
                      <td className="p-4 font-mono text-xs text-gray-500 dark:text-gray-400">{tx.isin ?? '—'}</td>
                      <td className="p-4 capitalize text-gray-500 dark:text-gray-400">{tx.transaction_type}</td>
                      <td className="p-4 text-right font-bold text-gray-900 dark:text-white">{money(Number(tx.amount))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
