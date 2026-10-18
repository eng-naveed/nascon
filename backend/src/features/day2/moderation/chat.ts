import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JwtClaims } from '../../../core/crypto';
import { pool, tx } from '../../../core/db';
import { AppError, forbidden } from '../../../core/errors';
import { parse } from '../../../core/validate';
import { publish } from '../observability/bus';
import { classify } from './normalize';
import { RATE_LIMIT_MAX } from './service';

/** Live audience chat (FR-3.3 unified room, FR-5.3 synchronous pre-broadcast moderation). */

export const RATE_WINDOW_MS = 2000;
const roomId = z.string().regex(/^[A-Za-z0-9_.:\-]{1,128}$/);
const postSchema = z.object({
  chat_room_id: roomId,
  text: z.string().min(1).max(500),
  message_id: z.string().min(1).max(128).optional(),
});
const modSchema = z.object({ user_id: z.string().min(1).max(128), action: z.enum(['mute', 'unmute', 'kick', 'unkick']) });

/** Sliding-window send log per room|sender. Attempts count, accepted or not, so a flooder cannot reset the window. */
const sends = new Map<string, number[]>();
let now = () => Date.now();
export const setChatClock = (fn: () => number) => void (now = fn);
export function clearChatState() {
  sends.clear();
}

/** True when this attempt is the 4th (or later) inside the 2 s window. */
function overRateLimit(key: string): boolean {
  const t = now();
  const recent = (sends.get(key) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
  recent.push(t);
  sends.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

const lockRoom = (c: { query: (q: string, a: unknown[]) => Promise<unknown> }, room: string) =>
  c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['moderation:' + room]);

async function addState(room: string, user: string, kind: 'kicked' | 'muted') {
  await tx(async (c) => {
    await lockRoom(c, room);
    await c.query('INSERT INTO moderation_state(chat_room_id, user_id, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [room, user, kind]);
  });
}

const rateLimited = (room: string, reason: string) =>
  new AppError(429, 'RATE_LIMITED', 'Chat flood threshold exceeded: you have been muted in this room.', { chat_room_id: room, reason }, { 'Retry-After': '2' });

export async function postChat(user: JwtClaims, rawBody: unknown) {
  const body = parse(postSchema, rawBody);
  const room = body.chat_room_id;
  const sender = user.sub;

  const st = await pool.query('SELECT kind FROM moderation_state WHERE chat_room_id=$1 AND user_id=$2', [room, sender]);
  const kinds = new Set(st.rows.map((r) => r.kind));
  if (kinds.has('kicked') || kinds.has('muted')) {
    const reason = kinds.has('kicked') ? 'kicked' : 'muted';
    throw new AppError(403, 'FORBIDDEN', `You are ${reason} in this chat room.`, { chat_room_id: room, reason });
  }

  if (overRateLimit(`${room}|${sender}`)) {
    await addState(room, sender, 'muted');
    throw rateLimited(room, 'rate_limit_exceeded');
  }
  const v = classify(body.text);
  if (v.kind === 'flood') {
    await addState(room, sender, 'muted');
    throw rateLimited(room, 'flood_character_repeat');
  }

  const flagged = v.kind === 'profanity';
  const text = flagged ? v.text : body.text;
  const messageId = body.message_id ?? randomUUID();
  const msg = await tx(async (c) => {
    // a kick takes the room's moderation lock first, the same order every moderation writer uses
    if (flagged) await lockRoom(c, room);
    // one counter row per room: the UPDATE row lock makes seq gapless and strictly increasing across all writers
    const s = await c.query(
      `INSERT INTO chat_rooms(chat_room_id, last_seq) VALUES ($1, 1)
       ON CONFLICT (chat_room_id) DO UPDATE SET last_seq = chat_rooms.last_seq + 1 RETURNING last_seq::int AS seq`,
      [room],
    );
    const seq = s.rows[0].seq as number;
    const r = await c.query(
      `INSERT INTO chat_messages(chat_room_id, seq, message_id, sender, text, flagged, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING created_at`,
      [room, seq, messageId, sender, text, flagged, flagged ? 'profanity_leetspeak' : null],
    );
    if (flagged) {
      await c.query("INSERT INTO moderation_state(chat_room_id, user_id, kind) VALUES ($1,$2,'kicked') ON CONFLICT DO NOTHING", [room, sender]);
    }
    return {
      chat_room_id: room, seq, message_id: messageId, sender, text, flagged,
      reason: flagged ? 'profanity_leetspeak' : null, created_at: (r.rows[0].created_at as Date).toISOString(),
    };
  });
  publish(`chat:${room}`, { type: 'chat.message', ...msg });
  return msg;
}

export async function listChat(room: string, query: Record<string, string>) {
  const q = parse(
    z.object({ after_seq: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }),
    query,
  );
  parse(z.object({ chat_room_id: roomId }), { chat_room_id: room });
  const r = await pool.query(
    `SELECT seq::int, message_id, sender, text, flagged, reason, created_at FROM chat_messages
      WHERE chat_room_id=$1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [room, q.after_seq ?? 0, q.limit ?? 50],
  );
  const last = await pool.query('SELECT last_seq::int AS n FROM chat_rooms WHERE chat_room_id=$1', [room]);
  return {
    chat_room_id: room,
    last_seq: last.rows[0]?.n ?? 0,
    messages: r.rows.map((m) => ({ ...m, created_at: (m.created_at as Date).toISOString() })),
  };
}

const MODERATOR_ROLES = new Set(['super_admin', 'league_organizer', 'club_manager']);

/** Platform moderators, or the (active) host of the co-stream that owns the room (chat-{session_id}). */
async function canModerate(user: JwtClaims, room: string): Promise<boolean> {
  if (MODERATOR_ROLES.has(user.role)) return true;
  if (!user.player_id || !room.startsWith('chat-')) return false;
  const r = await pool.query('SELECT 1 FROM costream_sessions WHERE session_id=$1 AND (host_player_id=$2 OR active_host=$2)', [room.slice(5), user.player_id]);
  return !!r.rowCount;
}

/** Idempotent moderator action; concurrent moderators serialise on the room lock. Returns the room's full lists. */
export async function moderate(user: JwtClaims, room: string, rawBody: unknown) {
  const body = parse(modSchema, rawBody);
  parse(z.object({ chat_room_id: roomId }), { chat_room_id: room });
  if (!(await canModerate(user, room))) throw forbidden('Only a platform moderator or the co-stream host can moderate this room.');
  const kind = body.action === 'mute' || body.action === 'unmute' ? 'muted' : 'kicked';
  const res = await tx(async (c) => {
    await lockRoom(c, room);
    if (body.action === 'mute' || body.action === 'kick')
      await c.query('INSERT INTO moderation_state(chat_room_id, user_id, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [room, body.user_id, kind]);
    else await c.query('DELETE FROM moderation_state WHERE chat_room_id=$1 AND user_id=$2 AND kind=$3', [room, body.user_id, kind]);
    const r = await c.query('SELECT user_id, kind FROM moderation_state WHERE chat_room_id=$1 ORDER BY seq', [room]);
    const list = (k: string) => r.rows.filter((x) => x.kind === k).map((x) => x.user_id as string);
    return { chat_room_id: room, user_id: body.user_id, action: body.action, muted_users: list('muted'), kicked_users: list('kicked') };
  });
  publish(`chat:${room}`, { type: 'chat.moderation', ...res });
  return res;
}
