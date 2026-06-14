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

// Split a combined "NameTheme" string into { name, theme }.
// Theme is "<Theme> / <Subtheme>" or a bare "<Theme>". The Theme is a known
// keyword that sits at the START of the theme — i.e. immediately before the
// first " / ", or (no subtheme) at the very end of the string. This avoids
// matching a theme word that appears inside the NAME (e.g. "The Batman …").
export function splitNameTheme(mid: string): { name: string; theme: string } {
  mid = mid.trim();
  const slash = mid.indexOf(' / ');

  if (slash > 0) {
    // Known keyword ending exactly at the slash → start of theme. Prefer longest.
    let bestKw = '';
    for (const kw of THEMES) {
      if (kw.length > bestKw.length && mid.slice(slash - kw.length, slash) === kw) bestKw = kw;
    }
    const start = bestKw ? slash - bestKw.length : (() => {
      // Fallback: theme is the single word before " / "
      const left = mid.slice(0, slash);
      const sp = left.lastIndexOf(' ');
      return sp > 0 ? sp + 1 : 0;
    })();
    return { name: mid.slice(0, start).trim(), theme: mid.slice(start).trim() };
  }

  // No subtheme: a known theme as the trailing suffix (e.g. "…ShopsHarry Potter")
  for (const kw of THEMES) {
    if (mid.endsWith(kw)) return { name: mid.slice(0, mid.length - kw.length).trim(), theme: kw };
  }
  return { name: mid, theme: '' };
}

// Annual appreciation rate for a theme string (matches the first known keyword).
export function legoRate(theme: string | null | undefined): number {
  if (!theme) return DEFAULT_LEGO_CAGR;
  for (const kw of THEMES) {
    if (theme.includes(kw)) return LEGO_THEME_CAGR[kw];
  }
  return DEFAULT_LEGO_CAGR;
}
