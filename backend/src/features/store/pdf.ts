/** Minimal single-page PDF (Helvetica) with extractable text. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function formatPkr(minor: number): string {
  const major = Math.floor(minor / 100);
  const frac = String(minor % 100).padStart(2, '0');
  return `PKR ${major}.${frac}`;
}

export function buildPdf(lines: string[]): Buffer {
  let y = 780;
  let content = 'BT\n/F1 14 Tf\n';
  for (const line of lines) {
    content += `1 0 0 1 56 ${y} Tm\n(${esc(line)}) Tj\n`;
    y -= 22;
  }
  content += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function receiptPdf(r: { order_id: string; customer_id: string; total_minor: number; subtotal_minor: number; discount_minor: number; items: { variant_id: string; quantity: number; unit_price_minor: number }[]; paid_at: string }): string {
  const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');
  const lines = [
    'NaSCon Merchandise Receipt',
    `Order: ${clean(r.order_id)}`,
    `Customer: ${clean(r.customer_id).slice(0, 60)}`,
    `Paid at: ${r.paid_at}`,
    ...r.items.map((i) => `${clean(i.variant_id)} x${i.quantity} @ ${formatPkr(i.unit_price_minor)}`),
    `Subtotal: ${formatPkr(r.subtotal_minor)}`,
    `Discount: ${formatPkr(r.discount_minor)}`,
    `Total: ${formatPkr(r.total_minor)}`,
  ];
  return buildPdf(lines).toString('base64');
}
