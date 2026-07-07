'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { createSupabaseBrowserClient } from '../lib/supabase-browser';

const KEY = 'finapp_import_reminder_dismissed';
const REMINDER_DAY = 3; // show from the 3rd of each month onward

// Monthly nudge to import last month's bank statements + broker transactions.
// Appears from the 3rd onward, dismissible per-month (reappears next month).
export default function MonthlyReminder() {
  const [show, setShow] = useState(false);
  const supabase = createSupabaseBrowserClient();

  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

  useEffect(() => {
    const now = new Date();
    if (now.getDate() < REMINDER_DAY) return;
    if (localStorage.getItem(KEY) === monthKey) return;
    // Only nudge signed-in users.
    supabase.auth.getUser().then(({ data }) => { if (data.user) setShow(true); });
  }, []);

  if (!show) return null;

  const prevMonth = new Date();
  prevMonth.setDate(1);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevLabel = prevMonth.toLocaleString('en', { month: 'long', year: 'numeric' });

  function dismiss() {
    localStorage.setItem(KEY, monthKey);
    setShow(false);
  }

  return (
    <div className="border-b border-gold-500/30 bg-gold-500/10 dark:bg-gold-500/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 text-sm">
        <CalendarClock size={18} className="shrink-0 text-gold-600 dark:text-gold-400" />
        <p className="flex-1 text-gray-700 dark:text-ink">
          <span className="font-semibold">Monthly import reminder</span>
          <span className="hidden sm:inline text-gray-500 dark:text-ink-muted"> — {prevLabel} statements are usually ready. Import your expenses and transactions.</span>
        </p>
        <Link href="/expenses" onClick={dismiss}
          className="label-caps shrink-0 px-2.5 py-1 rounded-md bg-gold-500 text-black hover:bg-gold-600 transition-colors">Expenses</Link>
        <Link href="/transactions" onClick={dismiss}
          className="label-caps shrink-0 px-2.5 py-1 rounded-md border border-gold-500/40 text-gray-700 dark:text-gold-300 hover:bg-gold-500/10 transition-colors">Transactions</Link>
        <button onClick={dismiss} aria-label="Dismiss reminder"
          className="shrink-0 p-1 rounded-md text-gray-400 dark:text-ink-muted hover:text-gray-700 dark:hover:text-ink hover:bg-black/5 dark:hover:bg-white/5">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
