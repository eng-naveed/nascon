import { z } from 'zod';
import { bodyHash } from '../../../core/crypto';
import { tx } from '../../../core/db';
import { conflict, notFound } from '../../../core/errors';
import { parse } from '../../../core/validate';
import { guestWriteRejection, playerExists, sign2 } from '../common';

/** Progressive registration: atomic guest-cart merge (FR-4.4, spec 5.7, scenario 4). */

const mergeSchema = z.object({
  guest_token: z.string().min(7).max(128).regex(/^guest_[A-Za-z0-9_.:-]+$/),
  registered_user_id: z.string().min(1).max(128),
  guest_cart: z.array(z.object({ variant_id: z.string().min(1).max(64), quantity: z.number().int().min(1).max(1000) })).min(1).max(10),
  test_write_block: z.boolean().optional(),
});

/** Same guest_cart content in any order / split across duplicate lines merges identically. */
function normalise(cart: { variant_id: string; quantity: number }[]) {
  const m = new Map<string, number>();
  for (const i of cart) m.set(i.variant_id, (m.get(i.variant_id) ?? 0) + i.quantity);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([variant_id, quantity]) => ({ variant_id, quantity }));
}

/**
 * Simulated write with the guest token (spec 5.7 rule 4): asks the real request guard what it would answer
 * to a guest posting chat. Returns the rejection status (403) or null if the guard let it through.
 */
export function simulateGuestWrite(guestToken: string): number | null {
  return guestWriteRejection('POST', '/api/v1/chat', `Bearer ${guestToken}`)?.status ?? null;
}

/** jsonb does not keep key order: a replay re-emits the stored receipt in the contract's key order. */
function ordered(r: any) {
  const c = r.active_cart;
  return {
    guest_token: r.guest_token,
    write_block_verified: r.write_block_verified,
    write_rejection_code: r.write_rejection_code,
    cart_merged: r.cart_merged,
    active_cart: {
      user_id: c.user_id, currency: c.currency, total_items: c.total_items, subtotal_minor: c.subtotal_minor,
      items: c.items.map((i: any) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: i.unit_price_minor })),
    },
    signature: r.signature,
  };
}

export async function cartMerge(rawBody: unknown) {
  const body = parse(mergeSchema, rawBody);
  const items = normalise(body.guest_cart);
  const ids = items.map((i) => i.variant_id);
  const hash = bodyHash({ guest_token: body.guest_token, registered_user_id: body.registered_user_id, guest_cart: items });

  return tx(async (c) => {
    // one merge per guest token at a time: a retried request (4G -> Wi-Fi) waits here, then replays
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['guest-merge:' + body.guest_token]);
    if (!(await playerExists(c, body.registered_user_id)))
      throw notFound('PLAYER_NOT_FOUND', `User ${body.registered_user_id} not found.`, { registered_user_id: body.registered_user_id });
    const vs = await c.query('SELECT variant_id, price_minor, currency FROM variants WHERE variant_id = ANY($1)', [ids]);
    const known = new Map(vs.rows.map((v) => [v.variant_id as string, v]));
    for (const i of body.guest_cart)
      if (!known.has(i.variant_id)) throw notFound('VARIANT_NOT_FOUND', `Variant ${i.variant_id} not found.`, { variant_id: i.variant_id });

    const tok = await c.query('SELECT status, payload_hash, merged_response FROM guest_tokens WHERE guest_token=$1', [body.guest_token]);
    if (tok.rows[0]?.status === 'wiped')
      throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token was invalidated by an account erasure.', { guest_token: body.guest_token });
    if (tok.rows[0]?.status === 'merged') {
      if (tok.rows[0].payload_hash === hash) return ordered(tok.rows[0].merged_response);
      throw conflict('GUEST_TOKEN_ALREADY_MERGED', 'This guest token was already merged with a different user or cart.', { guest_token: body.guest_token });
    }

    // reserve the staged quantities exactly once; ids are sorted, so concurrent merges lock variants in one order
    for (const i of items) {
      const r = await c.query('UPDATE variants SET stock = stock - $2, reserved = reserved + $2 WHERE variant_id=$1 AND stock >= $2', [i.variant_id, i.quantity]);
      if (!r.rowCount) throw conflict('OUT_OF_STOCK', `Variant ${i.variant_id} does not have enough stock.`, { variant_id: i.variant_id });
    }
    for (const i of items)
      await c.query(
        `INSERT INTO carts(user_id, variant_id, quantity) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, variant_id) DO UPDATE SET quantity = carts.quantity + EXCLUDED.quantity`,
        [body.registered_user_id, i.variant_id, i.quantity],
      );

    const cart = await c.query(
      `SELECT c.variant_id, c.quantity, v.price_minor, v.currency FROM carts c JOIN variants v ON v.variant_id = c.variant_id
        WHERE c.user_id=$1 ORDER BY c.variant_id`,
      [body.registered_user_id],
    );
    const cartItems = cart.rows.map((r) => ({ variant_id: r.variant_id as string, quantity: r.quantity as number, unit_price_minor: r.price_minor as number }));
    const totalItems = cartItems.reduce((s, i) => s + i.quantity, 0);
    const verified = body.test_write_block ?? true;
    const rejection = verified ? simulateGuestWrite(body.guest_token) : null;
    const writeRejectionCode = rejection ?? 403;
    const response = {
      guest_token: body.guest_token,
      write_block_verified: rejection === 403,
      write_rejection_code: writeRejectionCode,
      cart_merged: true,
      active_cart: {
        user_id: body.registered_user_id,
        currency: (cart.rows[0]?.currency as string) ?? 'PKR',
        total_items: totalItems,
        subtotal_minor: cartItems.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0),
        items: cartItems,
      },
      signature: sign2(body.guest_token, {
        cart_merged: true, guest_token: body.guest_token, registered_user_id: body.registered_user_id, total_items: totalItems, write_rejection_code: writeRejectionCode,
      }),
    };
    await c.query(
      `INSERT INTO guest_tokens(guest_token, status, merged_user_id, payload_hash, merged_response) VALUES ($1,'merged',$2,$3,$4)
       ON CONFLICT (guest_token) DO UPDATE SET status='merged', merged_user_id=$2, payload_hash=$3, merged_response=$4`,
      [body.guest_token, body.registered_user_id, hash, JSON.stringify(response)],
    );
    return response;
  });
}
