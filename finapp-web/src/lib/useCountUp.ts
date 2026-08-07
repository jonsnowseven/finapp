'use client';
import { useEffect, useRef, useState } from 'react';

// Animates a number from its previous value to `target` on change (ease-out).
export function useCountUp(target: number, opts: { duration?: number; decimals?: number } = {}): number {
  const { duration = 900, decimals = 0 } = opts;
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const frame = useRef<number>();

  useEffect(() => {
    const start = performance.now();
    const startValue = from.current;
    const delta = target - startValue;

    if (frame.current) cancelAnimationFrame(frame.current);
    if (delta === 0) return;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startValue + delta * eased;
      setValue(Number(next.toFixed(decimals)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}
