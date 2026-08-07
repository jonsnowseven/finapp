'use client';
import { useCallback, useEffect, useState } from 'react';

// Fires once when the element scrolls into view — used to trigger a CSS entrance class.
// Uses a callback ref (not useRef) so the effect re-attaches once the target
// actually mounts — needed here since callers mount this element behind a
// `loading` gate, after the hook itself has already mounted.
export function useInView<T extends HTMLElement>(threshold = 0.15) {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        obs.unobserve(node);
      }
    }, { threshold });
    obs.observe(node);
    return () => obs.disconnect();
  }, [node, threshold]);

  return { ref, inView };
}
