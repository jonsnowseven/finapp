'use client';
import { useCallback, useEffect, useState } from 'react';

export const ACCENTS = [
  { id: 'gold', label: 'Gold', color: '#ffd700' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
  { id: 'sapphire', label: 'Sapphire', color: '#3b82f6' },
  { id: 'crimson', label: 'Crimson', color: '#f43f5e' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'platinum', label: 'Platinum', color: '#cbd5e1' },
] as const;

export type AccentId = typeof ACCENTS[number]['id'];
const KEY = 'finapp_accent';

// Brand-accent theme, orthogonal to light/dark (next-themes). Persisted +
// applied as document.documentElement.dataset.accent (see globals.css).
export function useAccent() {
  const [accent, setAccentState] = useState<AccentId>('gold');

  useEffect(() => {
    const a = (localStorage.getItem(KEY) as AccentId) || 'gold';
    setAccentState(a);
    document.documentElement.dataset.accent = a;
  }, []);

  const setAccent = useCallback((a: AccentId) => {
    localStorage.setItem(KEY, a);
    document.documentElement.dataset.accent = a;
    setAccentState(a);
  }, []);

  return { accent, setAccent };
}
