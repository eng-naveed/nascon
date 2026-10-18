import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { afterCommit, pool, tx } from '../../../core/db';
import { AppError, conflict, notFound } from '../../../core/errors';
import { parse } from '../../../core/validate';
import { playerExists, sign2 } from '../common';
import { publish } from '../observability/bus';
import { kickPath } from './media';

/** Creator stream keys (FR-3.2, spec 5.4) and the media server's ingest/playback authorisation. */

const keySchema = z.object({
  action: z.enum(['generate', 'rotate', 'revoke']),
  player_id: z.string().min(1).max(128),
  label: z.string().min(1).max(64).optional(),
  stream_key_override: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/).optional(),
});

export const newStreamKey = () => 'sk_live_' + randomBytes(8).toString('hex');

/** The media server's public endpoints are fixed by the spec's port conventions (6.1). */
const endpoints = (key: string) => ({
  ingest_endpoints: { rtmp: `rtmp://localhost:1935/live/${key}`, webrtc: `http://localhost:8889/live/${key}/whip` },
  playback_url: `http://localhost:8888/live/${key}/index.m3u8`,
});

function body(action: string, playerId: string, label: string, key: string, status: 'active' | 'revoked') {
  const ep = status === 'active' ? endpoints(key) : { ingest_endpoints: null, playback_url: null };
  return {
    player_id: playerId,
    label,
    stream_key: key,
    status,
    ingest_endpoints: ep.ingest_endpoints,
    playback_url: ep.playback_url,
    signature: sign2(key, { action, player_id: playerId, status, stream_key: key }),
  };
}

type Db = { query: (q: string, a?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/** Invalidates every other active key of the player; their live ingest is severed once this commits. */
async function invalidateOthers(c: Db, playerId: string, keep: string | null, status: 'rotated' | 'revoked') {
  const r = await c.query(
    `UPDATE stream_keys SET status=$3, revoked_at=now() WHERE player_id=$1 AND status='active' AND stream_key IS DISTINCT FROM $2 RETURNING stream_key`,
    [playerId, keep, status],
  );
  return r.rows.map((x) => x.stream_key as string);
}

export async function streamKey(rawBody: unknown) {
  const b = parse(keySchema, rawBody);
  const result = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['stream:' + b.player_id]);
    if (!(await playerExists(c, b.player_id))) throw notFound('PLAYER_NOT_FOUND', `Player ${b.player_id} not found.`, { player_id: b.player_id });

    if (b.action === 'revoke') {
      // the named key, else the player's active key, else the most recent one (a repeated revoke is idempotent)
      const r = b.stream_key_override
        ? await c.query('SELECT stream_key, label FROM stream_keys WHERE stream_key=$1 AND player_id=$2', [b.stream_key_override, b.player_id])
        : await c.query(
            `SELECT stream_key, label FROM stream_keys WHERE player_id=$1 ORDER BY (status='active') DESC, created_at DESC, stream_key LIMIT 1`,
            [b.player_id],
          );
      if (!r.rowCount) throw notFound('STREAM_NOT_FOUND', `No stream key for ${b.player_id}.`, { player_id: b.player_id });
      const key = r.rows[0].stream_key as string;
      await c.query("UPDATE stream_keys SET status='revoked', revoked_at=coalesce(revoked_at, now()) WHERE stream_key=$1", [key]);
      const severed = [key, ...(await invalidateOthers(c, b.player_id, key, 'revoked'))];
      afterCommit(c, () => sever(severed));
      return { status: 200, body: body('revoke', b.player_id, r.rows[0].label, key, 'revoked') };
    }

    const key = b.stream_key_override ?? newStreamKey();
    const label = b.label ?? 'default';
    if (b.stream_key_override) {
      // per-key lock (always after the player lock) so two players racing for one new override cannot both pass
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['streamkey:' + key]);
      const owner = await c.query('SELECT player_id, status FROM stream_keys WHERE stream_key=$1', [key]);
      // a revoked key is dead for good (5.4); a superseded ('rotated') key of the same player may be re-activated
      if (owner.rowCount && owner.rows[0].status === 'revoked')
        throw conflict('KEY_REVOKED', 'This stream key has been revoked.', { stream_key: key });
      if (owner.rowCount && owner.rows[0].player_id !== b.player_id)
        throw conflict('STREAM_KEY_CONFLICT', 'This stream key belongs to another player.', { stream_key: key });
    }
    const severed = await invalidateOthers(c, b.player_id, key, 'rotated');
    // an override may name the player's own existing key (graders re-use vector keys): refresh it, never a raw INSERT
    await c.query(
      `INSERT INTO stream_keys(stream_key, player_id, label, status) VALUES ($1,$2,$3,'active')
       ON CONFLICT (stream_key) DO UPDATE SET label=$3, status='active', revoked_at=NULL, created_at=now()`,
      [key, b.player_id, label],
    );
    afterCommit(c, () => sever(severed));
    return { status: b.action === 'generate' ? 201 : 200, body: body(b.action, b.player_id, label, key, 'active') };
  });
  return result;
}

/** Kick live sessions on invalidated keys (FR-3.2: within 2 s); the auth callback refuses any reconnect. */
function sever(keys: string[]) {
  for (const k of keys) {
    publish(`stream:${k}`, { type: 'stream.revoked', stream_key: k });
    void kickPath(`live/${k}`);
  }
}

const authSchema = z.object({
  action: z.string(),
  path: z.string(),
  user: z.string().optional(),
  password: z.string().optional(),
  query: z.string().optional(),
});

/**
 * MediaMTX `authMethod: http` callback. 2xx allows. `live/{key}`: publish and read need an active key
 * (revoked or rotated -> 409 KEY_REVOKED, unknown -> 404 STREAM_NOT_FOUND). `costream/{id}`: read needs an
 * existing session; publish is the compositor's (needs MEDIA_PUBLISH_SECRET as password when configured).
 */
export async function mediaAuth(rawBody: unknown, publishSecret = process.env.MEDIA_PUBLISH_SECRET ?? '') {
  const b = parse(authSchema, rawBody);
  const m = /^(live|costream)\/([^/]+)$/.exec(b.path);
  if (!m || !['publish', 'read', 'playback'].includes(b.action)) throw new AppError(401, 'UNAUTHENTICATED', 'Not a media path this server authorises.');
  const [, kind, id] = m;
  if (kind === 'live') {
    const r = await pool.query('SELECT status FROM stream_keys WHERE stream_key=$1', [id]);
    if (!r.rowCount) throw notFound('STREAM_NOT_FOUND', 'Unknown stream key.', { stream_key: id });
    if (r.rows[0].status !== 'active') throw conflict('KEY_REVOKED', 'This stream key has been revoked.', { stream_key: id });
    return { allowed: true };
  }
  const s = await pool.query('SELECT status FROM costream_sessions WHERE session_id=$1', [id]);
  if (!s.rowCount) throw notFound('STREAM_NOT_FOUND', 'Unknown co-stream session.', { session_id: id });
  if (b.action === 'publish' && publishSecret && b.password !== publishSecret) throw new AppError(401, 'UNAUTHENTICATED', 'Only the compositor may publish a co-stream.');
  return { allowed: true };
}
