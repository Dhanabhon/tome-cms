/**
 * A valid one-page PDF: a coloured band and `text` in Helvetica, on a portrait page. The
 * cross-reference table is computed, so pdf.js opens it as it would open any file. `padding` bytes
 * of an object nothing points at make it large enough for pdf.js to read it in ranges (more than
 * twice its chunk size) rather than whole.
 */
export function onePagePdf(text: string, { band = '0.16 0.62 0.56', padding = 0 } = {}): Buffer {
  const stream = `${band} rg 0 240 200 40 re f 0 g BT /F1 18 Tf 20 120 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 280] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...(padding ? [`<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`] : []),
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
