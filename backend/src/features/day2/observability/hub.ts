import { randomUUID } from 'node:crypto';
import { pool } from '../../../core/db';
import { setGauge } from '../../../core/metrics';
import { getScore } from '../../events/service';
import { deliverWithRetry } from '../moderation/service';
import { ALL, BusEvent, subscribe } from './bus';

/**
 * Live fan-out hub (FR-5.2, NFR-1): WebSocket and SSE connections subscribe to topics; committed writes
 * reach them through the bus. One message per event is serialised once and written to every sink.
 */
export type Sink = (message: string) => void;

const sinks = new Map<string, Set<Sink>>();
let connections = 0;

/** Registers one connection on its topics; returns the detach function (idempotent). */
export function attach(topics: string[], sink: Sink): () => void {
  for (const t of topics) {
    let s = sinks.get(t);
    if (!s) sinks.set(t, (s = new Set()));
    s.add(sink);
  }
  setGauge('nascon_active_ws_connections', ++connections);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    for (const t of topics) {
      const s = sinks.get(t);
      s?.delete(sink);
      if (s && !s.size) sinks.delete(t);
    }
    setGauge('nascon_active_ws_connections', --connections);
  };
}

export const listeners = (topic: string) => sinks.get(topic)?.size ?? 0;

/** Writes to every sink of the topic; a dead sink is dropped by its own close handler, never by the writer. */
export function broadcast(topic: string, payload: object): number {
  const set = sinks.get(topic);
  if (!set?.size) return 0;
  const msg = JSON.stringify({ topic, ...payload });
  let n = 0;
  for (const s of set) {
    try {
      s(msg);
      n++;
    } catch {
      /* socket closing */
    }
  }
  return n;
}

/** Live score snapshot pushed on connect and after every committed match event. */
export async function scoreMessage(matchId: string) {
  const s = await getScore(pool, matchId);
  // the pinned merchandise overlay (FR-3.2) travels with the score, so re-pinning updates every viewer live
  const m = await pool.query('SELECT showcase FROM matches WHERE match_id=$1', [matchId]);
  return { type: 'score', match_id: matchId, score: s, showcase: m.rows[0]?.showcase ?? null };
}

subscribe(ALL, async (e: BusEvent, topic: string) => {
  if (!listeners(topic)) return;
  if (topic.startsWith('match:')) broadcast(topic, await scoreMessage(topic.slice(6)));
  else broadcast(topic, e);
});

export const DLQ_REASON_OFFLINE = 'subscriber_disconnected';

/**
 * Targeted notification (co-stream invite, order update) to a user's `user:{id}` topic. A subscriber that is
 * not connected gets bounded exponential retries (3 attempts, 100 ms / 200 ms) before the event is
 * dead-lettered (FR-5.2). Resolves to true when delivered.
 */
export async function notifyUser(userId: string, event: BusEvent, sleep?: (ms: number) => Promise<void>): Promise<boolean> {
  const topic = `user:${userId}`;
  const r = await deliverWithRetry(async () => broadcast(topic, event) > 0, sleep ? { sleep } : {});
  if (!r.delivered)
    await pool.query("INSERT INTO dlq_events(chat_room_id, event_id, attempts, status, reason) VALUES ($1,$2,$3,'dead',$4)", [
      topic, `${event.type}-${randomUUID()}`, r.attempts, DLQ_REASON_OFFLINE,
    ]);
  return r.delivered;
}
