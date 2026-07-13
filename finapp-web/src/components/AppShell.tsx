'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Landmark, LayoutDashboard, Receipt, Wallet, LineChart, Blocks, PiggyBank, House, LogOut } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import EyeToggle from './EyeToggle';
import MonthlyReminder from './MonthlyReminder';
import { ACCENTS, useAccent } from '../lib/useAccent';
import { createSupabaseBrowserClient } from '../lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

const NAV = [
  { href: '/', label: 'Overview', Icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', Icon: Receipt },
  { href: '/expenses', label: 'Expenses', Icon: Wallet },
  { href: '/forecast', label: 'Forecast', Icon: LineChart },
  { href: '/mortgage', label: 'Mortgage', Icon: House },
  { href: '/lego', label: 'Lego', Icon: Blocks },
  { href: '/pension', label: 'Pension', Icon: PiggyBank },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-gold-500 text-black shadow-[0_0_16px_-4px_rgb(var(--brand-500)/0.6)]">
        <Landmark size={18} strokeWidth={1.75} />
      </span>
      <span className="text-lg font-bold font-display tracking-tight text-gray-900 dark:text-gold-500">FinApp</span>
    </Link>
  );
}

function AccentSwitcher() {
  const { accent, setAccent } = useAccent();
  return (
    <div className="flex items-center gap-2">
      {ACCENTS.map((a) => (
        <button key={a.id} onClick={() => setAccent(a.id)} title={a.label} aria-label={`${a.label} theme`}
          className={`w-4 h-4 rounded-full transition-transform hover:scale-110 ${accent === a.id ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-void ring-gray-400 dark:ring-white/60' : ''}`}
          style={{ backgroundColor: a.color }} />
      ))}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // Logged out (login / unauthorized): no chrome.
  if (!user) return <>{children}</>;

  const navItem = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-indigo-50 text-indigo-700 dark:bg-gold-500/10 dark:text-gold-400 border-l-2 border-indigo-600 dark:border-gold-500 pl-[10px]'
        : 'text-gray-600 dark:text-ink-muted hover:bg-gray-50 dark:hover:bg-surface-3 border-l-2 border-transparent pl-[10px]'
    }`;

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 border-r border-gray-200 dark:border-line bg-white dark:bg-void">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={navItem(pathname === href)}>
              <Icon size={18} strokeWidth={1.75} className="shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-gray-200 dark:border-line space-y-3">
          <div className="flex items-center justify-between">
            <span className="label-caps text-gray-400 dark:text-ink-faint">Theme</span>
            <div className="flex items-center gap-1">
              <EyeToggle />
              <ThemeToggle />
            </div>
          </div>
          <AccentSwitcher />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-gray-400 dark:text-ink-faint truncate max-w-[150px]" title={user.email ?? ''}>{user.email}</span>
            <button onClick={signOut} title="Sign out" className="text-gray-400 hover:text-red-500 dark:hover:text-loss"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar + nav */}
      <div className="lg:hidden sticky top-0 z-50 bg-white/95 dark:bg-void/95 backdrop-blur border-b border-gray-200 dark:border-line">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-1">
            <EyeToggle />
            <ThemeToggle />
            <button onClick={signOut} title="Sign out" className="p-2 rounded-lg text-gray-500 dark:text-ink-muted hover:text-red-500"><LogOut size={18} /></button>
          </div>
        </div>
        <nav className="flex items-center gap-1 px-3 pb-2 overflow-x-auto no-scrollbar">
          {NAV.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href}
                className={`label-caps whitespace-nowrap px-3 py-1.5 rounded-md ${active ? 'bg-gold-500 text-black' : 'text-gray-500 dark:text-ink-muted hover:bg-gray-100 dark:hover:bg-surface-3'}`}>
                {label}
              </Link>
            );
          })}
          <span className="ml-auto pl-3 shrink-0"><AccentSwitcher /></span>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 lg:pl-64">
        <MonthlyReminder />
        {children}
      </div>
    </div>
  );
}
