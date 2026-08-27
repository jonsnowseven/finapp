'use client';

import { useState } from 'react';

interface Props {
  text: string;
  children: React.ReactNode;
  className?: string;   // wrapper display, e.g. override to 'relative block' for a full-width trigger
}

// Tap-to-toggle info tooltip. Native `title` only fires on hover, which
// doesn't exist on touch — tapping the trigger just selects the text
// underneath instead of showing anything. This works identically on
// mobile (tap) and desktop (click).
export default function Tooltip({ text, children, className = 'relative inline-block' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        className="cursor-help inline"
      >
        {children}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 left-0 top-full mt-2 w-64 max-w-[80vw] rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface-2 px-3 py-2 text-xs font-normal normal-case leading-relaxed text-gray-600 dark:text-ink-muted shadow-lg">
            {text}
          </div>
        </>
      )}
    </div>
  );
}
