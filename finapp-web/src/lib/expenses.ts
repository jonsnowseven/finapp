// Predefined expense tags (display labels).
export const EXPENSE_TAGS = [
  'Food / Groceries',
  'Restaurants & Cafés',
  'Public services',        // água, luz, gás
  'House services',         // internet, condomínio, cleaning
  'Housing / Rent-Mortgage',
  'Transport',              // fuel, transit, tolls, parking
  'Health & Pharmacy',
  'Insurance',
  'Education',
  'Subscriptions',
  'Shopping',
  'Leisure & Entertainment',
  'Travel',
  'Taxes & Fees',
  'Bank charges',
  'Kids / Family',
  'Pets',
  'Gifts & Donations',
  'Solidarity',
  // Income-side (importer-generated) tags, now selectable in the dropdowns.
  'Salary',
  'Refund',
  'Income',
  'Investments',            // excluded from expense/income totals (see NON_CASHFLOW_TAGS)
  'Other',
] as const;

// Deterministic per-tag colour (stable hue from the canonical slug). Works for
// presets and free-text tags alike. Returns dark-theme-friendly fg + translucent bg.
export function tagColor(canonical: string): { fg: string; bg: string } {
  let h = 0;
  for (let i = 0; i < canonical.length; i++) h = (h * 31 + canonical.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { fg: `hsl(${hue} 70% 65%)`, bg: `hsl(${hue} 70% 65% / 0.15)` };
}

// Internal-movement tags: kept in the ledger but excluded from expense/income totals.
export const NON_CASHFLOW_TAGS = new Set(['transfers', 'savings', 'investments']);
export const countsInTotals = (canonical: string) => !NON_CASHFLOW_TAGS.has(canonical);

// Recurring/committed spend (vs. discretionary), used to gauge budget flexibility.
export const FIXED_TAGS = new Set([
  'housing-rent-mortgage', 'insurance', 'public-services', 'house-services',
  'education', 'subscriptions', 'taxes-fees', 'bank-charges',
]);

// Strip trailing ID-like tokens (containing a digit) so "WWW.AMAZON NO7P501T4"
// → "WWW.AMAZON", giving a reusable merchant key for matching/grouping.
export function merchantKey(m: string | null): string {
  if (!m) return '';
  const words = m.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && /\d/.test(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export interface ExpenseRow { date: string; amount: number; tag: string; tag_label: string | null }
export interface ExpenseSummary {
  months: number;
  avgMonthlyExpenses: number;
  avgMonthlyIncome: number;
  savingsRate: number | null;        // 0..1, from real income vs expenses
  categories: { label: string; pct: number; avg: number }[];  // desc by share of spend
  fixedPct: number | null;
  discretionaryPct: number | null;
  trendPct: number | null;           // recent-3mo avg vs prior-3mo avg
  runwayMonths: number | null;       // liquid savings ÷ avg monthly expenses
}

// Aggregate the expenses ledger into PII-free cashflow metrics over the last
// `windowMonths` COMPLETE calendar months (the current partial month is excluded).
export function summarizeExpenses(
  rows: ExpenseRow[],
  opts: { liquidSavings?: number; windowMonths?: number } = {},
): ExpenseSummary | null {
  const windowMonths = opts.windowMonths ?? 6;
  const now = new Date();
  const startCurMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - windowMonths, 1);

  const monthKeys = new Set<string>();
  const byMonthExp: Record<string, number> = {};
  const byTag: Record<string, { label: string; total: number }> = {};
  let totalExp = 0, totalInc = 0, fixedExp = 0;

  for (const r of rows) {
    const d = new Date(r.date);
    if (d < windowStart || d >= startCurMonth) continue;
    if (!countsInTotals(r.tag)) continue;
    const key = r.date.slice(0, 7);
    monthKeys.add(key);
    const amt = Number(r.amount);
    if (amt < 0) {
      const e = -amt;
      totalExp += e;
      byMonthExp[key] = (byMonthExp[key] ?? 0) + e;
      if (!byTag[r.tag]) byTag[r.tag] = { label: r.tag_label ?? r.tag, total: 0 };
      byTag[r.tag].total += e;
      if (FIXED_TAGS.has(r.tag)) fixedExp += e;
    } else if (amt > 0) {
      totalInc += amt;
    }
  }

  const months = monthKeys.size;
  if (months === 0) return null;

  const avgMonthlyExpenses = totalExp / months;
  const avgMonthlyIncome = totalInc / months;
  const savingsRate = totalInc > 0 ? (totalInc - totalExp) / totalInc : null;
  const categories = Object.values(byTag)
    .map((v) => ({ label: v.label, pct: totalExp ? v.total / totalExp : 0, avg: v.total / months }))
    .sort((a, b) => b.pct - a.pct);
  const fixedPct = totalExp ? fixedExp / totalExp : null;
  const discretionaryPct = fixedPct == null ? null : 1 - fixedPct;

  const sortedKeys = Array.from(monthKeys).sort();
  const recent = sortedKeys.slice(-3), prior = sortedKeys.slice(-6, -3);
  const avg = (keys: string[]) => keys.length ? keys.reduce((a, k) => a + (byMonthExp[k] ?? 0), 0) / keys.length : null;
  const rAvg = avg(recent), pAvg = avg(prior);
  const trendPct = (rAvg != null && pAvg != null && pAvg > 0) ? (rAvg - pAvg) / pAvg : null;

  const runwayMonths = opts.liquidSavings && avgMonthlyExpenses > 0 ? opts.liquidSavings / avgMonthlyExpenses : null;

  return { months, avgMonthlyExpenses, avgMonthlyIncome, savingsRate, categories, fixedPct, discretionaryPct, trendPct, runwayMonths };
}

// Canonical slug: lowercase, collapse spaces, spaces→'-', drop stray punctuation.
const ALLOWED = /^[A-Za-zÀ-ÿ0-9 &/-]+$/;      // letters (incl. Latin accents), digits, space, & / -

export function toCanonical(s: string): string {
  return s.trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-zà-ÿ0-9 &/-]/g, '')
    .replace(/[\s/&]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Title-case a free-text label for display.
function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
    .split(' ').map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Map predefined labels by canonical slug (so "food"/"Food" resolve to the preset).
const PRESET_BY_CANON = new Map(EXPENSE_TAGS.map((t) => [toCanonical(t), t]));

export interface TagResult { ok: boolean; canonical: string; label: string; error?: string; }

// Validate + normalize a tag (predefined or free text).
export function validateTag(input: string): TagResult {
  const t = input.trim().replace(/\s+/g, ' ');
  if (t.length < 2) return { ok: false, canonical: '', label: '', error: 'Tag too short (min 2 chars).' };
  if (t.length > 30) return { ok: false, canonical: '', label: '', error: 'Tag too long (max 30 chars).' };
  if (!ALLOWED.test(t)) {
    return { ok: false, canonical: '', label: '', error: 'Only letters, numbers, spaces and & / -' };
  }
  const canonical = toCanonical(t);
  if (!canonical) return { ok: false, canonical: '', label: '', error: 'Invalid tag.' };
  const preset = PRESET_BY_CANON.get(canonical);
  return { ok: true, canonical, label: preset ?? titleCase(t) };
}
