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
  [/SEGURO|SEG:|GENERALI|FIDELIDADE|AEGON|MULTICARE|MULTI-?RISCOS|REALVSEGUROS/, 'Insurance'],
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
  if (/P\/ ?REVOLUT|P\/ ?SANTANDER|TRANSFERENCIA PARA JOAO|MB WAY P\/|TRF\.IMED\. P\//.test(n)) return 'Transfers';
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

// PDF money token: dot decimal, space thousands (e.g. "1 234.56", "2 450.05").
const PDF_MONEY = /\d{1,3}(?:[ ]\d{3})*\.\d{2}/g;
const pdfNum = (s: string) => parseFloat(s.replace(/ /g, ''));

// Valid statement date token: month 1-12, day 01-31 (so amounts like "45.30"
// or "18.00" can't be mistaken for a date anchor).
const DATE_TOK = String.raw`(?:1[0-2]|0?[1-9])\.(?:0[1-9]|[12]\d|3[01])`;

// Parse an ActivoBank "EXTRATO COMBINADO" PDF (CONTA SIMPLES movements).
// Layout per row: DATA_LANC(M.DD) DATA_VALOR(M.DD) DESCRITIVO [DEBITO|CREDITO] SALDO
// The DEBITO/CREDITO columns collapse in extracted text, so the sign+amount are
// derived from the running-balance delta (saldo_i − saldo_{i-1}) — robust and exact.
export function parseActivoBankPdf(text: string): ParsedRow[] {
  const t = text.replace(/ /g, ' ');
  const period = t.match(/EXTRATO DE\s+(\d{4})\/(\d{2})\/(\d{2})/);
  const year = period ? Number(period[1]) : new Date().getFullYear();
  const startMonth = period ? Number(period[2]) : 1;

  // pdf-parse often drops line breaks / glues columns. Rebuild rows: break
  // before each two-date anchor (posting + value date) followed by a letter,
  // and before SALDO markers. The date-range guard stops amounts matching.
  const anchor = new RegExp(`(${DATE_TOK}) ?(${DATE_TOK})(?=\\s+[A-Za-zÀ-ÿ])`, 'g');
  const prepped = t
    .replace(/\s+/g, ' ')          // pdf-parse keeps newlines/extra spaces — flatten first
    .replace(anchor, '\n$1 $2 ')
    .replace(/\s(SALDO INICIAL|SALDO FINAL|SALDO DISPONIVEL)/g, '\n$1 ');

  const rows: ParsedRow[] = [];
  let capturing = false;
  let prev = NaN;

  for (const raw of prepped.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    // Movement region: from "SALDO INICIAL <saldo>" to "SALDO FINAL".
    const ini = line.match(/SALDO INICIAL\s+(\d{1,3}(?:[ ]\d{3})*\.\d{2})/);
    if (ini) { prev = pdfNum(ini[1]); capturing = true; continue; }
    if (/SALDO (FINAL|DISPONIVEL)/.test(line)) { capturing = false; continue; }
    if (!capturing) continue;

    // Row starts with two M.DD dates (posting + value date).
    const m = line.match(/^(\d{1,2})\.(\d{2})\s+\d{1,2}\.\d{2}\s+(.*)$/);
    if (!m) continue;                                  // header/footer/carry lines
    const month = Number(m[1]);
    const day = Number(m[2]);
    const rest = m[3];

    const toks = rest.match(PDF_MONEY);
    if (!toks || !toks.length) continue;
    const saldo = pdfNum(toks[toks.length - 1]);       // running balance = last token
    if (!isFinite(saldo)) continue;
    if (!isFinite(prev)) { prev = saldo; continue; }

    const signed = Math.round((saldo - prev) * 100) / 100;
    prev = saldo;
    if (signed === 0) continue;

    const cut = rest.indexOf(toks[0]);                 // desc = text before first amount
    const desc = (cut > 0 ? rest.slice(0, cut) : rest).trim();
    const yr = month < startMonth ? year + 1 : year;   // handle Dec→Jan wrap
    const date = `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    rows.push({ date, signed, desc });
  }
  return rows;
}

// PT money in Santander PDF: dot thousands, comma decimal ("1.598,73", "37,74").
const ptPdfNum = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

// Parse a Banco Santander Totta "Extrato Consolidado" PDF (Conta à Ordem).
// Row (columns collapse in extracted text): DATA_MOV(DD-MM) DATA_VALOR(DD-MM)
// DESCRITIVO VALOR(signed) SALDO. Signed amount from running-balance delta.
export function parseSantanderPdf(text: string): ParsedRow[] {
  const flat = text.replace(/ /g, ' ').replace(/\s+/g, ' ');
  const per = flat.match(/PER[IÍ]ODO DE\s+(\d{4})-(\d{2})-(\d{2})/i);
  const year = per ? Number(per[1]) : new Date().getFullYear();
  const startMonth = per ? Number(per[2]) : 1;

  const start = flat.search(/Saldo Inicial/i);
  if (start < 0) return [];
  const endRel = flat.slice(start).search(/Saldo Contabil[ií]stico Final|Saldo Final/i);
  const region = endRel < 0 ? flat.slice(start) : flat.slice(start, start + endRel);

  const seed = region.match(/Saldo Inicial\s*EUR\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  let prev = seed ? ptPdfNum(seed[1]) : NaN;

  const MONEY = /\d{1,3}(?:\.\d{3})*,\d{2}/g;
  const D = String.raw`(?:0[1-9]|[12]\d|3[01])-(?:0[1-9]|1[0-2])`;      // DD-MM
  const rowRe = new RegExp(`(${D})(${D})(.+?)(?=(?:${D})(?:${D})|Saldo |$)`, 'g');

  const rows: ParsedRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(region)) !== null) {
    const day = Number(m[1].slice(0, 2));
    const month = Number(m[1].slice(3, 5));
    const rest = m[3];
    const toks = rest.match(MONEY);
    if (!toks || !toks.length) continue;
    const saldo = ptPdfNum(toks[toks.length - 1]);
    if (!isFinite(saldo)) continue;
    if (!isFinite(prev)) { prev = saldo; continue; }
    const signed = Math.round((saldo - prev) * 100) / 100;
    prev = saldo;
    if (signed === 0) continue;
    const cut = rest.indexOf(toks[0]);
    const desc = (cut > 0 ? rest.slice(0, cut) : rest).trim();
    const yr = month < startMonth ? year + 1 : year;
    rows.push({ date: `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, signed, desc });
  }
  return rows;
}

// Parse a Santander "Consulta Movimentos Empréstimo" PDF → latest instalment's
// outstanding balance + loan payment (juros + capital; the SEG insurance is
// separate). Rows are newest-first; grouped by instalment number.
export function parseSantanderLoanPdf(text: string): { balance: number; payment: number; paid: number } | null {
  // pdf-parse glues the two dates + instalment number and the amounts to EUR.
  const flat = text.replace(/ /g, ' ').replace(/\s+/g, ' ');
  const re = /(\d{2}-\d{2}-\d{4})(\d{2}-\d{2}-\d{4})(\d+)PRESTACAO ?- ?(SEG ED|JUROS|CAPIT\.?)(-?\d[\d.]*,\d{2}) ?EUR ?([\d.]*,\d{2}) ?EUR/g;
  const groups: Record<number, { presta: number; juros?: number; capital?: number; capSaldo?: number }> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const presta = Number(m[3]);
    const type = m[4].trim();
    const montante = ptPdfNum(m[5]);
    const saldo = ptPdfNum(m[6]);
    const g = groups[presta] ?? (groups[presta] = { presta });
    if (type.startsWith('JUROS')) g.juros = Math.abs(montante);
    else if (type.startsWith('CAPIT')) { g.capital = Math.abs(montante); g.capSaldo = saldo; }
  }
  const latest = Object.values(groups).sort((a, b) => b.presta - a.presta)[0];
  if (!latest || latest.capSaldo == null) return null;
  return {
    balance: latest.capSaldo,
    payment: Math.round(((latest.juros ?? 0) + (latest.capital ?? 0)) * 100) / 100,
    paid: latest.presta,   // instalments paid so far
  };
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
