import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGateway } from '../src/features/payments/gateway';
import { StripeGateway, verifyStripeSignature } from '../src/features/payments/stripe';

const sign = (raw: string, secret: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const input = { orderId: 'o1', amountMinor: 5000, currency: 'PKR', token: 'pm_card_visa' };

describe('MockGateway', () => {
  it('maps the spec tokens', async () => {
    const g = new MockGateway();
    expect(await g.charge({ ...input, token: 'tok_success' })).toEqual({ ok: true, authorizationId: 'auth_o1', captureId: 'cap_o1' });
    expect(await g.charge({ ...input, token: 'tok_capture_fail' })).toEqual({ ok: false, reason: 'capture_failed' });
    expect(await g.charge({ ...input, token: 'tok_declined' })).toEqual({ ok: false, reason: 'declined' });
  });
});

describe('verifyStripeSignature', () => {
  const raw = '{"id":"evt_1"}';
  const now = 1_700_000_000;
  it('accepts a valid signature', () => expect(verifyStripeSignature(raw, sign(raw, 'whsec_x', now), 'whsec_x', 300, now)).toBe(true));
  it('rejects wrong secret, tampered body, stale timestamp, bad header', () => {
    expect(verifyStripeSignature(raw, sign(raw, 'other', now), 'whsec_x', 300, now)).toBe(false);
    expect(verifyStripeSignature(raw + ' ', sign(raw, 'whsec_x', now), 'whsec_x', 300, now)).toBe(false);
    expect(verifyStripeSignature(raw, sign(raw, 'whsec_x', now - 301), 'whsec_x', 300, now)).toBe(false);
    expect(verifyStripeSignature(raw, undefined, 'whsec_x', 300, now)).toBe(false);
    expect(verifyStripeSignature(raw, 'garbage', 'whsec_x', 300, now)).toBe(false);
    expect(verifyStripeSignature(raw, sign(raw, 'whsec_x', now), '', 300, now)).toBe(false);
  });
});

describe('StripeGateway', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });

  it('rejects malformed keys', () => expect(() => new StripeGateway('nope')).toThrow());

  it('succeeds and sends an idempotency key', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { id: 'pi_1', status: 'succeeded', latest_charge: 'ch_1' }));
    vi.stubGlobal('fetch', f);
    expect(await new StripeGateway('sk_test_abc').charge(input)).toEqual({ ok: true, authorizationId: 'pi_1', captureId: 'ch_1' });
    expect(f.mock.calls[0][1].headers['Idempotency-Key']).toBe('order_o1');
  });
  it('maps card_error to declined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(402, { error: { type: 'card_error' } })));
    expect(await new StripeGateway('sk_test_abc').charge(input)).toEqual({ ok: false, reason: 'declined' });
  });
  it('retries 5xx then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(503, {})).mockResolvedValue(reply(200, { id: 'pi_2', status: 'succeeded' }));
    vi.stubGlobal('fetch', f);
    const r = await new StripeGateway('sk_test_abc').charge(input);
    expect(r).toEqual({ ok: true, authorizationId: 'pi_2', captureId: 'pi_2' });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('gives up after retries on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await new StripeGateway('sk_test_abc').charge(input)).toEqual({ ok: false, reason: 'capture_failed' });
  });
});
