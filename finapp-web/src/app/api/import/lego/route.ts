import { requireApiUser } from '../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { splitNameTheme } from '../../../../lib/lego';

// "€1,234.56" / "139.39" → number (US-style: dot decimal, comma thousands)
function num(s: string): number {
  return parseFloat(s.replace(/[€\s,]/g, '')) || 0;
}

// pdf-parse concatenates the columns with no spaces:
//   "10284-1Camp NouIcons / Buildings€329.99€197.99€473.9710139.39"
// = SET | Name+Theme | €Retail | €Paid | €Value | New(1 digit) | Used(1 digit) | Growth%
// Amounts have 2 decimals; New/Used are single digits; growth is the trailing decimal.
const ROW_RE =
  /^(\d{3,7}-\d+)(.+?)€([\d,]+\.\d{2})€([\d,]+\.\d{2})€([\d,]+\.\d{2})(\d)(\d)(-?[\d,]*\.\d+)$/;

function parseLegoPdf(text: string) {
  const records = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, setNo, mid, retail, paid, value, qNew, qUsed, growth] = m;
    const { name, theme } = splitNameTheme(mid.trim());
    records.push({
      set_no: setNo,
      name,
      theme: theme || null,
      retail: num(retail),
      paid: num(paid),
      value: num(value),
      qty_new: parseInt(qNew, 10),
      qty_used: parseInt(qUsed, 10),
      growth_pct: num(growth),
      annual_pct: null,
      source_document: `lego_${setNo}`,
    });
  }
  return records;
}

export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdf = await pdfParse(buffer);
    const records = parseLegoPdf(pdf.text);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No LEGO sets found in PDF. Check the file format.' }, { status: 422 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from('lego_sets')
      .upsert(records, { onConflict: 'set_no' })
      .select();
    if (error) throw error;

    return NextResponse.json({ inserted: data?.length ?? 0, total: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
