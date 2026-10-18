import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
beforeAll(async () => {
  ctx = await boot('day2rt');
  for (const who of ['organizer', 'player', 'viewer']) tok[who] = (await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${who}@nascon.test`, password: PASSWORD })).body.token;
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

interface Client {
  ws: WebSocket;
  msgs: any[];
  next: (pred: (m: any) => boolean, ms?: number) => Promise<any>;
  closed: Promise<number>;
}
const open: WebSocket[] = [];
async function connect(path: string, headers: Record<string, string> = {}): Promise<Client> {
  const msgs: any[] = [];
  const waiters = new Set<() => void>();
  let closedResolve!: (c: number) => void;
  const closed = new Promise<number>((r) => (closedResolve = r));
  const ws = await (ctx.app as any).injectWS(path, { headers }, {
    onInit: (w: WebSocket) => {
      w.on('message', (d) => {
        msgs.push(JSON.parse(d.toString()));
        for (const f of [...waiters]) f();
      });
      w.on('close', (code) => closedResolve(code));
    },
  });
  open.push(ws);
  const next = (pred: (m: any) => boolean, ms = 2000) =>
    new Promise<any>((resolve, reject) => {
      const check = () => {
        const i = msgs.findIndex(pred);
        if (i < 0) return false;
        resolve(msgs.splice(i, 1)[0]);
        return true;
      };
      if (check()) return;
      const t = setTimeout(() => {
        waiters.delete(w);
        reject(new Error('timeout waiting for message; got ' + JSON.stringify(msgs)));
      }, ms);
      const w = () => {
        if (check()) {
          clearTimeout(t);
          waiters.delete(w);
        }
      };
      waiters.add(w);
    });
  return { ws, msgs, next, closed };
}
const closeAll = () => {
  for (const w of open.splice(0)) w.terminate();
};
const goal = (team = 'club-alpha-1') => call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id: 'match-m1', type: 'score', payload: { team_id: team, event_type: 'goal' } });
const metric = async (name: string) => Number(new RegExp(`^${name} (\\d+)$`, 'm').exec((await ctx.app.inject({ method: 'GET', url: '/metrics' })).body)![1]);
const until = async (f: () => Promise<boolean>, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

describe('WS /ws/matches/:id (live score banner)', () => {
  it('sends a snapshot on connect, then each committed score within 500 ms', async () => {
    const c = await connect('/ws/matches/match-m1');
    const snap = await c.next((m) => m.type === 'score');
    expect([snap.topic, snap.score.status, snap.score.home.score, snap.score.away.score]).toEqual(['match:match-m1', 'in_progress', 1, 0]);
    const t0 = Date.now();
    await goal();
    const upd = await c.next((m) => m.type === 'score', 500);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(upd.score.home.score).toBe(2);
    closeAll();
  });

  it('NFR-1: 25 concurrent clients all receive the update with p95 < 500 ms; gauge tracks connections', async () => {
    const before = await metric('nascon_active_ws_connections');
    const cs = await Promise.all(Array.from({ length: 25 }, () => connect('/ws/matches/match-m1')));
    await Promise.all(cs.map((c) => c.next((m) => m.type === 'score')));
    expect(await metric('nascon_active_ws_connections')).toBe(before + 25);
    const t0 = Date.now();
    await goal('club-alpha-2');
    const lat = await Promise.all(cs.map(async (c) => (await c.next((m) => m.type === 'score' && m.score.away.score === 1, 1000), Date.now() - t0)));
    lat.sort((a, b) => a - b);
    expect(lat[Math.ceil(0.95 * lat.length) - 1]).toBeLessThan(500);
    closeAll();
    expect(await until(async () => (await metric('nascon_active_ws_connections')) === before)).toBe(true);
  });

  it('404 before upgrade for an unknown match', async () => {
    await expect(connect('/ws/matches/match-nope')).rejects.toThrow(/404/);
  });
});

describe('WS /ws/chat/:room', () => {
  it('says hello with last_seq, then streams messages and moderation actions', async () => {
    const c = await connect('/ws/chat/chat-cs-session-101');
    expect(await c.next((m) => m.type === 'chat.hello')).toMatchObject({ chat_room_id: 'chat-cs-session-101', last_seq: 0 });
    await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: 'chat-cs-session-101', text: 'Great save!' }, bearer(tok.viewer));
    expect(await c.next((m) => m.type === 'chat.message', 500)).toMatchObject({ seq: 1, text: 'Great save!', sender: 'u-viewer' });
    await call(ctx.app, 'POST', '/api/v1/chat/chat-cs-session-101/moderation', { user_id: 'u-viewer', action: 'mute' }, bearer(tok.organizer));
    expect(await c.next((m) => m.type === 'chat.moderation', 500)).toMatchObject({ muted_users: ['u-viewer'] });
    closeAll();
  });
  it('400 before upgrade for a bad room id', async () => {
    await expect(connect('/ws/chat/bad%20room')).rejects.toThrow(/400/);
  });
});

const cs = (b: object) => call(ctx.app, 'POST', '/audit/v1/costream/session', b);
const inviteReq = (id: string, player: string, who = 'organizer') => call(ctx.app, 'POST', `/api/v1/costream/${id}/invites`, { player_id: player }, bearer(tok[who]));
const joinReq = (id: string, token: string, who = 'player') => call(ctx.app, 'POST', `/api/v1/costream/${id}/join`, { invite_token: token }, bearer(tok[who]));
const ctl = (id: string, action: string, player: string, who = 'organizer') => call(ctx.app, 'POST', `/api/v1/costream/${id}/control`, { action, player_id: player }, bearer(tok[who]));

describe('co-stream invites, join and host controls (FR-3.3)', () => {
  it('a signed invite is pushed live to the invitee and lets them join', async () => {
    await cs({ session_id: 'cs-session-j', host_player_id: 'player-alpha-2', participants: ['player-alpha-2'], layout: 'solo' });
    const n = await connect(`/ws/notifications?token=${tok.player}`);
    await n.next((m) => m.type === 'notifications.hello');
    const viewer = await connect('/ws/costream/cs-session-j');
    expect(await viewer.next((m) => m.type === 'costream.state')).toMatchObject({ session_id: 'cs-session-j', active_participants: ['player-alpha-2'] });
    const inv = await inviteReq('cs-session-j', 'player-alpha-1');
    expect([inv.status, inv.body.session_id, inv.body.player_id]).toEqual([201, 'cs-session-j', 'player-alpha-1']);
    expect((await n.next((m) => m.type === 'costream.invite', 1000)).invite_token).toBe(inv.body.invite_token);
    const j = await joinReq('cs-session-j', inv.body.invite_token);
    expect([j.status, j.body.active_participants, j.body.participant_count, j.body.layout, j.body.active_host]).toEqual([
      200, ['player-alpha-2', 'player-alpha-1'], 2, 'grid_2', 'player-alpha-2',
    ]);
    expect(await viewer.next((m) => m.type === 'costream.join', 500)).toMatchObject({ player_id: 'player-alpha-1', participant_count: 2 });
    expect((await joinReq('cs-session-j', inv.body.invite_token)).body.participant_count).toBe(2); // idempotent
    expect((await call(ctx.app, 'GET', '/audit/v1/qr/cs-session-j?inspect=true')).body.entity_status).toBe('active');
    closeAll();
  });

  it('an offline invitee is retried 3 times then dead-lettered (FR-5.2)', async () => {
    await cs({ session_id: 'cs-o', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'] });
    await inviteReq('cs-o', 'player-beta-1');
    expect(await until(async () => (await ctx.db.pool.query("SELECT 1 FROM dlq_events WHERE chat_room_id='user:player-beta-1'")).rowCount === 1, 3000)).toBe(true);
    const row = (await ctx.db.pool.query("SELECT attempts, reason, event_id FROM dlq_events WHERE chat_room_id='user:player-beta-1'")).rows[0];
    expect([row.attempts, row.reason]).toEqual([3, 'subscriber_disconnected']);
    expect(row.event_id).toMatch(/^costream\.invite-/);
    expect(await metric('nascon_dlq_depth')).toBe(1);
  });

  it('invite/join guards', async () => {
    await cs({ session_id: 'cs-g', host_player_id: 'player-alpha-2', participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2', 'player-alpha-1'] });
    expect((await inviteReq('cs-g', 'player-alpha-1', 'viewer')).status).toBe(403);
    expect((await inviteReq('cs-nope', 'player-alpha-1')).body.error.code).toBe('STREAM_NOT_FOUND');
    expect((await inviteReq('cs-g', 'player-nope')).body.error.code).toBe('PLAYER_NOT_FOUND');
    await cs({ session_id: 'cs-f', host_player_id: 'player-alpha-2', participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2', 'u-viewer'] });
    const full = await inviteReq('cs-f', 'player-alpha-1');
    expect([full.status, full.body.error.code]).toEqual([409, 'COSTREAM_SESSION_FULL']);
    await cs({ session_id: 'cs-t', host_player_id: 'player-alpha-2', participants: ['player-alpha-2'], simulate_host_drop: true });
    expect((await inviteReq('cs-t', 'player-alpha-1')).body.error.code).toBe('COSTREAM_TERMINATED');
    await cs({ session_id: 'cs-k', host_player_id: 'player-alpha-2', participants: ['player-alpha-2'] });
    const t = (await inviteReq('cs-k', 'player-beta-1')).body.invite_token;
    expect((await joinReq('cs-k', t)).status).toBe(403); // issued to someone else
    expect((await joinReq('cs-k', 'inv1.bad.token')).status).toBe(403);
    const mine = (await inviteReq('cs-k', 'player-alpha-1')).body.invite_token;
    expect((await joinReq('cs-j-other', mine)).status).toBe(403); // bound to its session
    expect((await joinReq('cs-k', mine, 'viewer')).status).toBe(403);
    expect((await call(ctx.app, 'POST', '/api/v1/costream/cs-k/join', { invite_token: mine })).status).toBe(401);
  });

  it('host controls: mute/unmute, spotlight, kick; only the active host or a moderator', async () => {
    await cs({ session_id: 'cs-c', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2', 'player-beta-1'] });
    expect((await ctl('cs-c', 'mute_audio', 'player-alpha-2', 'player')).body.controls).toEqual({ muted: ['player-alpha-2'], spotlight: null });
    expect((await ctl('cs-c', 'mute_audio', 'player-alpha-2', 'player')).body.controls.muted).toEqual(['player-alpha-2']);
    expect((await ctl('cs-c', 'unmute_audio', 'player-alpha-2', 'player')).body.controls.muted).toEqual([]);
    const sp = await ctl('cs-c', 'spotlight', 'player-beta-1', 'player');
    expect([sp.body.layout, sp.body.controls.spotlight]).toEqual(['spotlight', 'player-beta-1']);
    const k = await ctl('cs-c', 'kick', 'player-beta-1');
    expect([k.body.active_participants, k.body.participant_count, k.body.controls.spotlight]).toEqual([['player-alpha-1', 'player-alpha-2'], 2, null]);
    expect((await ctl('cs-c', 'kick', 'player-beta-1')).body.error.code).toBe('PLAYER_NOT_FOUND');
    expect((await ctl('cs-c', 'kick', 'player-alpha-1')).status).toBe(400);
    expect((await ctl('cs-c', 'mute_audio', 'player-alpha-2', 'viewer')).status).toBe(403);
    expect((await ctl('cs-c', 'explode', 'player-alpha-2')).status).toBe(400);
  });
});

describe('scenario 1: host handoff on a real WebSocket disconnect (FR-3.3, < 1.5 s)', () => {
  const S = { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'] };
  it('promotes participants[1], keeps chat_room_id and the composite, decrements the count', async () => {
    await cs(S);
    const viewer = await connect('/ws/costream/cs-session-101');
    await viewer.next((m) => m.type === 'costream.state');
    const host = await connect(`/ws/costream/cs-session-101?role=broadcaster&token=${tok.player}`);
    await host.next((m) => m.type === 'costream.state');
    const t0 = Date.now();
    host.ws.terminate();
    const h = await viewer.next((m) => m.type === 'costream.handoff', 1500);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(h).toMatchObject({
      dropped: 'player-alpha-1', active_host: 'player-alpha-2', handoff_occurred: true, participant_count: 3, status: 'active',
      chat_room_id: 'chat-cs-session-101', composite_playback_url: 'http://localhost:8888/costream/cs-session-101/index.m3u8',
      active_participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2'],
    });
    const row = (await ctx.db.pool.query("SELECT active_host, participant_count FROM costream_sessions WHERE session_id='cs-session-101'")).rows[0];
    expect(row).toEqual({ active_host: 'player-alpha-2', participant_count: 3 });
    closeAll();
  });

  it('a second socket of the same host (or a quick reconnect) prevents the handoff', async () => {
    await cs(S);
    const a = await connect(`/ws/costream/cs-session-101?role=broadcaster&token=${tok.player}`);
    const b = await connect(`/ws/costream/cs-session-101?role=broadcaster&token=${tok.player}`);
    await Promise.all([a.next((m) => m.type === 'costream.state'), b.next((m) => m.type === 'costream.state')]);
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 700));
    expect((await ctx.db.pool.query("SELECT active_host FROM costream_sessions WHERE session_id='cs-session-101'")).rows[0].active_host).toBe('player-alpha-1');
    closeAll();
  });

  it('the sole host leaving terminates the session; its QR follows', async () => {
    await cs({ session_id: 'cs-session-solo', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'], layout: 'solo' });
    const host = await connect(`/ws/costream/cs-session-solo?role=broadcaster&token=${tok.player}`);
    await host.next((m) => m.type === 'costream.state');
    host.ws.terminate();
    expect(await until(async () => (await call(ctx.app, 'GET', '/audit/v1/qr/cs-session-solo?inspect=true')).body.entity_status === 'terminated')).toBe(true);
  });

  it('a non-participant cannot register as broadcaster; a bad token is 401 before upgrade', async () => {
    await cs(S);
    const v = await connect(`/ws/costream/cs-session-101?role=broadcaster&token=${tok.viewer}`);
    expect(await v.next((m) => m.type === 'error')).toMatchObject({ code: 'FORBIDDEN' });
    expect(await v.closed).toBe(4403);
    await expect(connect('/ws/costream/cs-session-101?role=broadcaster&token=nope')).rejects.toThrow(/401/);
    await expect(connect('/ws/costream/cs-nope')).rejects.toThrow(/404/);
    await expect(connect('/ws/notifications')).rejects.toThrow(/401/);
  });
});

describe('order status transitions over WS (FR-5.2)', () => {
  it('pushes order.status when the queue job is consumed', async () => {
    const order_id = uniq('ord');
    const c = await connect(`/ws/orders/${order_id}`);
    await call(ctx.app, 'POST', '/audit/v1/checkout', {
      order_id, customer_id: 'c1', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], discount_code: null, payment: { token: 'tok_success' },
    });
    const { processQueueOnce } = await import('../../src/features/orders/service');
    await processQueueOnce();
    expect(await c.next((m) => m.type === 'order.status', 1000)).toMatchObject({ topic: `order:${order_id}`, order_id, from: 'Pending', to: 'Paid' });
    closeAll();
  });
});

describe('SSE streams', () => {
  let base = '';
  beforeAll(async () => {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  });
  const stream = (path: string) =>
    new Promise<{ res: http.IncomingMessage; frames: any[]; next: () => Promise<any> }>((resolve) => {
      const frames: any[] = [];
      let wake: (() => void) | null = null;
      const req = http.get(base + path, (res) => {
        let buf = '';
        res.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const f = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (f.startsWith('data: ')) frames.push(JSON.parse(f.slice(6)));
            wake?.();
          }
        });
        const next = async () => {
          while (!frames.length) await new Promise<void>((r) => (wake = r));
          return frames.shift();
        };
        resolve({ res, frames, next });
      });
      sseReqs.push(req);
    });
  const sseReqs: http.ClientRequest[] = [];

  it('GET /api/v1/matches/:id/stream: snapshot then live score frames', async () => {
    const s = await stream('/api/v1/matches/match-m1/stream');
    expect([s.res.statusCode, s.res.headers['content-type']]).toEqual([200, 'text/event-stream']);
    expect((await s.next()).score.home.score).toBe(1);
    await goal();
    expect((await s.next()).score.home.score).toBe(2);
    for (const r of sseReqs.splice(0)) r.destroy();
  });
  it('GET /api/v1/chat/:room/stream relays chat; unknown match is a JSON 404', async () => {
    const s = await stream('/api/v1/chat/chat-x/stream');
    expect((await s.next()).type).toBe('chat.hello');
    await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: 'chat-x', text: 'via sse' }, bearer(tok.viewer));
    expect((await s.next()).text).toBe('via sse');
    for (const r of sseReqs.splice(0)) r.destroy();
    const r = await call(ctx.app, 'GET', '/api/v1/matches/match-nope/stream');
    expect([r.status, r.body.error.code]).toEqual([404, 'MATCH_NOT_FOUND']);
  });
});
