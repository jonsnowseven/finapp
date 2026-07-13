import { requireApiUser } from '../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { parseSantanderLoanPdf } from '../../../../lib/expense-import';

// Parse a Santander loan-movements PDF and return { balance, payment } to
// prefill the Mortgage form. Does not write to the DB.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
    const pdf = await pdfParse(Buffer.from(await file.arrayBuffer()));
    const parsed = parseSantanderLoanPdf(pdf.text);
    if (!parsed) return NextResponse.json({ error: 'No instalments found. Check the PDF (Consulta Movimentos Empréstimo).' }, { status: 422 });
    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
