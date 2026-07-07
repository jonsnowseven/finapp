'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';
import { createSupabaseBrowserClient } from '../lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

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

  const getLinkStyles = (path: string) => {
    const isActive = pathname === path;
    return isActive
      ? 'text-sm font-medium text-gray-900 dark:text-white border-b-2 border-indigo-600 dark:border-gold-500 pb-1 transition-colors'
      : 'text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gold-400 border-b-2 border-transparent pb-1 transition-colors';
  };

  return (
    <nav className="bg-white dark:bg-black border-b border-gray-200 dark:border-gold-500/30 px-6 py-4 flex justify-between items-center transition-colors duration-200 sticky top-0 z-50">
      <h1 className="text-xl font-bold tracking-tight text-indigo-600 dark:text-gold-500">FinApp Dashboard</h1>

      <div className="flex items-center space-x-6">
        {user && (
          <div className="space-x-6 flex items-center">
            <Link href="/" className={getLinkStyles('/')}>Overview</Link>
            <Link href="/transactions" className={getLinkStyles('/transactions')}>Transactions</Link>
            <Link href="/forecast" className={getLinkStyles('/forecast')}>Forecast</Link>
            <Link href="/lego" className={getLinkStyles('/lego')}>Lego</Link>
            <Link href="/pension" className={getLinkStyles('/pension')}>Pension</Link>
          </div>
        )}

        <ThemeToggle />

        {user && (
          <div className="flex items-center gap-3 pl-2 border-l border-gray-200 dark:border-gold-500/20">
            <span className="hidden sm:block text-xs text-gray-400 dark:text-gray-500 max-w-[140px] truncate">
              {user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
