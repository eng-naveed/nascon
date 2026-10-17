import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, SALT, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('store');
});
afterAll(async () => ctx.close());

const checkout = (body: unknown) => call(ctx.app, 'POST', '/audit/v1/checkout', body);
const inv = (id: string) => call(ctx.app, 'GET', `/audit/v1/inventory/${id}`);
const order = (o: Record<string, unknown> = {}) => ({
  order_id: uniq('ord'), customer_id: 'cust-001', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], discount_code: null, payment: { token: 'tok_success' }, ...o,
});

describe('checkout', () => {
  it('201 success with signed receipt and a PDF containing PKR; replay is 200', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-L': 10 } });
    const body = order({ items: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] });
    const r = await checkout(body);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      order_id: body.order_id, status: 'paid', currency: 'PKR', subtotal_minor: 900000, discount_minor: 0, total_minor: 900000,
      items: [{ variant_id: 'var-jersey-001-L', quantity: 2, unit_price_minor: 450000 }],
      payment: { authorization_id: `auth_${body.order_id}`, capture_id: `cap_${body.order_id}`, state: 'captured' },
    });
    expect(r.body.receipt.signature).toBe(ctx.crypto.sign(SALT, body.order_id, r.body.receipt.payload));
    const pdf = Buffer.from(r.body.receipt.pdf_base64, 'base64').toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('PKR 9000.00');
    expect(pdf).toContain(body.order_id);
    expect((await inv('var-jersey-001-L')).body).toEqual({ variant_id: 'var-jersey-001-L', stock: 8, reserved: 0 });

    const replay = await checkout(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(r.body);
    expect((await inv('var-jersey-001-L')).body.stock).toBe(8);

    const diff = await checkout({ ...body, customer_id: 'someone-else' });
    expect([diff.status, diff.body.error.code]).toEqual([409, 'DUPLICATE_ORDER_ID']);
  });

  it('WELCOME10 takes 10% off (floor) and items are sorted', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-L': 10, 'var-jersey-001-M': 10 } });
    const r = await checkout(order({ discount_code: 'WELCOME10', items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }, { variant_id: 'var-jersey-001-L', quantity: 1 }] }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ subtotal_minor: 900000, discount_minor: 90000, total_minor: 810000 });
    expect(r.body.items.map((i: any) => i.variant_id)).toEqual(['var-jersey-001-L', 'var-jersey-001-M']);
    expect(Buffer.from(r.body.receipt.pdf_base64, 'base64').toString('latin1')).toContain('PKR 8100.00');
  });

  it('402 declined / capture failed release the reservation', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-L': 2 } });
    const d = await checkout(order({ payment: { token: 'tok_declined' } }));
    expect([d.status, d.body.error.code]).toEqual([402, 'PAYMENT_DECLINED']);
    const c = await checkout(order({ payment: { token: 'tok_capture_fail' } }));
    expect([c.status, c.body.error.code]).toEqual([402, 'PAYMENT_CAPTURE_FAILED']);
    expect((await inv('var-jersey-001-L')).body).toMatchObject({ stock: 2, reserved: 0 });
    // the declined order id can be reused afterwards (order row removed)
    const id = uniq('ord');
    expect((await checkout(order({ order_id: id, payment: { token: 'tok_declined' } }))).status).toBe(402);
    expect((await checkout(order({ order_id: id }))).status).toBe(201);
  });

  it('400 / 404 / 409 errors in contract order', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-M': 1 } });
    const v = await checkout(order({ items: [] }));
    expect([v.status, v.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    const dupItems = await checkout(order({ items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }, { variant_id: 'var-jersey-001-M', quantity: 1 }] }));
    expect(dupItems.body.error.details.fields).toContain('items');
    const qty = await checkout(order({ items: [{ variant_id: 'var-jersey-001-M', quantity: 11 }] }));
    expect(qty.status).toBe(400);
    const nf = await checkout(order({ items: [{ variant_id: 'var-nope', quantity: 1 }], discount_code: 'BOGUS' }));
    expect([nf.status, nf.body.error.code]).toEqual([404, 'VARIANT_NOT_FOUND']);
    const code = await checkout(order({ discount_code: 'BOGUS' }));
    expect([code.status, code.body.error.code]).toEqual([400, 'INVALID_DISCOUNT_CODE']);
    const oos = await checkout(order({ items: [{ variant_id: 'var-jersey-001-M', quantity: 2 }] }));
    expect([oos.status, oos.body.error.code]).toEqual([409, 'OUT_OF_STOCK']);
    expect(oos.body.error.details.variant_id).toBe('var-jersey-001-M');
    expect((await inv('var-jersey-001-M')).body).toMatchObject({ stock: 1, reserved: 0 });
    const inj = await checkout(order({ customer_id: `"'><script>alert(1)</script>` }));
    expect(inj.status).toBe(201);
    expect(inj.body.receipt.payload.customer_id).toBe(`"'><script>alert(1)</script>`);
  });

  it('20 simultaneous checkouts for the last unit: exactly one 201, nineteen 409', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-M': 1 } });
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) => checkout(order({ order_id: `race-${i}`, customer_id: `c${i}`, items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }] }))),
    );
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error.code === 'OUT_OF_STOCK')).toBe(true);
    expect((await inv('var-jersey-001-M')).body).toEqual({ variant_id: 'var-jersey-001-M', stock: 0, reserved: 0 });
  });

  it('concurrent identical requests: one 201, the twin waits and replays 200', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-L': 5 } });
    const body = order();
    const rs = await Promise.all([checkout(body), checkout(body)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(rs[0].body.order_id).toBe(rs[1].body.order_id);
    expect((await inv('var-jersey-001-L')).body.stock).toBe(4);
  });

  it('an in-flight order that disappears (declined) makes its twin give up with 409', async () => {
    await ctx.reset({ stock: { 'var-jersey-001-L': 5 } });
    const body = order({ payment: { token: 'tok_declined' } });
    const rs = await Promise.all([checkout(body), checkout(body)]);
    const codes = rs.map((r) => r.status).sort();
    // either both run sequentially (402, 402) or the twin observes the in-flight row then sees it removed (402, 409)
    expect(codes[0]).toBe(402);
    expect([402, 409]).toContain(codes[1]);
  });
});

describe('inventory', () => {
  it('404 for unknown variant', async () => {
    const r = await inv('var-nope');
    expect([r.status, r.body.error.code]).toEqual([404, 'VARIANT_NOT_FOUND']);
  });
});
