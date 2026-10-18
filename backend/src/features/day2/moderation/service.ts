import { z } from 'zod';
import { tx } from '../../../core/db';
import { parse } from '../../../core/validate';
import { sign2 } from '../common';
import { classify } from './normalize';

const text = (max: number) => z.string().min(1).max(max);

const probeSchema = z.object({
  chat_room_id: text(128),
  incoming_messages: z.array(z.object({ message_id: text(128), sender: text(128), text: z.string().max(4000) })).max(500),
  check_dlq: z.boolean().optional(),
  simulate_failed_notifications: z.number().int().min(0).max(1000).optional(),
});

export interface IncomingMessage {
  message_id: string;
  sender: string;
  text: string;
}
export interface FilteredMessage extends IncomingMessage {
  flagged: boolean;
  reason: 'profanity_leetspeak' | null;
}

/** More than this many messages from one sender inside the sliding window are rate limited (FR-5.3). */
export const RATE_LIMIT_MAX = 3;

/**
 * Applies the spec 5.8 rules to one batch. A probe batch is a single instant, so the 2 s sliding window
 * is the batch itself: a sender's 4th+ message in the batch is rate limited.
 * Flooded and rate-limited messages are dropped (never broadcast) and mute the sender (spec 5.8 rule 3);
 * profanity is masked in place and kicks the sender. Both user lists keep first-violation order, no duplicates.
 */
export function evaluateBatch(messages: IncomingMessage[]) {
  const filtered: FilteredMessage[] = [];
  const kicked = new Set<string>();
  const muted = new Set<string>();
  const sent = new Map<string, number>();
  for (const m of messages) {
    const n = (sent.get(m.sender) ?? 0) + 1;
    sent.set(m.sender, n);
    if (n > RATE_LIMIT_MAX) {
      muted.add(m.sender);
      continue;
    }
    const v = classify(m.text);
    if (v.kind === 'flood') {
      muted.add(m.sender);
      continue;
    }
    const base = { message_id: m.message_id, sender: m.sender };
    if (v.kind === 'profanity') {
      kicked.add(m.sender);
      filtered.push({ ...base, text: v.text, flagged: true, reason: 'profanity_leetspeak' });
    } else filtered.push({ ...base, text: m.text, flagged: false, reason: null });
  }
  return { filtered, kicked: [...kicked], muted: [...muted], flaggedCount: filtered.filter((f) => f.flagged).length };
}

export interface DeliveryResult {
  delivered: boolean;
  attempts: number;
  /** backoff waited before each retry, in ms */
  backoff: number[];
}

/**
 * Bounded exponential retry (FR-5.2): at most `maxAttempts` tries, waiting base * 2^(n-1) between them.
 * `sleep` is injected: the live bus sleeps for real, the synchronous probe passes a no-op (virtual backoff).
 */
export async function deliverWithRetry(
  send: () => Promise<boolean>,
  { maxAttempts = 3, baseDelayMs = 100, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<DeliveryResult> {
  const backoff: number[] = [];
  for (let attempt = 1; ; attempt++) {
    const ok = await send().catch(() => false);
    if (ok) return { delivered: true, attempts: attempt, backoff };
    if (attempt >= maxAttempts) return { delivered: false, attempts: attempt, backoff };
    const wait = baseDelayMs * 2 ** (attempt - 1);
    backoff.push(wait);
    await sleep(wait);
  }
}

export interface DlqEvent {
  event_id: string;
  attempts: number;
  reason: string;
}
interface DlqState {
  depth: number;
  events: DlqEvent[];
}

/**
 * Per-room DLQ snapshot so the k6 chat path (clean messages, no simulated failures) never touches the DB.
 * Only this process writes dlq_events, the snapshot is refreshed inside every write transaction, and
 * /audit/v1/reset clears it. `generation` stops a transaction that started before a reset from repopulating it.
 */
const dlqCache = new Map<string, DlqState>();
let generation = 0;

export function clearModerationCache() {
  dlqCache.clear();
  generation++;
}

const SIMULATED_FAILURE = 'simulated_delivery_failure';

export async function moderationProbe(rawBody: unknown) {
  const body = parse(probeSchema, rawBody);
  const room = body.chat_room_id;
  const failures = body.simulate_failed_notifications ?? 0;
  const { filtered, kicked, muted, flaggedCount } = evaluateBatch(body.incoming_messages);

  let dlq = dlqCache.get(room);
  if (!dlq || failures > 0 || kicked.length || muted.length || body.check_dlq) {
    const gen = generation;
    const fresh = await tx(async (c) => {
      // One lock per room serialises concurrent moderators (spec 8 scenario 3): no deadlocks, exact DLQ counts.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['moderation:' + room]);
      const actions = [...kicked.map((u) => [u, 'kicked']), ...muted.map((u) => [u, 'muted'])].sort((a, b) => (a.join() < b.join() ? -1 : 1));
      if (actions.length)
        await c.query(
          `INSERT INTO moderation_state(chat_room_id, user_id, kind)
           SELECT $1, a.user_id, a.kind FROM unnest($2::text[], $3::text[]) AS a(user_id, kind)
           ON CONFLICT DO NOTHING`,
          [room, actions.map((a) => a[0]), actions.map((a) => a[1])],
        );
      if (failures > 0) {
        const { rows } = await c.query('SELECT count(*)::int AS n FROM dlq_events WHERE chat_room_id=$1', [room]);
        const ids: string[] = [];
        const attempts: number[] = [];
        for (let i = 1; i <= failures; i++) {
          // the simulated downstream always fails: 3 bounded attempts with virtual backoff, then dead-lettered
          const r = await deliverWithRetry(async () => false, { sleep: async () => undefined });
          ids.push(`notif-${rows[0].n + i}`);
          attempts.push(r.attempts);
        }
        await c.query(
          `INSERT INTO dlq_events(chat_room_id, event_id, attempts, status, reason)
           SELECT $1, e.id, e.n, 'dead', $4 FROM unnest($2::text[], $3::int[]) AS e(id, n)`,
          [room, ids, attempts, SIMULATED_FAILURE],
        );
      }
      const r = await c.query('SELECT event_id, attempts, reason FROM dlq_events WHERE chat_room_id=$1 ORDER BY id', [room]);
      return { depth: r.rowCount ?? 0, events: r.rows as DlqEvent[] };
    });
    const cached = dlqCache.get(room);
    if (gen === generation && (!cached || fresh.depth >= cached.depth)) dlqCache.set(room, fresh);
    dlq = fresh;
  }

  const signature = sign2(room, { chat_room_id: room, flagged_count: flaggedCount, kicked_users: kicked, queue_depth: dlq.depth });
  return {
    chat_room_id: room,
    filtered_messages: filtered,
    kicked_users: kicked,
    muted_users: muted,
    dlq_status: { queue_depth: dlq.depth, undelivered_events: dlq.events },
    signature,
  };
}
