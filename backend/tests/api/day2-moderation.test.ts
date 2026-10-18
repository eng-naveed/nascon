import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, call, Ctx, SALT2 } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2mod');
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const ROOM = 'chat-cs-session-101';
const probe = (body: unknown, headers: Record<string, string> = {}) => call(ctx.app, 'POST', '/audit/v1/moderation/test', body, { headers });
const spec = {
  chat_room_id: ROOM,
  incoming_messages: [
    { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
    { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
    { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
  ],
  check_dlq: true,
  simulate_failed_notifications: 0,
};
const sig = (room: string, flagged: number, kicked: string[], depth: number) =>
  ctx.crypto.sign(SALT2, room, { chat_room_id: room, flagged_count: flagged, kicked_users: kicked, queue_depth: depth });

describe('POST /audit/v1/moderation/test (spec 5.8)', () => {
  it('returns the spec example body exactly, signed with DAY2_SALT', async () => {
    const r = await probe(spec);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      chat_room_id: ROOM,
      filtered_messages: [
        { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary', flagged: false, reason: null },
        { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream *** now!', flagged: true, reason: 'profanity_leetspeak' },
      ],
      kicked_users: ['user-spammer'],
      muted_users: ['user-flooder'],
      dlq_status: { queue_depth: 0, undelivered_events: [] },
      signature: sig(ROOM, 1, ['user-spammer'], 0),
    });
    expect(Object.keys(r.body)).toEqual(['chat_room_id', 'filtered_messages', 'kicked_users', 'muted_users', 'dlq_status', 'signature']);
  });

  it('persists kick/mute state idempotently', async () => {
    await probe(spec);
    await probe(spec);
    const r = await ctx.db.pool.query('SELECT user_id, kind FROM moderation_state WHERE chat_room_id=$1 ORDER BY user_id, kind', [ROOM]);
    expect(r.rows).toEqual([
      { user_id: 'user-flooder', kind: 'muted' },
      { user_id: 'user-spammer', kind: 'kicked' },
    ]);
  });

  it('dead-letters simulated failures after 3 attempts and reports the room depth', async () => {
    const a = await probe({ ...spec, incoming_messages: [], simulate_failed_notifications: 2 });
    expect(a.body.dlq_status).toEqual({
      queue_depth: 2,
      undelivered_events: [
        { event_id: 'notif-1', attempts: 3, reason: 'simulated_delivery_failure' },
        { event_id: 'notif-2', attempts: 3, reason: 'simulated_delivery_failure' },
      ],
    });
    expect(a.body.signature).toBe(sig(ROOM, 0, [], 2));
    // cached path (k6 shape): no failures, check_dlq false
    const b = await probe({ chat_room_id: ROOM, incoming_messages: [{ message_id: 'k6-1-0', sender: 'user-1', text: 'Live reaction' }], check_dlq: false });
    expect([b.status, b.body.dlq_status.queue_depth, b.body.signature]).toEqual([200, 2, sig(ROOM, 0, [], 2)]);
    // another room has its own queue
    const c = await probe({ chat_room_id: 'chat-other', incoming_messages: [] });
    expect(c.body.dlq_status).toEqual({ queue_depth: 0, undelivered_events: [] });
    // /metrics depth is global
    expect((await ctx.app.inject({ method: 'GET', url: '/metrics' })).body).toMatch(/^nascon_dlq_depth 2$/m);
  });

  it('reset empties the DLQ, including the in-memory snapshot', async () => {
    await probe({ ...spec, simulate_failed_notifications: 3 });
    await ctx.reset();
    const r = await probe({ chat_room_id: ROOM, incoming_messages: [], check_dlq: false });
    expect(r.body.dlq_status.queue_depth).toBe(0);
  });

  it('check_dlq true re-reads the persistent queue', async () => {
    await probe({ chat_room_id: ROOM, incoming_messages: [], check_dlq: false });
    await ctx.db.pool.query("INSERT INTO dlq_events(chat_room_id, event_id, attempts, reason) VALUES ($1, 'ext-1', 3, 'webhook_down')", [ROOM]);
    const r = await probe({ chat_room_id: ROOM, incoming_messages: [], check_dlq: true });
    expect(r.body.dlq_status).toEqual({ queue_depth: 1, undelivered_events: [{ event_id: 'ext-1', attempts: 3, reason: 'webhook_down' }] });
  });

  it('scenario 3: 10 simultaneous moderators on user-spammer resolve idempotently with exact DLQ counts', async () => {
    const body = { ...spec, simulate_failed_notifications: 1 };
    const rs = await Promise.all(Array.from({ length: 10 }, () => probe(body)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    for (const r of rs) expect(r.body.kicked_users).toEqual(['user-spammer']);
    expect(rs.map((r) => r.body.dlq_status.queue_depth).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const r of rs) expect(r.body.signature).toBe(sig(ROOM, 1, ['user-spammer'], r.body.dlq_status.queue_depth));
    const st = await ctx.db.pool.query("SELECT count(*)::int AS n FROM moderation_state WHERE user_id='user-spammer'");
    expect(st.rows[0].n).toBe(1);
    const d = await probe({ chat_room_id: ROOM, incoming_messages: [], check_dlq: false });
    expect(d.body.dlq_status.queue_depth).toBe(10);
  });

  it('never 404s for an unknown room and accepts an empty batch', async () => {
    const r = await probe({ chat_room_id: 'chat-nowhere', incoming_messages: [] });
    expect([r.status, r.body.filtered_messages, r.body.kicked_users, r.body.muted_users]).toEqual([200, [], [], []]);
  });

  it.each([
    [{}, 'chat_room_id'],
    [{ chat_room_id: ROOM }, 'incoming_messages'],
    [{ chat_room_id: ROOM, incoming_messages: [{ message_id: 'm', sender: '', text: 'x' }] }, 'incoming_messages'],
    [{ chat_room_id: ROOM, incoming_messages: [], simulate_failed_notifications: -1 }, 'simulate_failed_notifications'],
    [{ chat_room_id: ROOM, incoming_messages: [], check_dlq: 'yes' }, 'check_dlq'],
  ])('400 VALIDATION_ERROR for %j', async (body, field) => {
    const r = await probe(body);
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(r.body.error.details.fields).toContain(field);
  });

  it('a guest token cannot call it (write boundary)', async () => {
    const r = await probe(spec, { authorization: 'Bearer guest_anon_tok_7721' });
    expect([r.status, r.body.error.code]).toEqual([403, 'GUEST_WRITE_FORBIDDEN']);
  });
});
