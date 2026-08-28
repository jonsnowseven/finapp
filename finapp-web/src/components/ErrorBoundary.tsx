'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Catches render-time crashes anywhere below it in the tree (data-fetch
// failures don't land here — see devError.ts/DevErrorOverlay for those).
// Dev shows the real error + stack; production shows a generic message and
// still logs to the console so it's visible in Vercel's logs.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error('[render crash]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const isDev = process.env.NODE_ENV !== 'production';
    return (
      <div className="max-w-2xl mx-auto p-8 mt-12">
        <div className="flex gap-3 p-5 rounded-2xl border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-900/10">
          <AlertTriangle size={20} className="shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-semibold text-red-700 dark:text-red-400">Something went wrong rendering this page.</p>
            {isDev ? (
              <pre className="mt-2 text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap break-words font-mono">
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            ) : (
              <p className="mt-1 text-sm text-red-600 dark:text-red-300/80">Try refreshing. If it keeps happening, let the administrator know.</p>
            )}
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
