export interface Quote {
  symbol: string;
  price: number;
  currency: string;
  name: string;
  lastUpdated: string;
}

export async function fetchQuote(symbol: string, fresh = false): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 3600 } }),
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed for ${symbol}: ${response.status}`);
  }

  const json = await response.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data returned for symbol ${symbol}`);

  const meta = result.meta;
  const price: number = meta.regularMarketPrice ?? meta.previousClose;
  const currency: string = meta.currency ?? 'EUR';
  const name: string = meta.shortName ?? meta.longName ?? symbol;
  const lastUpdated = new Date(meta.regularMarketTime * 1000).toISOString();

  return { symbol, price, currency, name, lastUpdated };
}

export async function fetchMultipleQuotes(symbols: string[], fresh = false): Promise<Quote[]> {
  const results = await Promise.allSettled(symbols.map((s) => fetchQuote(s, fresh)));
  return results
    .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
    .map((r) => r.value);
}

// Resolves an ISIN to its primary Yahoo ticker via the search endpoint.
async function resolveIsinSymbol(isin: string, fresh = false): Promise<string | null> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 86400 } }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const quotes: any[] = json?.quotes ?? [];
  // Prefer equities/ETFs with a usable symbol
  const pick = quotes.find((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF')) ?? quotes[0];
  return pick?.symbol ?? null;
}

// EUR per 1 unit of `currency` (e.g. USD -> ~0.86). EUR returns 1.
async function fetchFxToEur(currency: string, fresh = false): Promise<number> {
  if (!currency || currency === 'EUR') return 1;
  try {
    const q = await fetchQuote(`${currency}EUR=X`, fresh);
    return q.price || 0;
  } catch {
    return 0;
  }
}

export interface IsinValuation {
  isin: string;
  symbol: string;
  name: string;
  price: number;        // native price
  currency: string;     // native currency
  priceEur: number;     // price converted to EUR
}

// Resolves an ISIN, quotes it, and converts the price to EUR.
export async function valuateIsin(isin: string, fresh = false): Promise<IsinValuation | null> {
  const symbol = await resolveIsinSymbol(isin, fresh);
  if (!symbol) return null;
  const q = await fetchQuote(symbol, fresh);
  const fx = await fetchFxToEur(q.currency, fresh);
  if (!fx) return null; // no FX rate -> can't express in EUR
  return {
    isin,
    symbol,
    name: q.name,
    price: q.price,
    currency: q.currency,
    priceEur: q.price * fx,
  };
}

export async function valuateIsins(isins: string[], fresh = false): Promise<IsinValuation[]> {
  const results = await Promise.allSettled(isins.map((i) => valuateIsin(i, fresh)));
  return results
    .filter((r): r is PromiseFulfilledResult<IsinValuation | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is IsinValuation => v !== null);
}
