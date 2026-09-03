// PDF text extraction via pdfjs-dist (actively maintained), replacing the
// old pinned pdf-parse (pdf.js ~2018 vintage) whose internal xref-recovery
// and structure-validation code has thrown on real bank-statement PDFs in
// production (Vercel's Node runtime) while parsing the identical bytes fine
// locally — at least two independent statements (Santander loan, Trade
// Republic account) hit this. Text layout (line breaks by Y-coordinate) is
// kept equivalent to pdf-parse's output so existing regex-based parsers
// across the import routes don't need changes.
export async function extractPdfText(buf: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | undefined;
    let line = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      if (lastY === undefined || lastY === item.transform[5]) line += item.str;
      else line += '\n' + item.str;
      lastY = item.transform[5];
    }
    text += '\n\n' + line;
  }
  return text;
}
