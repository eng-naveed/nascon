import { config } from '../../core/config';
import { StripeGateway } from './stripe';

export type ChargeInput = { orderId: string; amountMinor: number; currency: string; token: string };
export type ChargeResult =
  | { ok: true; authorizationId: string; captureId: string }
  | { ok: false; reason: 'declined' | 'capture_failed' };

export interface PaymentGateway {
  charge(input: ChargeInput): Promise<ChargeResult>;
}

/** Mock gateway required by the competition spec. Default provider; never touches the network. */
export class MockGateway implements PaymentGateway {
  async charge({ orderId, token }: ChargeInput): Promise<ChargeResult> {
    if (token === 'tok_success') return { ok: true, authorizationId: `auth_${orderId}`, captureId: `cap_${orderId}` };
    if (token === 'tok_capture_fail') return { ok: false, reason: 'capture_failed' };
    return { ok: false, reason: 'declined' };
  }
}

let cached: PaymentGateway | undefined;

/** Provider is chosen once from PAYMENT_PROVIDER. Anything other than "stripe" is the mock. */
export function getGateway(): PaymentGateway {
  if (!cached) cached = config.paymentProvider === 'stripe' ? new StripeGateway(config.stripe.secretKey) : new MockGateway();
  return cached;
}

export function resetGatewayForTests() {
  cached = undefined;
}
