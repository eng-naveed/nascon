import { tx } from '../../../core/db';
import { notFound } from '../../../core/errors';
import { playerExists } from '../common';

/**
 * Right to erasure (NFR-9, spec 5.9): PII is overwritten in place (rows stay, so ids, carts and history keep
 * referential integrity) and every guest/viewer token linked to the account is wiped. Idempotent.
 */
const erased = new Set<string>();

/** True for a user id whose session tokens must no longer authenticate. */
export const isErased = (userId: string) => erased.has(userId);
export function clearErased() {
  erased.clear();
}

export async function loadErased(db: { query: (q: string) => Promise<{ rows: { user_id: string }[] }> }) {
  for (const r of (await db.query('SELECT user_id FROM erased_users')).rows) erased.add(r.user_id);
}

export async function eraseUser(id: string) {
  const ids = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['erase:' + id]);
    if (!(await playerExists(c, id))) throw notFound('PLAYER_NOT_FOUND', `User ${id} not found.`, { user_id: id });
    // the account may be addressed by its user id or by its linked player id
    const users = await c.query('SELECT user_id, player_id FROM users WHERE user_id=$1 OR player_id=$1', [id]);
    const all = new Set<string>([id]);
    for (const u of users.rows) {
      all.add(u.user_id);
      if (u.player_id) all.add(u.player_id);
    }
    const list = [...all];
    await c.query(
      `UPDATE users SET email = 'erased+' || md5(user_id) || '@invalid.local', name = 'Erased User', password_hash = '!' WHERE user_id = ANY($1)`,
      [list],
    );
    await c.query("UPDATE roster_players SET name = 'Erased Player' WHERE player_id = ANY($1)", [list]);
    await c.query("UPDATE chat_messages SET sender = 'erased-' || md5(sender) WHERE sender = ANY($1)", [list]);
    await c.query("UPDATE guest_tokens SET status = 'wiped', merged_user_id = NULL, merged_response = NULL WHERE merged_user_id = ANY($1)", [list]);
    await c.query('INSERT INTO erased_users(user_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [list]);
    return list;
  });
  for (const u of ids) erased.add(u);
  return { user_id: id, status: 'anonymized', pii_retained: false, tokens_wiped: true };
}
