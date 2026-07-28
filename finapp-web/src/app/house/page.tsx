'use client';
import { useState } from 'react';
import { useHideBalance } from '../../lib/useHideBalance';
import EyeToggle from '../../components/EyeToggle';

// ── Portugal (Continente) acquisition taxes ──────────────────────────────
// IMT brackets 2025: [upperLimit, marginalRate, deduction]. Approximate —
// verify against the current Orçamento do Estado tables.
type Purpose = 'hpp' | 'secondary';
const IMT_HPP: [number, number, number][] = [
  [104261, 0, 0], [142618, 0.02, 2085.22], [194458, 0.05, 6363.76],
  [324058, 0.07, 10252.92], [648022, 0.08, 13493.50], [1128287, 0.06, 0], [Infinity, 0.075, 0],
];
const IMT_SEC: [number, number, number][] = [
  [104261, 0.01, 0], [142618, 0.02, 1042.61], [194458, 0.05, 5321.15],
  [324058, 0.07, 9210.31], [621501, 0.08, 12450.89], [1128287, 0.06, 0], [Infinity, 0.075, 0],
];
function computeIMT(price: number, purpose: Purpose): number {
  const table = purpose === 'hpp' ? IMT_HPP : IMT_SEC;
  for (const [lim, rate, ded] of table) if (price <= lim) return Math.max(0, price * rate - ded);
  return 0;
}
const annuity = (P: number, annualPct: number, months: number) => {
  if (!(P > 0 && months > 0)) return 0;
  const r = annualPct / 1200;
  return r > 0 ? (P * r) / (1 - Math.pow(1 + r, -months)) : P / months;
};

export default function HousePage() {
  const { money, hidden } = useHideBalance();

  // Buying
  const [price, setPrice] = useState(300000);
  const [purpose, setPurpose] = useState<Purpose>('hpp');
  const [ownFunds, setOwnFunds] = useState(30000);
  const [rate, setRate] = useState(3.5);
  const [termYears, setTermYears] = useState(30);
  const [notary, setNotary] = useState(1200);
  const [bankFees, setBankFees] = useState(600);

  // Selling current home (optional — 0 value = not selling)
  const [curValue, setCurValue] = useState(0);
  const [curMortgage, setCurMortgage] = useState(0);
  const [commissionPct, setCommissionPct] = useState(5);
  const [cgtExempt, setCgtExempt] = useState(true);   // reinvesting in new HPP → exempt
  const [cgt, setCgt] = useState(0);

  // ── Acquisition costs ──
  const imt = computeIMT(price, purpose);
  const stampPurchase = price * 0.008;                 // Imposto de Selo 0.8% on price
  const costsExLoanStamp = imt + stampPurchase + notary + bankFees;

  // ── Sale of current home ──
  const selling = curValue > 0;
  const commission = selling ? curValue * (commissionPct / 100) * 1.23 : 0;   // + 23% IVA
  const cgtDue = selling && !cgtExempt ? Math.max(0, cgt) : 0;
  const netProceeds = selling ? Math.max(0, curValue - commission - curMortgage - cgtDue) : 0;

  // ── Financing (loan = shortfall, stamp duty 0.6% on the loan) ──
  const cash = ownFunds + netProceeds;
  let loan = Math.max(0, price + costsExLoanStamp - cash);
  const stampLoan = loan * 0.006;
  loan = Math.max(0, price + costsExLoanStamp + stampLoan - cash);
  const totalCosts = costsExLoanStamp + stampLoan;
  const totalToBuy = price + totalCosts;
  const monthly = annuity(loan, rate, termYears * 12);
  const ltv = price > 0 ? loan / price : 0;
  const overLtv = ltv > 0.9;
  const extraCashNeeded = overLtv ? loan - 0.9 * price : 0;
  const totalInterest = monthly > 0 ? monthly * termYears * 12 - loan : 0;

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Buy a House</h2>
          <p className="text-gray-500 dark:text-ink-muted text-sm mt-1">Simulate the full cost of buying — taxes, fees, loan — and optionally selling your current home. Nothing is saved.</p>
        </div>
        <div className="shrink-0 mt-1"><EyeToggle /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Buying inputs */}
        <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-3">New home</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Purchase price (€)"><Num value={price} step={5000} onChange={setPrice} blur={hidden} /></Field>
            <Field label="Purpose">
              <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)} className={inp}>
                <option value="hpp">Permanent home (HPP)</option>
                <option value="secondary">Secondary / other</option>
              </select>
            </Field>
            <Field label="Own funds / savings (€)"><Num value={ownFunds} step={1000} onChange={setOwnFunds} blur={hidden} /></Field>
            <Field label="Loan rate (%)"><Num value={rate} step={0.1} onChange={setRate} /></Field>
            <Field label="Loan term (years)"><Num value={termYears} step={1} onChange={(v) => setTermYears(Math.round(v))} /></Field>
            <Field label="Notary + registration (€)"><Num value={notary} step={100} onChange={setNotary} /></Field>
            <Field label="Bank fees (€)"><Num value={bankFees} step={100} onChange={setBankFees} /></Field>
          </div>
        </div>

        {/* Selling inputs */}
        <div className="bg-white dark:bg-surface p-4 rounded-2xl border border-gray-200 dark:border-line">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-3">Sell current home (optional)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Current home value (€)"><Num value={curValue} step={5000} onChange={setCurValue} blur={hidden} /></Field>
            <Field label="Outstanding mortgage (€)"><Num value={curMortgage} step={1000} onChange={setCurMortgage} blur={hidden} /></Field>
            <Field label="Agency commission (% + IVA)"><Num value={commissionPct} step={0.5} onChange={setCommissionPct} /></Field>
            <Field label="Capital-gains tax">
              <label className="flex items-center gap-2 text-sm mt-1.5 text-gray-700 dark:text-ink">
                <input type="checkbox" checked={cgtExempt} onChange={(e) => setCgtExempt(e.target.checked)}
                  className="accent-indigo-600 dark:accent-gold-500" />
                Reinvesting → exempt
              </label>
            </Field>
            {!cgtExempt && <Field label="Est. capital-gains tax (€)"><Num value={cgt} step={1000} onChange={setCgt} blur={hidden} /></Field>}
          </div>
          {selling && (
            <p className="text-xs text-gray-500 dark:text-ink-muted mt-3">
              Net sale proceeds: <strong className="font-num dark:text-ink">{money(netProceeds)}</strong>
              <span className="text-gray-400 dark:text-ink-faint"> (value − {money(commission)} commission − {money(curMortgage)} mortgage{cgtDue ? ` − ${money(cgtDue)} CGT` : ''})</span>
            </p>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <Card label="Monthly payment" value={money(monthly)} sub={`${termYears}y @ ${rate.toFixed(2)}%`} accent />
        <Card label="Loan required" value={money(loan)} sub={`LTV ${(ltv * 100).toFixed(0)}%`} bad={overLtv} />
        <Card label="Upfront cash (taxes+fees)" value={money(totalCosts)} sub="paid at the deed" />
        <Card label="Cash available" value={money(cash)} sub="savings + net sale"
          good={cash >= totalCosts} bad={cash < totalCosts} />
      </div>

      {/* Cost breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Acquisition cost breakdown</p>
          <Row label={`IMT (${purpose === 'hpp' ? 'permanent home' : 'secondary'})`} value={money(imt)} hidden={hidden} />
          <Row label="Stamp duty on purchase (0.8%)" value={money(stampPurchase)} hidden={hidden} />
          <Row label="Stamp duty on loan (0.6%)" value={money(stampLoan)} hidden={hidden} />
          <Row label="Notary + registration" value={money(notary)} hidden={hidden} />
          <Row label="Bank fees" value={money(bankFees)} hidden={hidden} />
          <div className="border-t border-gray-100 dark:border-line mt-2 pt-2">
            <Row label="Total taxes + fees" value={money(totalCosts)} strong hidden={hidden} />
            <Row label="Total to buy (price + costs)" value={money(totalToBuy)} strong hidden={hidden} />
          </div>
        </div>

        <div className="bg-white dark:bg-surface p-6 rounded-2xl border border-gray-200 dark:border-line">
          <p className="label-caps text-gray-400 dark:text-ink-muted mb-4">Financing</p>
          <Row label="Total to buy" value={money(totalToBuy)} hidden={hidden} />
          <Row label="− Own funds" value={money(ownFunds)} hidden={hidden} />
          {selling && <Row label="− Net sale proceeds" value={money(netProceeds)} hidden={hidden} />}
          <div className="border-t border-gray-100 dark:border-line mt-2 pt-2">
            <Row label="Loan required" value={money(loan)} strong hidden={hidden} />
            <Row label="Total interest (to payoff)" value={money(totalInterest)} hidden={hidden} />
          </div>
          {overLtv && (
            <p className="text-sm text-red-500 dark:text-loss mt-3">
              LTV {(ltv * 100).toFixed(0)}% exceeds the typical 90% bank limit — you'd need about {money(extraCashNeeded)} more cash.
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-6 max-w-3xl leading-relaxed">
        Estimates for mainland Portugal. IMT uses the 2025 Continente brackets (approximate — confirm the current tables). Stamp duty: 0.8% on the price, 0.6% on the loan (terms &gt; 5y). Capital-gains tax on the sale is exempt for residents reinvesting in a new permanent home; otherwise enter an estimate. Not tax advice.
      </p>
    </main>
  );
}

const inp = 'bg-gray-50 dark:bg-surface-2 border border-gray-300 dark:border-line text-sm rounded-lg px-2 py-1.5 text-gray-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-gold-500 w-full';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-400 normal-case">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
function Num({ value, step, onChange, blur }: { value: number; step: number; onChange: (v: number) => void; blur?: boolean }) {
  return (
    <div className={blur ? 'blur-sm select-none pointer-events-none' : ''}>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className={inp} />
    </div>
  );
}
function Card({ label, value, sub, accent, good, bad }: { label: string; value: string; sub?: string; accent?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="bg-white dark:bg-surface p-5 rounded-xl border border-gray-200 dark:border-line">
      <p className="label-caps text-gray-400 dark:text-ink-muted">{label}</p>
      <p className={`font-num text-2xl mt-2.5 ${good ? 'text-green-600 dark:text-gain' : bad ? 'text-red-500 dark:text-loss' : accent ? 'text-indigo-600 dark:text-gold-500' : 'dark:text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-ink-faint mt-1">{sub}</p>}
    </div>
  );
}
function Row({ label, value, strong, hidden }: { label: string; value: string; strong?: boolean; hidden?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-1 text-sm">
      <span className={strong ? 'text-gray-800 dark:text-ink font-medium' : 'text-gray-500 dark:text-ink-muted'}>{label}</span>
      <span className={`font-num ${strong ? 'text-gray-900 dark:text-ink font-semibold' : 'text-gray-600 dark:text-ink-muted'}`}>{value}</span>
    </div>
  );
}
