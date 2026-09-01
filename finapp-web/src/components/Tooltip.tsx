'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  text: string;
  children: React.ReactNode;
  className?: string;   // wrapper display, e.g. override to 'relative block' for a full-width trigger
}

const PANEL_WIDTH = 256; // w-64

// Tap-to-toggle info tooltip. Native `title` only fires on hover, which
// doesn't exist on touch — tapping the trigger just selects the text
// underneath instead of showing anything. This works identically on
// mobile (tap) and desktop (click).
//
// The panel renders through a portal into document.body: several triggers
// live inside a Card, which needs `overflow-hidden` for its rounded-corner
// accent bar — an absolutely-positioned child would get silently clipped by
// that instead of floating above it, so position is computed from the
// trigger's viewport rect and rendered as position:fixed outside the tree.
export default function Tooltip({ text, children, className = 'relative inline-block' }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - PANEL_WIDTH - 16);
    setPos({ top: r.bottom + 8, left: Math.max(8, left) });
  }

  function toggle(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    setOpen((v) => {
      if (!v) place();
      return !v;
    });
  }

  // Keep the panel aligned to the trigger while open (position:fixed is
  // viewport-relative, so scrolling/resizing needs a recompute).
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return (
    <div className={className} ref={triggerRef}>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } }}
        className="cursor-help inline"
      >
        {children}
      </div>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            className="fixed z-50 max-w-[80vw] rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface-2 px-3 py-2 text-xs font-normal normal-case leading-relaxed text-gray-600 dark:text-ink-muted shadow-lg"
          >
            {text}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
