'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // Prevent hydration mismatch by only rendering after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-8 h-8 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />;
  }

  return (
    <button
      onClick={() => {
        if (theme === 'light') setTheme('dark');
        else if (theme === 'dark') setTheme('system');
        else setTheme('light');
      }}
      // Updated the dark: hover and background classes here:
      className="p-2 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-[#111] dark:border dark:border-gold-500/30 dark:hover:bg-[#1a1a1a] text-gray-600 dark:text-gold-500 transition-colors"
      title={`Current theme: ${theme}. Click to change.`}
    >
      {theme === 'light' && <Sun size={18} />}
      {theme === 'dark' && <Moon size={18} />}
      {theme === 'system' && <Monitor size={18} />}
    </button>
  );
}
