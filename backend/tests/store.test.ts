import { describe, expect, it } from 'vitest';
import { buildPdf, formatPkr, receiptPdf } from '../src/features/store/pdf';

describe('receipt pdf', () => {
  it('formats PKR with two decimals', () => {
    expect(formatPkr(450000)).toBe('PKR 4500.00');
    expect(formatPkr(5)).toBe('PKR 0.05');
    expect(formatPkr(810000)).toBe('PKR 8100.00');
  });
  it('builds a valid pdf containing order id and total', () => {
    const b64 = receiptPdf({ order_id: 'ord-001', customer_id: 'c(1)\\é', total_minor: 450000, subtotal_minor: 450000, discount_minor: 0, items: [{ variant_id: 'v', quantity: 1, unit_price_minor: 450000 }], paid_at: '2026-10-17T11:20:05Z' });
    const buf = Buffer.from(b64, 'base64');
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('(Order: ord-001) Tj');
    expect(text).toContain('PKR 4500.00');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // xref offsets point at "N 0 obj"
    const xref = text.slice(text.indexOf('xref'));
    const offs = [...xref.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(text.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`));
    expect(buildPdf(['x']).length).toBeGreaterThan(200);
  });
});
