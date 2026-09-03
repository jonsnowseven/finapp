import { requireApiUser } from '../../../../lib/api-auth';
import { NextResponse } from 'next/server';
import { parseSantanderLoanPdf } from '../../../../lib/expense-import';
import { extractPdfText } from '../../../../lib/pdfText';

// Parse a Santander loan-movements PDF and return { balance, payment } to
// prefill the Mortgage form. Does not write to the DB.
export async function POST(request: Request) {
  const guard = await requireApiUser();
  if (guard) return guard;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const pdf = { text: await extractPdfText(buf) };

    const parsed = parseSantanderLoanPdf(pdf.text);
    if (!parsed) {
      return NextResponse.json({
        error: 'No instalments found. Check the PDF (Consulta Movimentos Empréstimo).',
        debug: { textLength: pdf.text.length, textSample: pdf.text.slice(0, 300) },
      }, { status: 422 });
    }
    return NextResponse.json(parsed);
  } catch (err: any) {
    // No Vercel log access from here — put enough in the response itself to
    // diagnose without another round trip.
    return NextResponse.json({
      error: `Couldn't read this PDF (${err.message}). Try re-downloading the statement from Santander and uploading again.`,
      debug: {
        nodeVersion: process.version,
        errName: err?.name,
        errStack: String(err?.stack ?? '').split('\n').slice(0, 3),
      },
    }, { status: 500 });
  }
}
