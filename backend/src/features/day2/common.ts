import type { PoolClient } from 'pg';
import { config } from '../../core/config';
import { sign } from '../../core/crypto';
import { AppError } from '../../core/errors';

type Db = Pick<PoolClient, 'query'>;

/** Phase II signature: HMAC-SHA256(DAY2_SALT, entity_id + "|" + canonical(sig_payload)). */
export const sign2 = (entityId: string, sigPayload: unknown): string => sign(config.day2Salt, entityId, sigPayload);

/** A player exists if it is a seeded RBAC player, a roster player, or a user's linked player/user id. */
export async function playerExists(db: Db, id: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM rbac_entities WHERE kind='player' AND id=$1
     UNION ALL SELECT 1 FROM roster_players WHERE player_id=$1
     UNION ALL SELECT 1 FROM users WHERE player_id=$1 OR user_id=$1
     LIMIT 1`,
    [id],
  );
  // An erased (anonymised) player still exists as a row, so privacy erasure stays idempotent.
  return !!r.rowCount;
}

/** Entity types that may carry a dynamic QR code, derived from the id prefix. */
export function entityTypeOf(id: string): 'match' | 'club' | 'player' | 'costream' | null {
  if (id.startsWith('match-')) return 'match';
  if (id.startsWith('club-')) return 'club';
  if (id.startsWith('player-')) return 'player';
  if (id.startsWith('cs-session-')) return 'costream';
  return null;
}

// Any bearer starting with "guest_" is a guest credential (cart-merge accepts any guest_* token); no JWT starts with it.
export const GUEST_TOKEN_RE = /^Bearer\s+(guest_[A-Za-z0-9_.:-]+)$/i;
/** Guest tokens may still call these write-shaped routes (token issuing and the cart-merge probe itself). */
export const GUEST_WRITE_EXEMPT = new Set(['/audit/v1/guest/cart-merge', '/api/v1/guest/session']);

/**
 * The zero-trust write boundary (FR-4.3): the 403 a request would get for carrying a guest token on a write,
 * or null. Used by the onRequest hook and by the cart-merge probe's internal write simulation.
 */
export function guestWriteRejection(method: string, url: string, authorization: string | undefined): AppError | null {
  const m = GUEST_TOKEN_RE.exec(authorization ?? '');
  if (!m || method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (GUEST_WRITE_EXEMPT.has(url.split('?')[0])) return null;
  return new AppError(403, 'GUEST_WRITE_FORBIDDEN', 'Anonymous guest tokens cannot perform write mutations.', { guest_token: m[1] });
}
