'use client';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'finapp_hide_balance';
const EVT = 'finapp_hide_balance_change';

// Shared hide-balance state: persisted in localStorage and synced across tabs
// (storage event) and across components in the same tab (custom event).
// Hidden by default.
export function useHideBalance() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const read = () => setHidden(localStorage.getItem(KEY) !== 'false');
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) read(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVT, read as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVT, read as EventListener);
    };
  }, []);

  const toggle = useCallback(() => {
    setHidden((h) => {
      const next = !h;
      localStorage.setItem(KEY, String(next));
      window.dispatchEvent(new Event(EVT));
      return next;
    });
  }, []);

  // Mask a formatted string, or format+mask a number.
  const mask = useCallback((s: string) => (hidden ? '••••••' : s), [hidden]);
  const money = useCallback(
    (n: number) => (hidden ? '••••••' : `€${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
    [hidden],
  );

  return { hidden, toggle, mask, money };
}
