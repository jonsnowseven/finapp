'use client';
import { useEffect, useState } from 'react';

const FALLBACK = '#635bff';

function readBrand(shade: '400' | '500' | '600' | '700'): string {
  if (typeof window === 'undefined') return FALLBACK;
  const rgb = getComputedStyle(document.documentElement).getPropertyValue(`--brand-${shade}`).trim();
  return rgb ? `rgb(${rgb.split(/\s+/).join(', ')})` : FALLBACK;
}

// Reads the live --brand-{shade} CSS var (see globals.css [data-accent]) so
// chart colors (recharts needs literal color strings, not CSS vars) follow
// the user's accent-picker choice instead of a hardcoded hex.
export function useBrandColor(shade: '400' | '500' | '600' | '700' = '500'): string {
  const [color, setColor] = useState<string>(() => readBrand(shade));

  useEffect(() => {
    setColor(readBrand(shade));
    const obs = new MutationObserver(() => setColor(readBrand(shade)));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'class'] });
    return () => obs.disconnect();
  }, [shade]);

  return color;
}
