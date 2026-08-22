'use client';

import { useState } from 'react';

export interface TransactionSeed {
  date?: string;
  entity?: string;
  asset_name?: string;
  isin?: string | null;
  transaction_type?: string;
  quantity?: number | null;
  price?: number | null;
  amount?: number;
  currency?: string;
  fees?: number | null;
}

interface Props {
  entitySuggestions: string[];
  initial?: TransactionSeed;
  onClose: () => void;
  onAdded: () => void;
}

const TYPES = ['deposit', 'buy', 'sell', 'interest', 'dividend'];

const inp = 'bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg px-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-brand-500 w-full';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export default function AddTransactionModal({ entitySuggestions, initial, onClose, onAdded }: Props) {
  const seedTypeIsKnown = !initial?.transaction_type || TYPES.includes(initial.transaction_type);

  const [date, setDate] = useState(initial?.date ?? today());
  const [entity, setEntity] = useState(initial?.entity ?? '');
  const [assetName, setAssetName] = useState(initial?.asset_name ?? '');
  const [isin, setIsin] = useState(initial?.isin ?? '');
  const [typeSel, setTypeSel] = useState<string>(seedTypeIsKnown ? (initial?.transaction_type ?? TYPES[0]) : '__custom');
  const [customType, setCustomType] = useState(seedTypeIsKnown ? '' : (initial?.transaction_type ?? ''));
  const [quantity, setQuantity] = useState(numStr(initial?.quantity));
  const [price, setPrice] = useState(numStr(initial?.price));
  const [amount, setAmount] = useState(numStr(initial?.amount));
  const [currency, setCurrency] = useState(initial?.currency ?? 'EUR');
  const [fees, setFees] = useState(numStr(initial?.fees));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const transactionType = typeSel === '__custom' ? customType.trim() : typeSel;

  async function handleAdd() {
    setErr(null);
    if (!date || !entity.trim() || !assetName.trim() || !transactionType || !amount) {
      setErr('Date, entity, asset, type and amount are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          entity: entity.trim(),
          asset_name: assetName.trim(),
          isin: isin.trim() || undefined,
          transaction_type: transactionType,
          quantity: quantity || undefined,
          price: price || undefined,
          amount,
          currency,
          fees: fees || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? 'Add failed.'); return; }
      onAdded();
    } catch {
      setErr('Network error.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{initial ? 'Duplicate Transaction' : 'Add Manual Transaction'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {initial ? 'Prefilled from the original — edit anything before saving as a new row.' : "For statements that don't import cleanly — enter it by hand."}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
          </Field>
          <Field label="Entity">
            <input list="entity-suggestions" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="e.g. Banco Invest" className={inp} />
            <datalist id="entity-suggestions">
              {entitySuggestions.map((e) => <option key={e} value={e} />)}
            </datalist>
          </Field>

          <Field label="Asset name">
            <input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Alves Ribeiro PPR" className={inp} />
          </Field>
          <Field label="ISIN (optional)">
            <input value={isin} onChange={(e) => setIsin(e.target.value)} className={inp} />
          </Field>

          <Field label="Type">
            <select value={typeSel} onChange={(e) => setTypeSel(e.target.value)} className={inp}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__custom">Custom…</option>
            </select>
          </Field>
          {typeSel === '__custom' && (
            <Field label="Custom type">
              <input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. transfer" className={inp} />
            </Field>
          )}

          <Field label="Quantity (optional)">
            <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inp} />
          </Field>
          <Field label="Price (optional)">
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} className={inp} />
          </Field>

          <Field label="Amount">
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="146.00" className={inp} />
          </Field>
          <Field label="Currency">
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={inp} />
          </Field>

          <Field label="Fees (optional)">
            <input type="number" step="any" value={fees} onChange={(e) => setFees(e.target.value)} className={inp} />
          </Field>
        </div>

        {err && <p className="text-sm text-red-500 mt-3">{err}</p>}

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleAdd}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Adding…' : initial ? 'Save as new' : 'Add transaction'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-line text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-surface-3 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs block">
      <span className="label-caps text-gray-400 dark:text-ink-muted block mb-1">{label}</span>
      {children}
    </label>
  );
}
