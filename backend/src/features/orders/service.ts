import { pool } from '../../core/db';
import { conflict, notFound, validation } from '../../core/errors';
import { inc } from '../../core/metrics';

/** FR-2.3 order lifecycle. Every transition emits a structured domain event to the internal queue. */
export const ORDER_STATES = ['Pending', 'Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const NEXT: Record<OrderState, OrderState[]> = {
  Pending: ['Paid', 'Cancelled'],
  Paid: ['Packed', 'Cancelled', 'Refunded'],
  Packed: ['Shipped', 'Cancelled', 'Refunded'],
  Shipped: ['Delivered', 'Refunded'],
  Delivered: ['Refunded'],
  Cancelled: [],
  Refunded: [],
};
export const allowedNext = (s: OrderState) => NEXT[s];

async function history(orderId: string) {
  const r = await pool.query(
    "SELECT id, payload, created_at FROM queue_events WHERE topic='order.status_changed' AND payload->>'order_id'=$1 ORDER BY id",
    [orderId],
  );
  return r.rows.map((x) => ({ event_id: Number(x.id), ...x.payload, at: new Date(x.created_at).toISOString() }));
}

export async function getOrder(orderId: string) {
  const h = await history(orderId);
  if (!h.length) throw notFound('ORDER_NOT_FOUND', `Order ${orderId} not found.`, { order_id: orderId });
  const state = h[h.length - 1].to as OrderState;
  return { order_id: orderId, state, allowed_next: NEXT[state], history: h };
}

export async function transitionOrder(orderId: string, to: unknown, actor: string) {
  if (typeof to !== 'string' || !(ORDER_STATES as readonly string[]).includes(to)) throw validation(['status']);
  const cur = await getOrder(orderId);
  if (!NEXT[cur.state].includes(to as OrderState))
    throw conflict('ILLEGAL_TRANSITION', `An order that is ${cur.state} cannot become ${to}.`, { from: cur.state, to, allowed: NEXT[cur.state] });
  await pool.query('INSERT INTO queue_events(topic, payload) VALUES ($1,$2)', [
    'order.status_changed',
    JSON.stringify({ order_id: orderId, from: cur.state, to, actor }),
  ]);
  return getOrder(orderId);
}

/** Internal job queue consumer: claims unprocessed events atomically (SKIP LOCKED) and marks them processed. */
export async function processQueueOnce(limit = 100): Promise<number> {
  const r = await pool.query(
    `UPDATE queue_events SET processed_at = now()
      WHERE id IN (SELECT id FROM queue_events WHERE processed_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING topic`,
    [limit],
  );
  for (const row of r.rows) inc('jobs_processed_total', { topic: row.topic });
  return r.rowCount ?? 0;
}

export async function listQueue(limit: number) {
  const r = await pool.query('SELECT id, topic, payload, created_at, processed_at FROM queue_events ORDER BY id DESC LIMIT $1', [limit]);
  const pending = await pool.query('SELECT count(*)::int AS n FROM queue_events WHERE processed_at IS NULL');
  return {
    pending: pending.rows[0].n as number,
    events: r.rows.map((x) => ({
      id: Number(x.id),
      topic: x.topic,
      payload: x.payload,
      created_at: new Date(x.created_at).toISOString(),
      processed_at: x.processed_at ? new Date(x.processed_at).toISOString() : null,
    })),
  };
}
