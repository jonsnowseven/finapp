export interface CashFlow { date: Date; amount: number; }

// Money-weighted annual return (XIRR). Contributions negative, withdrawals and
// the current portfolio value positive. Returns a decimal rate (0.08 = 8%) or null.
export function xirr(cfs: CashFlow[]): number | null {
  if (cfs.length < 2) return null;
  const flows = [...cfs].sort((a, b) => a.date.getTime() - b.date.getTime());
  const hasPos = flows.some((c) => c.amount > 0);
  const hasNeg = flows.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = flows[0].date.getTime();
  const yrs = (d: Date) => (d.getTime() - t0) / (365 * 24 * 3600 * 1000);
  const npv = (r: number) => flows.reduce((s, c) => s + c.amount / Math.pow(1 + r, yrs(c.date)), 0);

  // Bisection on a wide bracket; fall back to null if no sign change.
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
