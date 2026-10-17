/** Minimal single-page PDF (Helvetica, uncompressed) with extractable text. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export function formatPkr(minor: number): string {
  const major = Math.floor(minor / 100);
  const frac = String(minor % 100).padStart(2, '0');
  return `PKR ${major}.${frac}`;
}

/** Wraps a page content stream in a one-page document using Helvetica (F1) and Helvetica-Bold (F2). */
function assemble(content: string): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
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

export function buildPdf(lines: string[]): Buffer {
  let y = 780;
  let content = 'BT\n/F1 14 Tf\n';
  for (const line of lines) {
    content += `1 0 0 1 56 ${y} Tm\n(${esc(line)}) Tj\n`;
    y -= 22;
  }
  content += 'ET';
  return assemble(content);
}

// Helvetica glyph widths (1/1000 em) for the characters that appear in amounts; everything else uses the digit width.
const W_REG: Record<string, number> = { P: 667, K: 667, R: 722, ' ': 278, '.': 278, '-': 333 };
const W_BOLD: Record<string, number> = { P: 667, K: 722, R: 722, ' ': 278, '.': 278, '-': 333 };
function textWidth(s: string, size: number, bold: boolean): number {
  const t = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of s) w += t[ch] ?? 556;
  return (w * size) / 1000;
}

type Rgb = [number, number, number];
const NAVY: Rgb = [0.039, 0.059, 0.118];
const LIME: Rgb = [0.784, 1, 0.239];
const GREEN: Rgb = [0.239, 0.863, 0.592];
const INK: Rgb = [0.09, 0.11, 0.18];
const MUTED: Rgb = [0.4, 0.44, 0.54];
const PANEL: Rgb = [0.955, 0.963, 0.98];
const RULE: Rgb = [0.84, 0.86, 0.91];
const WHITE: Rgb = [1, 1, 1];
const fill = (c: Rgb) => `${c.join(' ')} rg\n`;

type ReceiptItem = { variant_id: string; quantity: number; unit_price_minor: number; name?: string };
type ReceiptInput = {
  order_id: string; customer_id: string; total_minor: number; subtotal_minor: number; discount_minor: number;
  items: ReceiptItem[]; paid_at: string;
};

export function receiptPdf(r: ReceiptInput): string {
  const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');
  const L = 48;
  const R = 547;
  let c = '';
  const rect = (col: Rgb, x: number, y: number, w: number, h: number) => { c += `${fill(col)}${x} ${y} ${w} ${h} re f\n`; };
  const text = (s: string, x: number, y: number, size: number, col: Rgb, bold = false) => {
    c += `BT\n/${bold ? 'F2' : 'F1'} ${size} Tf\n${fill(col)}1 0 0 1 ${x.toFixed(1)} ${y} Tm\n(${esc(s)}) Tj\nET\n`;
  };
  const textRight = (s: string, xr: number, y: number, size: number, col: Rgb, bold = false) => text(s, xr - textWidth(s, size, bold), y, size, col, bold);
  const rule = (y: number) => { c += `${RULE.join(' ')} RG\n1 w\n${L} ${y} m ${R} ${y} l S\n`; };

  // Header band
  rect(NAVY, 0, 722, 595, 120);
  rect(LIME, 0, 716, 595, 6);
  text('NaSCon Merchandise Receipt', L, 782, 24, WHITE, true);
  text('Official payment receipt', L, 760, 11, [0.66, 0.71, 0.83]);
  rect(GREEN, 470, 770, 77, 28);
  text('PAID', 493, 779, 14, NAVY, true);

  // Order details
  rect(PANEL, L, 604, R - L, 90);
  text(`Order: ${clean(r.order_id)}`, L + 16, 668, 12, INK, true);
  text(`Customer: ${clean(r.customer_id).slice(0, 60)}`, L + 16, 646, 12, INK);
  text(`Paid at: ${r.paid_at}`, L + 16, 624, 12, INK);

  // Items table
  rect(NAVY, L, 556, R - L, 26);
  text('ITEM', L + 16, 565, 10, WHITE, true);
  textRight('AMOUNT', R - 16, 565, 10, WHITE, true);
  const MAX_ITEMS = 12;
  const shown = r.items.slice(0, MAX_ITEMS);
  const rowH = shown.length > 7 ? 34 : 46;
  let y = 556 - rowH + 14;
  for (const i of shown) {
    const title = clean(i.name ?? i.variant_id);
    text(title.slice(0, 48), L + 16, y, 13, INK, true);
    text(`${clean(i.variant_id)} x${i.quantity} @ ${formatPkr(i.unit_price_minor)}`, L + 16, y - 15, 10, MUTED);
    textRight(formatPkr(i.unit_price_minor * i.quantity), R - 16, y - 2, 13, INK, true);
    rule(y - rowH + 20);
    y -= rowH;
  }
  if (r.items.length > MAX_ITEMS) {
    text(`+ ${r.items.length - MAX_ITEMS} more items`, L + 16, y - 2, 11, MUTED);
    y -= 26;
  }

  // Totals
  y -= 10;
  textRight(`Subtotal: ${formatPkr(r.subtotal_minor)}`, R - 16, y, 12, MUTED);
  y -= 22;
  textRight(`Discount: ${formatPkr(r.discount_minor)}`, R - 16, y, 12, MUTED);
  y -= 58;
  rect(NAVY, L, y, R - L, 40);
  rect(LIME, L, y, 6, 40);
  text('TOTAL PAID', L + 22, y + 15, 11, [0.66, 0.71, 0.83], true);
  textRight(`Total: ${formatPkr(r.total_minor)}`, R - 16, y + 13, 18, WHITE, true);

  text('Thank you for your purchase. This receipt was generated electronically by NaSCon.', L, 60, 9, MUTED);
  return assemble(c).toString('base64');
}
