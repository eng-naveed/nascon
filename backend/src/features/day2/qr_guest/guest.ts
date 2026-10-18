import { randomBytes } from 'node:crypto';
import { pool } from '../../../core/db';

/** Zero-account guest viewing (FR-4.2): a short-lived, read-only anonymous token. Writes are refused by the guard. */
export const GUEST_TTL_MS = 2 * 3600 * 1000;
export const GUEST_SCOPE = ['stream_playback', 'live_score', 'guest_cart'];

export async function issueGuestSession(now = Date.now()) {
  const token = 'guest_anon_tok_' + randomBytes(18).toString('base64url');
  const expires = new Date(now + GUEST_TTL_MS);
  await pool.query("INSERT INTO guest_tokens(guest_token, status, expires_at) VALUES ($1, 'active', $2)", [token, expires]);
  return { guest_token: token, role: 'guest', scope: GUEST_SCOPE, expires_at: expires.toISOString() };
}
