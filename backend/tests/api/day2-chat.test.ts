import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
beforeAll(async () => {
  ctx = await boot('day2chat');
  for (const who of ['admin', 'organizer', 'manager', 'player', 'viewer']) {
    const r = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${who}@nascon.test`, password: PASSWORD });
    tok[who] = r.body.token;
  }
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await ctx.reset();
  const { setChatClock } = await import('../../src/features/day2/moderation/chat');
  setChatClock(() => Date.now());
});

const ROOM = 'chat-cs-session-101';
const post = (who: string, text: string, room = ROOM, extra: object = {}) => call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: room, text, ...extra }, bearer(tok[who]));
const mod = (who: string, user_id: string, action: string, room = ROOM) => call(ctx.app, 'POST', `/api/v1/chat/${room}/moderation`, { user_id, action }, bearer(tok[who]));
const list = (room = ROOM, qs = '', opts = {}) => call(ctx.app, 'GET', `/api/v1/chat/${room}/messages${qs}`, undefined, opts);

describe('POST /api/v1/chat (FR-3.3 unified room, FR-5.3 moderation)', () => {
  it('stores a clean message with the next room sequence and returns 201', async () => {
    const a = await post('viewer', 'Great save!', ROOM, { message_id: 'c-1' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ chat_room_id: ROOM, seq: 1, message_id: 'c-1', sender: 'u-viewer', text: 'Great save!', flagged: false, reason: null });
    expect(new Date(a.body.created_at).toISOString()).toBe(a.body.created_at);
    const b = await post('player', 'Thanks');
    expect([b.body.seq, typeof b.body.message_id]).toEqual([2, 'string']);
    expect((await post('viewer', 'other room', 'chat-other')).body.seq).toBe(1);
  });

  it('assigns gapless, unique, increasing seqs under concurrent writers', async () => {
    const users = ['admin', 'organizer', 'manager', 'player', 'viewer'];
    const rs = await Promise.all(users.flatMap((u) => [1, 2, 3].map((i) => post(u, `msg ${i}`))));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(rs.map((r) => r.body.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const l = await list();
    expect([l.body.last_seq, l.body.messages.length]).toEqual([15, 15]);
  });

  it('masks profanity, flags it and kicks the sender from the room', async () => {
    const r = await post('viewer', 'this is a sc@m ref');
    expect([r.status, r.body.text, r.body.flagged, r.body.reason]).toEqual([201, 'this is a *** ref', true, 'profanity_leetspeak']);
    const again = await post('viewer', 'sorry');
    expect([again.status, again.body.error.code, again.body.error.details.reason]).toEqual([403, 'FORBIDDEN', 'kicked']);
    expect((await post('viewer', 'elsewhere', 'chat-other')).status).toBe(201); // per room
  });

  it('rejects a flood with 429 RATE_LIMITED and mutes the sender', async () => {
    const r = await post('viewer', 'GOAL! AAAA!!!');
    expect([r.status, r.body.error.code, r.body.error.details.reason, r.headers['retry-after']]).toEqual([429, 'RATE_LIMITED', 'flood_character_repeat', '2']);
    const again = await post('viewer', 'calm now');
    expect([again.status, again.body.error.details.reason]).toEqual([403, 'muted']);
    expect((await list()).body.messages).toEqual([]);
  });

  it('rate limits the 4th message inside 2 s, per sender, and mutes', async () => {
    const { setChatClock } = await import('../../src/features/day2/moderation/chat');
    let t = 1_000_000;
    setChatClock(() => t);
    for (let i = 0; i < 3; i++) expect((await post('viewer', `m${i}`)).status).toBe(201);
    expect((await post('player', 'unaffected')).status).toBe(201);
    t += 1999;
    const r = await post('viewer', 'm4');
    expect([r.status, r.body.error.code, r.body.error.details.reason]).toEqual([429, 'RATE_LIMITED', 'rate_limit_exceeded']);
    // a sender whose window has slid past is fine
    for (let i = 0; i < 3; i++) expect((await post('manager', `n${i}`)).status).toBe(201);
    t += 2000;
    expect((await post('manager', 'n4')).status).toBe(201);
  });

  it('honours kicks made through the audit moderation probe', async () => {
    await call(ctx.app, 'POST', '/audit/v1/moderation/test', { chat_room_id: ROOM, incoming_messages: [{ message_id: 'x', sender: 'u-viewer', text: 'p0rn' }] });
    expect((await post('viewer', 'hello')).status).toBe(403);
  });

  it('401 without a token, 403 GUEST_WRITE_FORBIDDEN for a guest, 400 on bad bodies', async () => {
    expect((await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: ROOM, text: 'x' })).status).toBe(401);
    const g = await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: ROOM, text: 'x' }, bearer('guest_anon_tok_7721'));
    expect([g.status, g.body.error.code]).toEqual([403, 'GUEST_WRITE_FORBIDDEN']);
    for (const b of [{}, { chat_room_id: ROOM, text: '' }, { chat_room_id: 'bad room', text: 'x' }, { chat_room_id: ROOM, text: 'x'.repeat(501) }]) {
      const r = await call(ctx.app, 'POST', '/api/v1/chat', b, bearer(tok.viewer));
      expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
  });

  it('publishes each stored message on the bus after commit', async () => {
    const { subscribe } = await import('../../src/features/day2/observability/bus');
    const got: any[] = [];
    const off = subscribe(`chat:${ROOM}`, (e) => got.push(e));
    await post('viewer', 'live');
    off();
    expect(got).toEqual([expect.objectContaining({ type: 'chat.message', chat_room_id: ROOM, seq: 1, text: 'live' })]);
  });
});

describe('GET /api/v1/chat/{room}/messages (public read)', () => {
  it('pages by after_seq and is readable by guests and anonymous viewers', async () => {
    for (const t of ['a', 'b', 'c']) await post('viewer', t);
    const all = await list(ROOM, '', bearer('guest_anon_tok_7721'));
    expect([all.status, all.body.last_seq, all.body.messages.map((m: any) => m.text)]).toEqual([200, 3, ['a', 'b', 'c']]);
    const page = await list(ROOM, '?after_seq=1&limit=1');
    expect(page.body.messages.map((m: any) => [m.seq, m.text])).toEqual([[2, 'b']]);
    expect((await list('chat-empty')).body).toEqual({ chat_room_id: 'chat-empty', last_seq: 0, messages: [] });
  });
  it('400 on bad paging or room ids', async () => {
    expect((await list(ROOM, '?after_seq=-1')).status).toBe(400);
    expect((await list(ROOM, '?limit=500')).status).toBe(400);
    expect((await list('bad%20room')).status).toBe(400);
  });
});

describe('POST /api/v1/chat/{room}/moderation (host / moderator controls)', () => {
  it('lets a platform moderator mute, unmute, kick and unkick; lists are room-wide', async () => {
    const m = await mod('organizer', 'u-viewer', 'mute');
    expect([m.status, m.body]).toEqual([200, { chat_room_id: ROOM, user_id: 'u-viewer', action: 'mute', muted_users: ['u-viewer'], kicked_users: [] }]);
    expect((await post('viewer', 'hi')).status).toBe(403);
    expect((await mod('admin', 'u-viewer', 'unmute')).body.muted_users).toEqual([]);
    expect((await post('viewer', 'hi')).status).toBe(201);
    expect((await mod('manager', 'u-player', 'kick')).body.kicked_users).toEqual(['u-player']);
    expect((await mod('manager', 'u-player', 'unkick')).body.kicked_users).toEqual([]);
  });

  it('10 concurrent moderators muting the same user resolve idempotently (scenario 3)', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => mod(i % 2 ? 'admin' : 'organizer', 'user-spammer', 'mute')));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    for (const r of rs) expect(r.body.muted_users).toEqual(['user-spammer']);
  });

  it('only moderators or the co-stream host may moderate', async () => {
    const r = await mod('viewer', 'u-player', 'mute');
    expect([r.status, r.body.error.code]).toEqual([403, 'FORBIDDEN']);
    expect((await mod('player', 'u-viewer', 'mute')).status).toBe(403);
    await ctx.db.pool.query(
      `INSERT INTO costream_sessions(session_id, host_player_id, participants, layout, status, active_host, participant_count, active_participants, request_hash, response)
       VALUES ('cs-host-1', 'player-alpha-1', '["player-alpha-1"]', 'solo', 'active', 'player-alpha-1', 1, '["player-alpha-1"]', 'h', '{}')`,
    );
    expect((await mod('player', 'u-viewer', 'mute', 'chat-cs-host-1')).status).toBe(200);
    expect((await mod('player', 'u-viewer', 'mute', 'other-room')).status).toBe(403);
  });

  it('401 / 400 / guest 403', async () => {
    expect((await call(ctx.app, 'POST', `/api/v1/chat/${ROOM}/moderation`, { user_id: 'x', action: 'mute' })).status).toBe(401);
    expect((await call(ctx.app, 'POST', `/api/v1/chat/${ROOM}/moderation`, { user_id: 'x', action: 'ban' }, bearer(tok.admin))).status).toBe(400);
    expect((await call(ctx.app, 'POST', `/api/v1/chat/bad%20room/moderation`, { user_id: 'x', action: 'mute' }, bearer(tok.admin))).status).toBe(400);
    expect((await call(ctx.app, 'POST', `/api/v1/chat/${ROOM}/moderation`, { user_id: 'x', action: 'mute' }, bearer('guest_anon_tok_7721'))).status).toBe(403);
  });
});
