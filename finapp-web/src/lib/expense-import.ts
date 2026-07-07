import { validateTag } from './expenses';

// Strip accents + uppercase for robust keyword matching.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// PT money: NBSP/space thousands, comma decimal; ActivoBank debits use "--".
export function parsePtMoney(raw: string): number {
  const s = raw.trim();
  const neg = s.replace(/\s/g, '').startsWith('-');
  const digits = s.replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(digits);
  if (!isFinite(n)) return NaN;
  return neg ? -n : n;
}

// DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD
export function toIso(d: string): string {
  const m = d.trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// First matching rule wins. Labels are from EXPENSE_TAGS.
const RULES: [RegExp, string][] = [
  [/VIAVERDE|VIA VERDE|PETROPRIX|GALP|REPSOL|CEPSA|PARQUE|ESTACIONA|NORAUTO|COMBOIOS|CARRIS|METRO /, 'Transport'],
  [/FARMACIA|WELLS|CUF|HOSPITAL|CLINICA|LENTES DE CONTACTO|SAUDE|DENT/, 'Health & Pharmacy'],
  [/SEGURO|GENERALI|FIDELIDADE|AEGON|MULTICARE|MULTI-?RISCOS|REALVSEGUROS/, 'Insurance'],
  [/NETFLIX|SPOTIFY|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|DISNEY|HBO|YOUTUBE|PRIME VIDEO/, 'Subscriptions'],
  [/VODAFONE|MEO|NOWO|SMAS|EDP|AGUAS|ELETRIC|GAS NATURAL|GALP ENERGIA/, 'Public services'],
  [/CONDOMINIO/, 'House services'],
  [/CREDITO HABITACAO|HABITACAO/, 'Housing / Rent-Mortgage'],
  [/CONTINENTE|PINGO DOCE|ALDI|MERCADONA|AUCHAN|LIDL|MINIPRECO|INTERMARCHE|MERCADO DO PEIXE|P PORTUGUESA|MOREIRA PINTO/, 'Food / Groceries'],
  [/CAFE|PASTELARIA|RESTAURA|SUSHI|PIZZA|GLOVO|UBER EATS|MCDONALD|BURGER|ACAI|QUIOSQUE|BOA NOVA|COLINAS|CREMOSOS|BATIKANOS|ALPHA CAFE|MY BREAK|DELTA CA|SABORES|ESTRELA BONITA|SUIFENG|MR. ?PIZZA|ZEN /, 'Restaurants & Cafés'],
  [/AMAZON|PRIMARK|CHICCO|FOTOSPORT|WORTEN|FNAC|ZARA|SHEIN|CABELEIR|DARIO VEIGA|SERGIO ZANOTTI/, 'Shopping'],
  [/IMPOSTO|PAG\.DUC|DUC |SELO/, 'Taxes & Fees'],
  [/COMISSAO|CUSTO DE SERVICO|MANUTENCAO/, 'Bank charges'],
];

// Tag any row (money in or out). Nothing is skipped — transfers, investments,
// savings and income get their own tags so aggregates reflect real cashflow.
export function classify(desc: string, signed: number): string {
  const n = norm(desc);
  if (signed > 0) {                                    // money in
    if (/ORDENADO|SALARIO|VENCIMENTO/.test(n)) return 'Salary';
    if (/^CRED\.|REEMBOLSO|ESTORNO|DEVOLUC|CREDITO/.test(n)) return 'Refund';
    if (/DEP PRAZO/.test(n)) return 'Savings';
    if (/TRANSFER|TRF|P\/O /.test(n)) return 'Transfers';
    return 'Income';
  }
  // money out
  if (/P\/ ?REVOLUT|P\/ ?SANTANDER|TRANSFERENCIA PARA JOAO|MB WAY P\//.test(n)) return 'Transfers';
  if (/REFORCO AUT|DEP PRAZO/.test(n)) return 'Savings';
  if (/DD SGF|DD BANCO INVEST|SGF - ?SOCIEDAD/.test(n)) return 'Investments';
  for (const [re, label] of RULES) if (re.test(n)) return label;
  return 'Other';
}

// Tidy a bank description into a merchant string.
export function cleanMerchant(desc: string): string {
  return desc
    .replace(/^COMPRA \d+ /i, '')
    .replace(/^(DD|TRF\.?|TRF MB WAY|PAG BXVAL-?|LEV ATM \d+|ELE \d+|CRED\.) /i, '')
    .replace(/\bCONTACTLESS\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface ParsedRow { date: string; signed: number; desc: string; }

// Santander & ActivoBank exports share the layout after their header row:
//   col0 = date, col2 = description, col3 = amount (';'-separated, Latin-1).
export function parseBankCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => { const n = norm(l); return n.includes('DATA LANC') || n.includes('DATA OPERA'); });
  const rows: ParsedRow[] = [];
  for (let i = hi >= 0 ? hi + 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const c = line.split(';');
    if (c.length < 4) continue;
    const date = toIso(c[0]);
    if (!date) continue;
    rows.push({ date, desc: c[2] ?? '', signed: parsePtMoney(c[3] ?? '') });
  }
  return rows;
}

const BANK_LABEL: Record<string, string> = { santander: 'Santander', activobank: 'ActivoBank' };

// Turn parsed bank rows into records (all rows, both directions), deduped.
// amount is SIGNED: negative = money out (expense), positive = money in.
export function toExpenseRecords(bank: string, rows: ParsedRow[]) {
  const seen = new Map<string, number>();
  const out = [];
  for (const r of rows) {
    if (!r.date || !isFinite(r.signed) || r.signed === 0) continue;
    const v = validateTag(classify(r.desc, r.signed));
    const cents = Math.round(Math.abs(r.signed) * 100);
    const base = `exp_${bank}_${r.date}_${cents}_${norm(r.desc).replace(/[^A-Z0-9]/g, '').slice(0, 16)}`;
    const idx = (seen.get(base) ?? 0); seen.set(base, idx + 1);
    out.push({
      date: r.date,
      amount: r.signed,          // signed
      currency: 'EUR',
      tag: v.canonical,
      tag_label: v.label,
      merchant: cleanMerchant(r.desc),
      note: null,
      source: 'import',
      institution: BANK_LABEL[bank] ?? bank,
      source_document: `${base}_${idx}`,
    });
  }
  return out;
}
