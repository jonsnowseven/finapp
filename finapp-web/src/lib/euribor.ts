// Euribor rates from the ECB Data Portal (SDMX). Dataset FM, series:
//   FM.<freq>.U2.EUR.RT.MM.EURIBOR<tenor>D_.HSTA   (rate in %).
// freq: M = monthly average, B = business-daily.

export type Tenor = '1M' | '3M' | '6M' | '12M';
export const TENORS: Tenor[] = ['1M', '3M', '6M', '12M'];

const CODE: Record<Tenor, string> = {
  '1M': 'EURIBOR1MD_',
  '3M': 'EURIBOR3MD_',
  '6M': 'EURIBOR6MD_',
  '12M': 'EURIBOR1YD_',
};

export interface EuriborObs { period: string; rate: number }   // period: "YYYY-MM" (M) or "YYYY-MM-DD" (B)
export interface EuriborRate { rate: number; period: string }

// Fetch the last `n` observations of a tenor at a frequency (M or B).
export async function fetchEuriborSeries(
  tenor: Tenor, freq: 'M' | 'B', n = 1, fresh = false,
): Promise<EuriborObs[]> {
  const url =
    `https://data-api.ecb.europa.eu/service/data/FM/${freq}.U2.EUR.RT.MM.${CODE[tenor]}.HSTA` +
    `?lastNObservations=${n}&format=csvdata`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv' },
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 86400 } }),
  });
  if (!res.ok) throw new Error(`ECB request failed: ${res.status}`);

  const lines = (await res.text()).trim().split('\n');
  if (lines.length < 2) throw new Error('ECB returned no observations');
  const header = lines[0].split(',');
  const valIdx = header.indexOf('OBS_VALUE');
  const perIdx = header.indexOf('TIME_PERIOD');
  if (valIdx < 0) throw new Error('ECB CSV missing OBS_VALUE');

  const out: EuriborObs[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const rate = parseFloat(c[valIdx]);
    if (isFinite(rate)) out.push({ period: perIdx >= 0 ? c[perIdx] : '', rate });
  }
  return out;
}

// Latest monthly-average rate for a tenor.
export async function fetchEuriborLatest(tenor: Tenor, fresh = false): Promise<EuriborRate> {
  const obs = await fetchEuriborSeries(tenor, 'M', 1, fresh);
  const last = obs[obs.length - 1];
  return { rate: last.rate, period: last.period };
}

// Back-compat: 3-month monthly rate (used by the portfolio valuation).
export async function fetchEuribor3M(fresh = false): Promise<EuriborRate> {
  if (process.env.EURIBOR_3M_RATE) {
    return { rate: parseFloat(process.env.EURIBOR_3M_RATE), period: 'override' };
  }
  return fetchEuriborLatest('3M', fresh);
}
