'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { subscribeDevErrors, type DevErrorEntry } from '../lib/devError';

// Dev-only toast stack for data-fetch failures that would otherwise fail
// silently (a page just shows its empty state with no clue why). Never
// renders in production — see devError.ts.
export default function DevErrorOverlay() {
  const [errors, setErrors] = useState<DevErrorEntry[]>([]);

  useEffect(() => subscribeDevErrors((e) => setErrors((prev) => [...prev.slice(-4), e])), []);

  if (process.env.NODE_ENV === 'production' || errors.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-96 max-w-[90vw] space-y-2">
      {errors.map((e) => (
        <div key={e.id} className="flex items-start gap-2 p-3 rounded-xl bg-red-950/95 border border-red-500/40 text-xs text-red-200 shadow-xl backdrop-blur">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-300">{e.context} · {e.time}</p>
            <p className="mt-0.5 break-words font-mono">{e.message}</p>
          </div>
          <button onClick={() => setErrors((prev) => prev.filter((x) => x.id !== e.id))} className="text-red-400 hover:text-red-200 shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
