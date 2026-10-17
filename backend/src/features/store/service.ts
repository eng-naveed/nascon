import { z } from 'zod';
import { config } from '../../core/config';
import { bodyHash, sign } from '../../core/crypto';
import { pool, tx } from '../../core/db';
import { AppError, conflict, notFound, validation } from '../../core/errors';
import { idSchema, parse } from '../../core/validate';
import { receiptPdf } from './pdf';

const checkoutSchema = z.object({
  order_id: idSchema,
  customer_id: z.string().min(1).max(200),
  items: z.array(z.object({ variant_id: idSchema, quantity: z.number().int().min(1).max(10) })).min(1).max(10),
  discount_code: z.string().max(64).nullable().optional(),
  payment: z.object({ token: z.string().min(1).max(100) }),
});

/** Mock payment gateway. */
function gateway(token: string) {
  if (token === 'tok_success') return { authorize: true, capture: true };
  if (token === 'tok_capture_fail') return { authorize: true, capture: false };
  return { authorize: false, capture: false };
}

export async function checkout(rawBody: unknown, actor?: { sub: string }) {
  const body = parse(checkoutSchema, rawBody);
  const ids = body.items.map((i) => i.variant_id);
  if (new Set(ids).size !== ids.length) throw validation(['items']);
  const hash = bodyHash({ ...body, discount_code: body.discount_code ?? null });
  void actor;

  // Phase 1 (atomic): claim the order id, validate, and reserve stock.
  const reserved = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['order:' + body.order_id]);
    const ex = await c.query('SELECT body_hash, status, response FROM orders WHERE order_id=$1', [body.order_id]);
    if (ex.rowCount) {
      const row = ex.rows[0];
      if (row.body_hash !== hash) throw conflict('DUPLICATE_ORDER_ID', `Order id ${body.order_id} was already used with different content.`, { order_id: body.order_id });
      if (row.status === 'paid') return { replay: row.response };
      throw conflict('DUPLICATE_ORDER_ID', 'This order is already being processed.', { order_id: body.order_id });
    }
    const vs = await c.query('SELECT variant_id, price_minor, currency FROM variants WHERE variant_id = ANY($1)', [ids]);
    const prices = new Map(vs.rows.map((r) => [r.variant_id, r.price_minor as number]));
    for (const id of ids) if (!prices.has(id)) throw notFound('VARIANT_NOT_FOUND', `Variant ${id} not found.`, { variant_id: id });
    const code = body.discount_code ?? null;
    if (code !== null && code !== 'WELCOME10') throw new AppError(400, 'INVALID_DISCOUNT_CODE', 'That discount code is not valid.', { discount_code: code });
    for (const it of [...body.items].sort((a, b) => (a.variant_id < b.variant_id ? -1 : 1))) {
      const r = await c.query('UPDATE variants SET stock = stock - $2, reserved = reserved + $2 WHERE variant_id=$1 AND stock >= $2', [it.variant_id, it.quantity]);
      if (!r.rowCount) throw conflict('OUT_OF_STOCK', `Variant ${it.variant_id} has no stock left.`, { variant_id: it.variant_id });
    }
    await c.query("INSERT INTO orders(order_id, body_hash, status, customer_id) VALUES ($1,$2,'processing',$3)", [body.order_id, hash, body.customer_id]);
    const items = body.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: prices.get(i.variant_id)! }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0);
    const discount = code === 'WELCOME10' ? Math.floor((subtotal * 10) / 100) : 0;
    return { items, subtotal, discount };
  });
  if ('replay' in reserved) return { status: 200, body: reserved.replay };

  const { items, subtotal, discount } = reserved;
  const release = async (restock: boolean) =>
    tx(async (c) => {
      for (const it of items) await c.query(`UPDATE variants SET reserved = reserved - $2${restock ? ', stock = stock + $2' : ''} WHERE variant_id=$1`, [it.variant_id, it.quantity]);
      if (restock) await c.query('DELETE FROM orders WHERE order_id=$1', [body.order_id]);
    });

  const gw = gateway(body.payment.token);
  if (!gw.authorize) {
    await release(true);
    throw new AppError(402, 'PAYMENT_DECLINED', 'The payment was declined.', { order_id: body.order_id });
  }
  if (!gw.capture) {
    await release(true);
    throw new AppError(402, 'PAYMENT_CAPTURE_FAILED', 'The payment could not be captured.', { order_id: body.order_id });
  }

  const total = subtotal - discount;
  const paidAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const payload = {
    order_id: body.order_id, customer_id: body.customer_id, items, subtotal_minor: subtotal, discount_minor: discount,
    total_minor: total, currency: 'PKR', paid_at: paidAt,
  };
  const response = {
    order_id: body.order_id, status: 'paid', currency: 'PKR', items, subtotal_minor: subtotal, discount_minor: discount, total_minor: total,
    payment: { authorization_id: `auth_${body.order_id}`, capture_id: `cap_${body.order_id}`, state: 'captured' },
    receipt: {
      payload,
      signature: sign(config.salt, body.order_id, payload),
      pdf_base64: receiptPdf({ order_id: body.order_id, customer_id: body.customer_id, total_minor: total, subtotal_minor: subtotal, discount_minor: discount, items, paid_at: paidAt }),
    },
  };
  await tx(async (c) => {
    for (const it of items) await c.query('UPDATE variants SET reserved = reserved - $2 WHERE variant_id=$1', [it.variant_id, it.quantity]);
    await c.query("UPDATE orders SET status='paid', response=$2 WHERE order_id=$1", [body.order_id, JSON.stringify(response)]);
    await c.query('INSERT INTO queue_events(topic, payload) VALUES ($1,$2)', ['order.status_changed', JSON.stringify({ order_id: body.order_id, from: 'Pending', to: 'Paid' })]);
  });
  return { status: 201, body: response };
}

export async function inventory(variantId: string) {
  const r = await pool.query('SELECT variant_id, stock, reserved FROM variants WHERE variant_id=$1', [variantId]);
  if (!r.rowCount) throw notFound('VARIANT_NOT_FOUND', `Variant ${variantId} not found.`, { variant_id: variantId });
  return r.rows[0];
}
