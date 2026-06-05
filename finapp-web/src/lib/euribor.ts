// Fetches the latest 3-month Euribor from the ECB Data Portal (SDMX).
// Series: FM.M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA  (monthly, 3-month Euribor, %).
// Returns the rate as a percentage (e.g. 2.143) and its reference period.

export interface EuriborRate {
  rate: number;      // percent, e.g. 2.143
  period: string;    // e.g. "2026-05"
}

export async function fetchEuribor3M(fresh = false): Promise<EuriborRate> {
  // Allow a manual override (useful if the ECB endpoint is unreachable in your env)
  if (process.env.EURIBOR_3M_RATE) {
    return { rate: parseFloat(process.env.EURIBOR_3M_RATE), period: 'override' };
  }

  const url =
    'https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA' +
    '?lastNObservations=1&format=csvdata';

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv' },
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 86400 } }),
  });
  if (!res.ok) throw new Error(`ECB request failed: ${res.status}`);

  const csv = await res.text();
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('ECB returned no observations');

  const header = lines[0].split(',');
  const valIdx = header.indexOf('OBS_VALUE');
  const perIdx = header.indexOf('TIME_PERIOD');
  if (valIdx < 0) throw new Error('ECB CSV missing OBS_VALUE');

  const last = lines[lines.length - 1].split(',');
  const rate = parseFloat(last[valIdx]);
  if (!isFinite(rate)) throw new Error('ECB CSV value not numeric');

  return { rate, period: perIdx >= 0 ? last[perIdx] : '' };
}
