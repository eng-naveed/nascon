import { config } from '../../core/config';
import { tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { verifyStripeSignature } from './stripe';

const HANDLED = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created']);

/**
 * Stripe webhook receiver. Authenticity comes from the signature, so it needs the raw body.
 * Duplicate deliveries (Stripe retries) are dropped via the stripe_events primary key; accepted
 * events are handed to queue_events so slow work never blocks the 2xx Stripe is waiting for.
 */
export async function handleStripeWebhook(raw: string | undefined, signature: string | undefined) {
  if (raw === undefined || !verifyStripeSignature(raw, signature, config.stripe.webhookSecret))
    throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
  let event: { id?: string; type?: string; data?: { object?: { id?: string; metadata?: { order_id?: string } } } };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body.');
  }
  if (typeof event.id !== 'string' || typeof event.type !== 'string') throw new AppError(400, 'VALIDATION_ERROR', 'Malformed event.');
  const { id, type } = event;
  return tx(async (c) => {
    const ins = await c.query('INSERT INTO stripe_events(event_id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, type]);
    if (!ins.rowCount) return { received: true, duplicate: true };
    if (HANDLED.has(type)) {
      const obj = event.data?.object;
      await c.query('INSERT INTO queue_events(topic, payload) VALUES ($1,$2)', [
        `stripe.${type}`,
        JSON.stringify({ event_id: id, object_id: obj?.id ?? null, order_id: obj?.metadata?.order_id ?? null }),
      ]);
    }
    return { received: true, duplicate: false };
  });
}
