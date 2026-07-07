'use client';

import { useRef, useState } from 'react';

interface Props {
  title: string;
  description: string;
  endpoint: string;
  accept?: string;       // e.g. ".pdf" or ".csv" — defaults to ".pdf"
  hint?: string;         // where to export the source document
  onClose: () => void;
  onImported: () => void;
}

type Status = 'idle' | 'uploading' | 'success' | 'error';

interface FileResult {
  name: string;
  inserted?: number;
  total?: number;
  error?: string;
}

export default function ImportModal({ title, description, endpoint, accept = '.pdf', hint, onClose, onImported }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<FileResult[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = accept.split(',').map(s => s.trim());
  const acceptedMime = acceptedTypes.includes('.csv')
    ? ['text/csv', 'application/csv', 'text/plain']
    : ['application/pdf'];

  function isValid(f: File): boolean {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    return acceptedTypes.includes(ext) || acceptedMime.includes(f.type);
  }

  function handleFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    const invalid = list.filter(f => !isValid(f));
    if (invalid.length) {
      setValidationError(`Only ${accept} files are accepted.`);
      setStatus('error');
      return;
    }
    // Append, de-duplicating by name+size
    setFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}_${f.size}`));
      const merged = [...prev];
      for (const f of list) {
        const key = `${f.name}_${f.size}`;
        if (!seen.has(key)) { merged.push(f); seen.add(key); }
      }
      return merged;
    });
    setValidationError(null);
    setStatus('idle');
    setResults([]);
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleUpload() {
    if (!files.length) return;
    setStatus('uploading');
    setResults([]);

    const collected: FileResult[] = [];
    let anySuccess = false;

    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(endpoint, { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) {
          collected.push({ name: file.name, error: json.error ?? 'Upload failed.' });
        } else {
          collected.push({ name: file.name, inserted: json.inserted, total: json.total });
          anySuccess = true;
        }
      } catch {
        collected.push({ name: file.name, error: 'Network error.' });
      }
    }

    setResults(collected);
    setStatus(collected.some(r => r.error) && !anySuccess ? 'error' : 'success');
    if (anySuccess) onImported();
  }

  const totalInserted = results.reduce((acc, r) => acc + (r.inserted ?? 0), 0);
  const totalRecords  = results.reduce((acc, r) => acc + (r.total ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors text-xl leading-none">✕</button>
        </div>

        {hint && (
          <div className="mb-4 flex gap-2 p-3 rounded-lg bg-gray-50 dark:bg-surface-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            <span className="shrink-0">💡</span>
            <span><span className="font-semibold text-gray-600 dark:text-gray-300">Where to find it:</span> {hint}</span>
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4
            ${dragging
              ? 'border-gold-500 bg-gold-500/5'
              : files.length
                ? 'border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/10'
                : 'border-gray-300 dark:border-line hover:border-gold-500/60 dark:hover:border-gold-500/60'
            }`}
        >
          <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
          {files.length ? (
            <>
              <p className="text-2xl mb-1">📄</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
              <p className="text-xs text-gray-400">Click to add more</p>
            </>
          ) : (
            <>
              <p className="text-2xl mb-1">⬆️</p>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Drop {accept} files here or click to browse</p>
              <p className="text-xs text-gray-400 mt-0.5">Multiple files supported</p>
            </>
          )}
        </div>

        {/* Selected file list */}
        {files.length > 0 && status !== 'success' && (
          <div className="mb-4 max-h-32 overflow-y-auto space-y-1">
            {files.map((f, i) => (
              <div key={`${f.name}_${i}`} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-surface-2">
                <span className="truncate text-gray-700 dark:text-gray-300">{f.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-gray-400 hover:text-red-500 transition-colors">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {validationError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
            {validationError}
          </div>
        )}

        {/* Per-file results */}
        {results.length > 0 && (
          <div className="mb-4 space-y-2">
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400">
              ✓ Imported <strong>{totalInserted}</strong> of {totalRecords} across {results.length} file{results.length !== 1 ? 's' : ''}.
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {results.map((r, i) => (
                <div key={`${r.name}_${i}`} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-surface-2">
                  <span className="truncate text-gray-700 dark:text-gray-300">{r.name}</span>
                  <span className={`shrink-0 ml-2 ${r.error ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                    {r.error ? r.error : `${r.inserted}/${r.total}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleUpload}
            disabled={!files.length || status === 'uploading'}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 dark:bg-gold-500 text-white dark:text-black text-sm font-semibold hover:bg-indigo-700 dark:hover:bg-gold-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'uploading' ? `Importing ${files.length}…` : `Import ${files.length || ''}`.trim()}
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
