import { z } from 'zod';
import { pool, tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { bodyHash } from '../../core/crypto';
import { idSchema, parse } from '../../core/validate';
import { appendEvent, loadEvents } from '../events/service';
import { rosterVersion, transfer } from '../roster/service';

const envelope = z.object({
  device_id: z.string().min(1).max(100),
  actions: z
    .array(
      z.object({
        action_id: z.string().min(1).max(100),
        type: z.enum(['score_event', 'roster_transfer']),
        queued_at: z.string().min(1).max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'bad ts'),
        base_version: z.number().int().min(0),
        payload: z.record(z.string(), z.any()),
      }),
    )
    .min(1)
    .max(100),
});

interface Result {
  action_id: string;
  status: 'applied' | 'rejected' | 'duplicate';
  resolution: string;
  error_code: string | null;
  processed_order: number;
  server_version: number;
  signature: string | null;
}

async function currentVersion(type: string, payload: any): Promise<number | null> {
  if (type === 'score_event') {
    const m = await pool.query('SELECT 1 FROM matches WHERE match_id=$1', [String(payload.match_id)]);
    if (!m.rowCount) return payload.type === 'match_init' ? 0 : null; // a match_init creates the stream
    return (await loadEvents(pool, String(payload.match_id))).length;
  }
  const p = await pool.query('SELECT 1 FROM roster_players WHERE player_id=$1', [String(payload.player_id)]);
  if (!p.rowCount) return null;
  return rosterVersion(pool, String(payload.player_id));
}

export async function offlineSync(rawBody: unknown) {
  const body = parse(envelope, rawBody);
  const order = body.actions.map((a, i) => ({ a, i })).sort((x, y) => Date.parse(x.a.queued_at) - Date.parse(y.a.queued_at) || x.i - y.i);
  const results = new Map<number, Result>();
  let n = 0;
  for (const { a, i } of order) {
    n++;
    const done = await pool.query('SELECT 1 FROM sync_actions WHERE device_id=$1 AND action_id=$2', [body.device_id, a.action_id]);
    const base = { action_id: a.action_id, processed_order: n };
    const ver = async () => (await currentVersion(a.type, a.payload)) ?? 0;
    if (done.rowCount) {
      results.set(i, { ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await ver(), signature: null });
      continue;
    }
    let res: Result;
    try {
      if (a.type === 'score_event' && a.payload.event_id) {
        const same = await pool.query('SELECT body_hash FROM events WHERE event_id=$1', [String(a.payload.event_id)]);
        const h = bodyHash({ match_id: a.payload.match_id, type: a.payload.type, payload: a.payload.payload ?? {} });
        if (same.rowCount && same.rows[0].body_hash === h) {
          results.set(i, { ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await ver(), signature: null });
          await pool.query('INSERT INTO sync_actions VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [body.device_id, a.action_id, JSON.stringify({ duplicate: true })]);
          continue;
        }
      }
      // Validate the payload shape first (400 before 404 before 409), then ids, then base_version.
      const pl = a.payload as any;
      const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
      if (a.type === 'score_event') {
        if (!isStr(pl.event_id) || !isStr(pl.match_id) || !isStr(pl.type)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid action payload.', { fields: ['payload'] });
      } else {
        if (!isStr(pl.request_id) || !isStr(pl.league_id) || !isStr(pl.player_id) || !isStr(pl.type) || !isStr(pl.from_squad_id))
          throw new AppError(400, 'VALIDATION_ERROR', 'Invalid action payload.', { fields: ['payload'] });
        const seenReq = await pool.query('SELECT 1 FROM roster_requests WHERE request_id=$1', [pl.request_id]);
        if (seenReq.rowCount) {
          results.set(i, { ...base, status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await ver(), signature: null });
          await pool.query('INSERT INTO sync_actions VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [body.device_id, a.action_id, JSON.stringify({ duplicate: true })]);
          continue;
        }
        const lg = await pool.query('SELECT 1 FROM roster_leagues WHERE league_id=$1', [pl.league_id]);
        if (!lg.rowCount) throw new AppError(404, 'LEAGUE_NOT_FOUND', 'League not found.');
      }
      const cur = await currentVersion(a.type, a.payload);
      if (cur === null) {
        const id = a.type === 'score_event' ? 'MATCH_NOT_FOUND' : 'PLAYER_NOT_FOUND';
        throw new AppError(404, id, 'Referenced id not found.');
      }
      if (a.base_version > cur) throw new AppError(409, 'INVALID_BASE_VERSION', 'The device version is ahead of the server.');
      const r = await tx((c) => (a.type === 'score_event' ? appendEvent(c, a.payload) : transfer(c, a.payload)));
      res = {
        ...base, status: 'applied', resolution: a.base_version < cur ? 'rebased_append' : 'appended', error_code: null,
        server_version: await ver(), signature: a.type === 'score_event' ? (r.body.signature as string) : null,
      };
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      res = { ...base, status: 'rejected', resolution: 'server_wins', error_code: e.code, server_version: await ver(), signature: null };
    }
    await pool.query('INSERT INTO sync_actions VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [body.device_id, a.action_id, JSON.stringify(res)]);
    results.set(i, res);
  }
  const list = body.actions.map((_, i) => results.get(i)!);
  const summary = { applied: 0, rejected: 0, duplicate: 0 };
  for (const r of list) summary[r.status]++;
  return { device_id: body.device_id, results: list, summary };
}
void idSchema;
