// Hex colors per entity — shared by the dashboard cards and the activity chart.
// Keep in sync with the Tailwind badge classes in the transactions table.
export const ENTITY_HEX: Record<string, string> = {
  'Kraken':         '#a855f7', // purple
  'DeGiro':         '#f97316', // orange
  'Trade Republic': '#0ea5e9', // sky
  'Banco Invest':   '#10b981', // emerald
  'SGF':            '#f59e0b', // amber
  'Revolut':        '#6366f1', // indigo
  'Aforro':         '#f43f5e', // rose
  'Lego':           '#e3000b', // LEGO red
};
export const FALLBACK_HEX = '#D4AF37'; // gold
export const entityHex = (e: string) => ENTITY_HEX[e] ?? FALLBACK_HEX;

// Sign of each transaction type when computing a net contributed/invested balance.
// Money in (buy/deposit/interest/dividend) adds; sell (withdrawal) subtracts.
export const TYPE_SIGN: Record<string, number> = {
  buy: 1,
  deposit: 1,
  interest: 1,
  dividend: 1,
  sell: -1,
};
export const typeSign = (t: string) => TYPE_SIGN[t?.toLowerCase()] ?? 1;

// Default assumed annual return (%) per entity, used to prefill the forecast page.
// All are editable in the UI. Known-rate products use their rate; market-exposed
// entities use a conservative long-run estimate.
export const DEFAULT_ANNUAL_RETURN: Record<string, number> = {
  'Aforro':         2.5,  // Série F gross cap
  'Revolut':        1.8,  // 2.5% gross − 28% PT withholding
  'Banco Invest':   4.0,  // managed PPR
  'SGF':            4.0,  // managed PPR
  'Trade Republic': 7.0,  // diversified ETFs
  'DeGiro':         7.0,  // equities/ETFs
  'Kraken':         10.0, // crypto (volatile)
};
export const defaultReturn = (entity: string) => DEFAULT_ANNUAL_RETURN[entity] ?? 7.0;

// Default Portuguese tax (%) applied to GAINS at withdrawal, per entity. Editable in UI.
//  - Equities/ETFs & crypto: 28% mais-valias.
//  - PPR (Banco Invest, SGF): ~8% if held ≥5 years.
//  - Aforro: 28% on interest.
//  - Revolut Boosted: 0% here (modelled net — 28% already withheld at source).
export const DEFAULT_GAINS_TAX: Record<string, number> = {
  'Aforro':         28,
  'Revolut':        0,
  'Banco Invest':   8,
  'SGF':            8,
  'Trade Republic': 28,
  'DeGiro':         28,
  'Kraken':         28,
};
export const defaultTax = (entity: string) => DEFAULT_GAINS_TAX[entity] ?? 28;

// Default TER (Total Expense Ratio, % per year) per entity — the fund's annual fee,
// subtracted from the assumed return. Editable in the UI.
//  - Funds/PPRs carry a TER; direct stocks, savings accounts and crypto don't.
export const DEFAULT_TER: Record<string, number> = {
  'Aforro':         0,
  'Revolut':        0,
  'Kraken':         0,
  'Trade Republic': 0.2,  // ETFs
  'DeGiro':         0.2,  // ETFs (direct stocks: set to 0)
  'Banco Invest':   1.5,  // managed PPR
  'SGF':            1.5,  // managed PPR
};
export const defaultTer = (entity: string) => DEFAULT_TER[entity] ?? 0.2;

// Default recurring monthly contribution (€) per entity, used to prefill the forecast.
// Editable in the UI; falls back to history-detected amount for unlisted entities.
export const DEFAULT_MONTHLY_BUY: Record<string, number> = {
  'Aforro':         50,
  'Banco Invest':   100,
  'DeGiro':         0,
  'Kraken':         0,
  'Revolut':        200,
  'Trade Republic': 850,
};

// Maps the asset_name stored by the Kraken importer to a Yahoo Finance EUR symbol,
// used to value live crypto holdings. Keys match Kraken importer's ASSET_MAP names.
export const CRYPTO_EUR_SYMBOL: Record<string, string> = {
  'Bitcoin':   'BTC-EUR',
  'Ethereum':  'ETH-EUR',
  'Solana':    'SOL-EUR',
  'Cardano':   'ADA-EUR',
  'Polkadot':  'DOT-EUR',
  'Polygon':   'MATIC-EUR',
  'Chainlink': 'LINK-EUR',
  'Avalanche': 'AVAX-EUR',
  'Ripple':    'XRP-EUR',
  'Litecoin':  'LTC-EUR',
  'Cosmos':    'ATOM-EUR',
  'Uniswap':   'UNI-EUR',
  'Algorand':  'ALGO-EUR',
};
// Fallback: assume a bare ticker like "DOGE" trades as "DOGE-EUR"
export const cryptoSymbol = (assetName: string) =>
  CRYPTO_EUR_SYMBOL[assetName] ?? `${assetName.toUpperCase()}-EUR`;

// Maps the asset_name stored by the Trade Republic importer to a EUR-quoted
// Yahoo Finance ticker (Xetra/Euronext listings of the same ISIN), used to value
// live ETF holdings. VERIFY these against your own positions — wrong tickers price
// the wrong fund. Assets not in this map are skipped from the valuation.
export const TR_EUR_SYMBOL: Record<string, string> = {
  'Core MSCI World USD (Acc)':            'EUNL.DE', // iShares Core MSCI World, IE00B4L5Y983
  'S&P 500 Information Tech USD (Acc)':   'QDVE.DE', // iShares S&P 500 IT Sector, IE00B3WJKG14
  'Core MSCI EM IMI USD (Acc)':           'IS3N.DE', // iShares Core MSCI EM IMI, IE00BKM4GZ66
  'Core Stoxx Europe 600 EUR (Acc)':      'MEUD.PA', // Amundi Core Stoxx Europe 600, LU0908500753
  'Gold Miners USD (Acc)':                'G2X.DE',  // VanEck Gold Miners, IE00BQQP9F84
};
