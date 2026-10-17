import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChargeInput, ChargeResult, PaymentGateway } from './gateway';

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

/**
 * Stripe over plain HTTPS (no SDK dependency). Safe to retry because every request carries an
 * idempotency key derived from the order id: a retry after a timeout returns the original result
 * instead of charging twice.
 */
export class StripeGateway implements PaymentGateway {
  constructor(private readonly secretKey: string) {
    if (!/^(sk|rk)_(test|live)_/.test(secretKey)) throw new Error('STRIPE_SECRET_KEY is missing or malformed');
  }

  async charge({ orderId, amountMinor, currency, token }: ChargeInput): Promise<ChargeResult> {
    const form = new URLSearchParams({
      amount: String(amountMinor),
      currency: currency.toLowerCase(),
      payment_method: token,
      confirm: 'true',
      'automatic_payment_methods[enabled]': 'true',
      'automatic_payment_methods[allow_redirects]': 'never',
      'metadata[order_id]': orderId,
    });
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      try {
        const res = await fetch(`${API}/payment_intents`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': `order_${orderId}`,
          },
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(`stripe ${res.status}`);
          continue;
        }
        const body: any = await res.json();
        if (res.ok) {
          if (body.status === 'succeeded') return { ok: true, authorizationId: body.id, captureId: body.latest_charge ?? body.id };
          return { ok: false, reason: 'capture_failed' };
        }
        // 4xx: card_error means the issuer said no; anything else is a request we cannot complete.
        return { ok: false, reason: body?.error?.type === 'card_error' ? 'declined' : 'capture_failed' };
      } catch (e) {
        lastErr = e; // network error or timeout: retry with the same idempotency key
      }
    }
    console.error('stripe charge failed after retries', { orderId, error: (lastErr as Error)?.message });
    return { ok: false, reason: 'capture_failed' };
  }
}

/**
 * Verifies a Stripe-Signature header against the raw request body.
 * Header form: `t=<unix>,v1=<hmac>[,v1=...]`, where hmac = HMAC-SHA256(secret, `${t}.${raw}`).
 */
export function verifyStripeSignature(raw: string, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.split('=', 2) as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
