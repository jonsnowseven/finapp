import { requireApiUser } from "../../../../lib/api-auth";
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Minimal RFC 4180 CSV parser
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuote = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

const TYPE_MAP: Record<string, string> = {
  BUY: 'buy',
  SELL: 'sell',
  DIVIDEND: 'dividend',
  INTEREST_PAYMENT: 'interest',
  SAVINGS_PLAN: 'buy',
};

function mapType(raw: string): string {
  return TYPE_MAP[raw.toUpperCase()] ?? 'buy';
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// English-formatted amount: "13,338.59" → 13338.59 (comma thousands, dot decimal)
function enNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

function toIso(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.slice(0, 3).toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

// Parse a Trade Republic account statement (PDF) for the ending cash balance.
// Cash-at-interest sits in the checking account (escrow + money-market fund);
// the statement's ENDING BALANCE is that full cash figure. Stored as a
// point-in-time valuation and folded into the TR line on top of ETF × price.
function parseTradeRepublicStatement(text: string): { as_of_date: string; value: number } | null {
  const flat = text.replace(/\s+/g, ' ');

  // Ending cash balance = the 4th (last) money token of the "Checking Account"
  // summary row (opening, money-in, money-out, ENDING). pdf-parse may glue the
  // €-columns and drop/repeat spaces, so scan the summary region for money
  // tokens (…,NNN.NN) rather than requiring fixed spacing.
  let value = NaN;
  const start = flat.search(/Checking Account/i);
  if (start >= 0) {
    const endIdx = flat.search(/ACCOUNT TRANSACTIONS/i);
    const region = flat.slice(start, endIdx > start ? endIdx : start + 200);
    const amts = region.match(/\d[\d,]*\.\d{2}/g);   // English format: comma thousands, dot decimal
    if (amts && amts.length >= 4) value = enNum(amts[3]);
    else if (amts && amts.length) value = enNum(amts[amts.length - 1]);
  }
  if (!isFinite(value) || value <= 0) return null;

  // Statement end date: "01 May 2026 - 31 Jul 2026" (take the range end) or "as of 31 Jul 2026".
  let as_of_date = new Date().toISOString().slice(0, 10);
  const period = flat.match(/\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  const asOf = flat.match(/as of\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/i);
  const p = period ? [period[1], period[2], period[3]] : asOf ? [asOf[1], asOf[2], asOf[3]] : null;
  if (p) { const iso = toIso(p[0], p[1], p[2]); if (iso) as_of_date = iso; }

  return { as_of_date, value };
}

// Parse the individual cash-account movements from a TR statement so the cash
// line has real history in the Transactions tab (like Revolut Boosted). Only
// non-trade rows are kept — Interest and incoming/outgoing Transfers. The ETF
// "Trade"/"Savings plan" rows are the securities buys already imported via CSV,
// so they are skipped here to avoid double-counting holdings.
// No merchant/IBAN/name text is stored — only date, type, amount (PII-free).
function parseTradeRepublicCashRows(text: string): { date: string; type: string; amount: number; balance: number }[] {
  const flat = text.replace(/\s+/g, ' ');
  // Anchor on each "DD Mon YYYY <Type>" row-start, then read the segment up to the
  // next row-start. pdf-parse glues the € columns and glues the TYPE onto the
  // description for Interest/Transfer ("InterestInterest payment", "TransferIncoming
  // …"), so NO word boundary after the type — and money tokens are scanned from the
  // segment rather than requiring € spacing.
  const startRe = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(Interest|Transfer|Trade)/g;
  const starts: { idx: number; end: number; d: string; mon: string; y: string; label: string }[] = [];
  let s: RegExpExecArray | null;
  while ((s = startRe.exec(flat))) starts.push({ idx: s.index, end: startRe.lastIndex, d: s[1], mon: s[2], y: s[3], label: s[4] });

  const out: { date: string; type: string; amount: number; balance: number }[] = [];
  for (let i = 0; i < starts.length; i++) {
    const row = starts[i];
    const iso = toIso(row.d, row.mon, row.y);
    if (!iso) continue;
    const seg = flat.slice(row.end, i + 1 < starts.length ? starts[i + 1].idx : flat.length);
    const money = seg.match(/\d[\d,]*\.\d{2}(?![\d])/g);   // [amount, balance]
    if (!money?.length) continue;
    const amount = enNum(money[0]);            // first token = money-in/out for the row
    if (!amount) continue;
    const balance = money[1] ? enNum(money[1]) : 0;   // running balance = stable row id

    // Classify the cash-account movement:
    //  Interest        → interest in (+)
    //  Transfer in     → deposit (+)     Transfer out → withdrawal (−)
    //  Trade/Savings   → withdrawal (−)  money leaving cash to buy another TR product (ETF)
    let type: string;
    if (row.label === 'Interest') type = 'interest';
    else if (row.label === 'Trade') type = 'withdrawal';
    else type = /incoming/i.test(seg) ? 'deposit' : 'withdrawal';   // Transfer
    out.push({ date: iso, type, amount, balance });
  }
  return out;
}

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // PDF account statement → store the ending cash balance (cash-at-interest).
    const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
      const pdf = await pdfParse(Buffer.from(await file.arrayBuffer()));
      const cash = parseTradeRepublicStatement(pdf.text);
      const cashRows = parseTradeRepublicCashRows(pdf.text);
      if (!cash && cashRows.length === 0) {
        return NextResponse.json({ error: 'Could not read the account statement. Make sure this is a Trade Republic account statement PDF.' }, { status: 422 });
      }

      // Cash-account movements → transactions (visible history, like Revolut).
      // Idempotent: replace any existing cash movements within this statement's
      // date range, then insert the parsed rows. source_document keys on the
      // running balance (unique per row) so re-imports don't duplicate.
      let inserted = 0;
      if (cashRows.length) {
        const dates = cashRows.map((r) => r.date).sort();
        const from = dates[0], to = dates[dates.length - 1];
        await supabase.from('transactions')
          .delete().eq('entity', 'Trade Republic Cash').gte('date', from).lte('date', to);

        const records = cashRows.map((r) => ({
          date:             r.date,
          entity:           'Trade Republic Cash',
          asset_name:       r.type === 'withdrawal' ? 'Invested in TR product' : 'Cash at interest',
          transaction_type: r.type,
          quantity:         null,
          price:            null,
          amount:           r.amount,
          currency:         'EUR',
          fees:             0,
          source_document:  `tr_cash_${r.date}_${r.type}_${r.amount}_${r.balance}`,
        }));
        const { data, error } = await supabase
          .from('transactions')
          .upsert(records, { onConflict: 'source_document' })
          .select();
        if (error) throw error;
        inserted = data?.length ?? 0;
      }

      // Ending balance → point-in-time valuation (the display truth for the line).
      if (cash) {
        const { error } = await supabase.from('valuations').upsert(
          {
            entity:          'Trade Republic Cash',
            asset_name:      'Cash at interest',
            as_of_date:      cash.as_of_date,
            units:           null,
            value:           cash.value,
            currency:        'EUR',
            source_document: `tr_cash_${cash.as_of_date}`,
          },
          { onConflict: 'entity,as_of_date' }
        );
        if (error) throw error;
      }

      return NextResponse.json({ inserted, total: cashRows.length, cash: cash?.value, as_of: cash?.as_of_date });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    // Asset transactions: TRADING category with a non-empty symbol.
    const assetRows = rows.filter(r =>
      r.category === 'TRADING' && r.symbol && r.symbol.trim() !== ''
    );
    // Cash-at-interest payouts: CASH category, INTEREST_PAYMENT type — same
    // "Trade Republic Cash" entity the PDF-statement import feeds, so interest
    // history is complete whichever path (CSV or PDF) was last uploaded.
    const interestRows = rows.filter(r =>
      r.category === 'CASH' && r.type === 'INTEREST_PAYMENT'
    );

    if (assetRows.length === 0 && interestRows.length === 0) {
      return NextResponse.json({ error: 'No asset transactions or interest payments found in this CSV.' }, { status: 422 });
    }

    const assetRecords = assetRows.map(r => {
      const amount  = Math.abs(parseFloat(r.amount)  || 0);
      const fee     = Math.abs(parseFloat(r.fee)     || 0);
      const qty     = Math.abs(parseFloat(r.shares)  || 0);
      const price   = Math.abs(parseFloat(r.price)   || 0);

      return {
        date:             r.date,
        entity:           'Trade Republic',
        asset_name:       r.name || r.symbol,
        isin:             r.symbol || null,   // TR CSV "symbol" column holds the ISIN
        transaction_type: mapType(r.type),
        quantity:         qty || null,
        price:            price || null,
        amount,
        currency:         r.currency || 'EUR',
        fees:             fee,
        source_document:  `tr_${r.transaction_id}`,
      };
    });

    const interestRecords = interestRows.map(r => ({
      date:             r.date,
      entity:           'Trade Republic Cash',
      asset_name:       'Cash at interest',
      transaction_type: 'interest',
      quantity:         null,
      price:            null,
      amount:           Math.abs(parseFloat(r.amount) || 0),
      currency:         r.currency || 'EUR',
      fees:             0,
      source_document:  `tr_${r.transaction_id}`,
    }));

    const records = [...assetRecords, ...interestRecords];

    const { data, error } = await supabase
      .from('transactions')
      .upsert(records, { onConflict: 'source_document' })
      .select();

    if (error) throw error;

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
