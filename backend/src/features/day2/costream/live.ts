import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../../core/config';
import type { JwtClaims } from '../../../core/crypto';
import { afterCommit, pool, tx } from '../../../core/db';
import { AppError, conflict, forbidden, notFound, validation } from '../../../core/errors';
import { parse } from '../../../core/validate';
import { playerExists } from '../common';
import { publish } from '../observability/bus';
import { notifyUser } from '../observability/hub';
import { MAX_BROADCASTERS, SessionState, sessionBody } from './service';

/** Live co-stream operations (FR-3.3): signed invites, joining, host controls, host-disconnect handoff. */

export const INVITE_TTL_MS = 15 * 60 * 1000;
const MODERATORS = new Set(['super_admin', 'league_organizer', 'club_manager']);

const mac = (data: string) => createHmac('sha256', config.day2Salt).update('invite|' + data).digest('base64url');

/** `inv1.<payload>.<mac>`: payload = base64url JSON {s: session, p: player, e: expiry ms}, HMAC-SHA256 with DAY2_SALT. */
export function signInvite(sessionId: string, playerId: string, now = Date.now()) {
  const exp = now + INVITE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ s: sessionId, p: playerId, e: exp })).toString('base64url');
  return { token: `inv1.${payload}.${mac(payload)}`, expires_at: new Date(exp).toISOString() };
}

/** The invite's {session, player} if the token is authentic and unexpired, else null. */
export function verifyInvite(token: string, now = Date.now()): { s: string; p: string; e: number } | null {
  const [v, payload, sig] = token.split('.');
  if (v !== 'inv1' || !payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof d.s === 'string' && typeof d.p === 'string' && typeof d.e === 'number' && d.e > now ? d : null;
  } catch {
    return null;
  }
}

type Db = { query: (q: string, a?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
interface Row {
  session_id: string;
  status: 'active' | 'terminated';
  active_host: string | null;
  handoff_occurred: boolean;
  participants: string[];
  active_participants: string[];
  participant_count: number;
  layout: string;
  controls: { muted?: string[]; spotlight?: string | null };
}

async function lockSession(c: Db, id: string): Promise<Row> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['costream:' + id]);
  const r = await c.query('SELECT * FROM costream_sessions WHERE session_id=$1', [id]);
  if (!r.rowCount) throw notFound('STREAM_NOT_FOUND', `Co-stream ${id} not found.`, { session_id: id });
  return r.rows[0];
}

const isHost = (u: JwtClaims, s: Row) => MODERATORS.has(u.role) || (!!u.player_id && u.player_id === s.active_host);

const stateOf = (s: Row): SessionState => ({
  status: s.status, active_host: s.active_host, handoff_occurred: s.handoff_occurred, participant_count: s.participant_count, active_participants: s.active_participants,
});

async function save(c: Db, s: Row, event: string, extra: object = {}) {
  await c.query(
    `UPDATE costream_sessions SET status=$2, active_host=$3, handoff_occurred=$4, participants=$5, active_participants=$6, participant_count=$7,
       layout=$8, controls=$9, updated_at=now() WHERE session_id=$1`,
    [s.session_id, s.status, s.active_host, s.handoff_occurred, JSON.stringify(s.participants), JSON.stringify(s.active_participants),
      s.participant_count, s.layout, JSON.stringify(s.controls)],
  );
  const body = { ...sessionBody(s.session_id, s.layout, stateOf(s)), controls: { muted: s.controls.muted ?? [], spotlight: s.controls.spotlight ?? null } };
  afterCommit(c, () => publish(`costream:${s.session_id}`, { type: event, ...extra, ...body }));
  return body;
}

/** Smallest layout that fits the active broadcasters (a join never breaks the composite). */
const fit = (layout: string, n: number) => (layout === 'spotlight' ? layout : n <= 1 && layout === 'solo' ? 'solo' : n <= 2 && layout !== 'grid_4' ? 'grid_2' : 'grid_4');

export async function invite(user: JwtClaims, sessionId: string, rawBody: unknown) {
  const b = parse(z.object({ player_id: z.string().min(1).max(128) }), rawBody);
  const out = await tx(async (c) => {
    const s = await lockSession(c, sessionId);
    if (!isHost(user, s)) throw forbidden('Only the active host can invite to this co-stream.');
    if (!(await playerExists(c, b.player_id))) throw notFound('PLAYER_NOT_FOUND', `Player ${b.player_id} not found.`, { player_id: b.player_id });
    if (s.status !== 'active') throw conflict('COSTREAM_TERMINATED', 'This co-stream has ended.', { session_id: sessionId });
    if (!s.active_participants.includes(b.player_id) && s.active_participants.length >= MAX_BROADCASTERS)
      throw conflict('COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_BROADCASTERS} broadcasters.`, { max: MAX_BROADCASTERS });
    const t = signInvite(sessionId, b.player_id);
    return { session_id: sessionId, player_id: b.player_id, invite_token: t.token, expires_at: t.expires_at, invited_by: user.sub };
  });
  // real-time delivery; an offline invitee goes through bounded retries to the DLQ (FR-5.2)
  void notifyUser(b.player_id, {
    type: 'costream.invite', title: 'Co-stream invite', message: `You are invited to go live in ${sessionId}`, ...out,
  }).catch(() => undefined);
  return out;
}

export async function join(user: JwtClaims, sessionId: string, rawBody: unknown) {
  const b = parse(z.object({ invite_token: z.string().min(1).max(1024) }), rawBody);
  const inv = verifyInvite(b.invite_token);
  if (!inv || inv.s !== sessionId) throw new AppError(403, 'FORBIDDEN', 'Invalid or expired invite token.', { session_id: sessionId });
  if (user.player_id !== inv.p && !MODERATORS.has(user.role)) throw forbidden('This invite was issued to another player.');
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    if (s.status !== 'active') throw conflict('COSTREAM_TERMINATED', 'This co-stream has ended.', { session_id: sessionId });
    if (s.active_participants.includes(inv.p)) return save(c, s, 'costream.join', { player_id: inv.p });
    if (s.active_participants.length >= MAX_BROADCASTERS)
      throw conflict('COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_BROADCASTERS} broadcasters.`, { max: MAX_BROADCASTERS });
    if (!s.participants.includes(inv.p)) s.participants = [...s.participants, inv.p];
    s.active_participants = [...s.active_participants, inv.p];
    s.participant_count = s.active_participants.length;
    s.layout = fit(s.layout, s.participant_count);
    return save(c, s, 'costream.join', { player_id: inv.p });
  });
}

const controlSchema = z.object({ action: z.enum(['mute_audio', 'unmute_audio', 'spotlight', 'kick']), player_id: z.string().min(1).max(128) });

/** Host controls: mute/unmute a broadcaster's audio, spotlight one feed, or kick a participant. Idempotent. */
export async function control(user: JwtClaims, sessionId: string, rawBody: unknown) {
  const b = parse(controlSchema, rawBody);
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    if (!isHost(user, s)) throw forbidden('Only the active host can control this co-stream.');
    if (s.status !== 'active') throw conflict('COSTREAM_TERMINATED', 'This co-stream has ended.', { session_id: sessionId });
    if (!s.active_participants.includes(b.player_id)) throw notFound('PLAYER_NOT_FOUND', `${b.player_id} is not live in this co-stream.`, { player_id: b.player_id });
    const muted = new Set(s.controls.muted ?? []);
    if (b.action === 'mute_audio') muted.add(b.player_id);
    else if (b.action === 'unmute_audio') muted.delete(b.player_id);
    else if (b.action === 'spotlight') {
      s.controls.spotlight = b.player_id;
      s.layout = 'spotlight';
    } else {
      if (b.player_id === s.active_host) throw validation(['player_id'], 'The host cannot kick themselves; hand off or end the stream.');
      s.active_participants = s.active_participants.filter((p) => p !== b.player_id);
      s.participant_count = s.active_participants.length;
      muted.delete(b.player_id);
      if (s.controls.spotlight === b.player_id) s.controls.spotlight = null;
    }
    s.controls.muted = [...muted];
    return save(c, s, 'costream.control', { action: b.action, player_id: b.player_id });
  });
}

/**
 * Host disconnect handoff (scenario 1, FR-3.3): when the active host's last broadcaster socket closes,
 * hosting passes to the next active participant in array order within HANDOFF_GRACE_MS (< 1.5 s);
 * with nobody left the session terminates. A reconnect inside the grace period cancels it.
 */
export const HANDOFF_GRACE_MS = 300;
const presence = new Map<string, number>();
const key = (s: string, p: string) => `${s}|${p}`;

export async function handOffIfHostGone(sessionId: string, playerId: string) {
  if (presence.get(key(sessionId, playerId))) return null;
  return tx(async (c) => {
    const s = await lockSession(c, sessionId);
    if (s.status !== 'active' || s.active_host !== playerId) return null;
    s.active_participants = s.active_participants.filter((p) => p !== playerId);
    s.participant_count = s.active_participants.length;
    if (s.participant_count) {
      s.active_host = s.active_participants[0];
      s.handoff_occurred = true;
    } else {
      s.status = 'terminated';
      s.active_host = null;
      s.handoff_occurred = false;
    }
    return save(c, s, 'costream.handoff', { dropped: playerId });
  });
}

/** Realtime hook: a broadcaster socket opened. The returned function runs when it closes. */
export async function onBroadcaster(sessionId: string, user: JwtClaims, graceMs = HANDOFF_GRACE_MS): Promise<() => void> {
  const p = user.player_id;
  if (!p) throw forbidden('Only a player can broadcast.');
  const r = await pool.query('SELECT active_participants FROM costream_sessions WHERE session_id=$1', [sessionId]);
  if (!r.rows[0]?.active_participants.includes(p)) throw forbidden('You are not a live participant of this co-stream.');
  const k = key(sessionId, p);
  presence.set(k, (presence.get(k) ?? 0) + 1);
  return () => {
    const n = (presence.get(k) ?? 1) - 1;
    if (n > 0) return void presence.set(k, n);
    presence.delete(k);
    setTimeout(() => void handOffIfHostGone(sessionId, p).catch(() => undefined), graceMs).unref();
  };
}
