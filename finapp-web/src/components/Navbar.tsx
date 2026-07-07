'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import EyeToggle from './EyeToggle';
import { createSupabaseBrowserClient } from '../lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/forecast', label: 'Forecast' },
  { href: '/lego', label: 'Lego' },
  { href: '/pension', label: 'Pension' },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const linkClass = (path: string) => {
    const active = pathname === path;
    return `label-caps px-3 py-2 rounded-md whitespace-nowrap transition-colors ${
      active
        ? 'text-black bg-gold-500 dark:text-black dark:bg-gold-500'
        : 'text-gray-500 dark:text-ink-muted hover:text-gray-900 dark:hover:text-gold-400 hover:bg-gray-100 dark:hover:bg-surface-3'
    }`;
  };

  return (
    <nav className="bg-white/95 dark:bg-void/95 backdrop-blur border-b border-gray-200 dark:border-line px-4 sm:px-6 py-3 flex justify-between items-center gap-4 sticky top-0 z-50">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2.5 shrink-0">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-gold-500 text-black shadow-[0_0_16px_-4px_rgba(255,215,0,0.6)]">
          <Landmark size={18} strokeWidth={2} />
        </span>
        <span className="text-lg font-bold font-display tracking-tight text-gray-900 dark:text-gold-500">FinApp</span>
      </Link>

      {/* Nav */}
      {user && (
        <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={linkClass(n.href)}>{n.label}</Link>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {user && <EyeToggle />}
        <ThemeToggle />
        {user && (
          <div className="flex items-center gap-3 pl-2 ml-1 border-l border-gray-200 dark:border-line">
            <span className="hidden lg:block text-xs text-gray-400 dark:text-ink-faint max-w-[140px] truncate">
              {user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="label-caps text-gray-500 dark:text-ink-muted hover:text-red-500 dark:hover:text-loss transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
