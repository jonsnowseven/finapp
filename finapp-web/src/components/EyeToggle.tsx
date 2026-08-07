'use client';
import { Eye, EyeOff } from 'lucide-react';
import { useHideBalance } from '../lib/useHideBalance';

// Global hide-balance toggle. Reflects the shared state, so every instance
// (Navbar, page headers) stays in sync.
export default function EyeToggle({ className = '' }: { className?: string }) {
  const { hidden, toggle } = useHideBalance();
  return (
    <button onClick={toggle} title={hidden ? 'Show balances' : 'Hide balances'}
      aria-label={hidden ? 'Show balances' : 'Hide balances'}
      className={`p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-brand-300 hover:bg-gray-100 dark:hover:bg-surface-3 ${className}`}>
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}
