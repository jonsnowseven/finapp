// LEGO investment helpers.
//
// Researched approximate annual appreciation (CAGR, %) for RETIRED sets, by theme.
// Sources: aftermarket trackers (BrickEconomy/BrickLink) long-run averages — rough
// guidance only, editable per set in the UI. Retired exclusive/large sets trend
// higher; licensed/mass sets lower.
export const LEGO_THEME_CAGR: Record<string, number> = {
  'Star Wars':           11,
  'Icons':               11,
  'Creator Expert':      11,
  'Ideas':               11,
  'Harry Potter':         9,
  'Architecture':         8,
  'Botanical':            8,
  'Marvel Super Heroes':  7,
  'Marvel':               7,
  'Disney':               8,
  'Lord of the Rings':   10,
  'Technic':              5,
  'City':                 4,
  'Ninjago':              6,
  'Creator':              6,
  'Speed Champions':      6,
  'Super Mario':          6,
  'Minecraft':            5,
  'Jurassic World':       6,
  'Batman':               6,
  'DC':                   6,
  'Avatar':               6,
  'Friends':              4,
};
export const DEFAULT_LEGO_CAGR = 7;

// Known themes, longest first so multi-word themes win over their prefixes.
const THEMES = Object.keys(LEGO_THEME_CAGR).sort((a, b) => b.length - a.length);

// Split a combined "Name Theme" string into { name, theme } by locating the
// earliest known theme keyword. Falls back to the trailing "A / B" guess.
export function splitNameTheme(mid: string): { name: string; theme: string } {
  let best = -1;
  let bestKw = '';
  for (const kw of THEMES) {
    const i = mid.indexOf(kw);
    if (i >= 0 && (best === -1 || i < best || (i === best && kw.length > bestKw.length))) {
      best = i; bestKw = kw;
    }
  }
  if (best > 0) {
    return { name: mid.slice(0, best).trim(), theme: mid.slice(best).trim() };
  }
  // Fallback: split at the word before the first " / "
  const slash = mid.indexOf('/');
  if (slash > 0) {
    const left = mid.slice(0, slash).trimEnd();
    const sp = left.lastIndexOf(' ');
    if (sp > 0) return { name: left.slice(0, sp).trim(), theme: (left.slice(sp + 1) + mid.slice(slash)).trim() };
  }
  return { name: mid.trim(), theme: '' };
}

// Annual appreciation rate for a theme string (matches the first known keyword).
export function legoRate(theme: string | null | undefined): number {
  if (!theme) return DEFAULT_LEGO_CAGR;
  for (const kw of THEMES) {
    if (theme.includes(kw)) return LEGO_THEME_CAGR[kw];
  }
  return DEFAULT_LEGO_CAGR;
}
