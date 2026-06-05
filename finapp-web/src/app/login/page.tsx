'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '../../lib/supabase-browser';

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Sign-in failed. Your account may not be authorised — contact the administrator.',
  signup_disabled: 'New sign-ups are disabled. Your account must be pre-approved.',
};

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) setError(ERROR_MESSAGES[urlError] ?? 'Authentication error. Please try again.');
  }, [searchParams]);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-indigo-600 dark:text-gold-500">FinApp</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Personal Portfolio Monitor</p>
        </div>

        <div className="bg-white dark:bg-[#0a0a0a] rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm p-8">
          <h2 className="text-lg font-semibold mb-6 text-gray-900 dark:text-white">Sign in to your account</h2>

          {error && (
            <p className="mb-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</p>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-gray-300 dark:border-gold-500/30 bg-white dark:bg-[#111] text-gray-900 dark:text-white font-medium text-sm hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="animate-pulse">Redirecting...</span>
            ) : (
              <>
                <GoogleIcon />
                Continue with Google
              </>
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-600">
          Access is restricted to authorised accounts only.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
