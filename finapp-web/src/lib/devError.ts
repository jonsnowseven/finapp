// Dev-only error surfacing. Every call also console.errors (all envs) so prod
// errors are still visible in Vercel function/browser logs; the visible
// on-page toast (DevErrorOverlay) only renders outside production, since it
// can carry raw error messages we don't want end users seeing.
type Listener = (err: DevErrorEntry) => void;

export interface DevErrorEntry {
  id: number;
  context: string;
  message: string;
  time: string;
}

let listeners: Listener[] = [];
let counter = 0;

export function reportError(context: string, error: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, error);
  if (process.env.NODE_ENV === 'production') return;

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  const entry: DevErrorEntry = { id: ++counter, context, message, time: new Date().toLocaleTimeString() };
  listeners.forEach((l) => l(entry));
}

export function subscribeDevErrors(listener: Listener) {
  listeners.push(listener);
  return () => { listeners = listeners.filter((l) => l !== listener); };
}
