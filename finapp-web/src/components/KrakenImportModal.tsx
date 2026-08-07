'use client';

import { useRef, useState } from 'react';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Status = 'idle' | 'uploading' | 'success' | 'error';

export default function KrakenImportModal({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<{ inserted?: number; total?: number; error?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (f.type !== 'application/pdf') {
      setResult({ error: 'Only PDF files are accepted.' });
      setStatus('error');
      return;
    }
    setFile(f);
    setStatus('idle');
    setResult(null);
  }

  async function handleUpload() {
    if (!file) return;
    setStatus('uploading');
    setResult(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/import/kraken', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        setResult({ error: json.error ?? 'Upload failed.' });
        setStatus('error');
      } else {
        setResult(json);
        setStatus('success');
        onImported();
      }
    } catch {
      setResult({ error: 'Network error.' });
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Import Kraken Trades</h3>
            <p className="text-xs text-gray-400 mt-0.5">Upload a PDF trade history export from Kraken</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none">✕</button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4
            ${dragging
              ? 'border-brand-500 bg-brand-500/5'
              : file
                ? 'border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/10'
                : 'border-gray-300 dark:border-line hover:border-brand-500/60 dark:hover:border-brand-500/60'
            }`}
        >
          <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {file ? (
            <>
              <p className="text-2xl mb-1">📄</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</p>
              <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB — click to change</p>
            </>
          ) : (
            <>
              <p className="text-2xl mb-1">⬆️</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drop PDF here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Kraken → History → Trades → Export PDF</p>
            </>
          )}
        </div>

        {/* Result */}
        {status === 'success' && result && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400">
            ✓ Imported <strong>{result.inserted}</strong> of {result.total} transactions.
          </div>
        )}
        {status === 'error' && result?.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
            {result.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleUpload}
            disabled={!file || status === 'uploading'}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 dark:bg-brand-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'uploading' ? 'Importing...' : 'Import'}
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
