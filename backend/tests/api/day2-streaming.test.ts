import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, call, Ctx, SALT2 } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2stream');
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const key = (b: unknown) => call(ctx.app, 'POST', '/audit/v1/stream/key', b);
const auth = (action: string, path: string, extra: object = {}) => call(ctx.app, 'POST', '/internal/media/auth', { action, path, user: '', password: '', ...extra });
const ksig = (k: string, action: string, player: string, status: string) => ctx.crypto.sign(SALT2, k, { action, player_id: player, status, stream_key: k });
const VEC = { action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' };
const status = async (k: string) => (await ctx.db.pool.query('SELECT status FROM stream_keys WHERE stream_key=$1', [k])).rows[0]?.status;

describe('POST /audit/v1/stream/key (spec 5.4)', () => {
  it('reproduces the spec rotate example with the 4-key signature', async () => {
    const r = await key(VEC);
    const k = 'sk_live_9f83a1b2c3d4e5f6';
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key: k, status: 'active',
      ingest_endpoints: { rtmp: `rtmp://localhost:1935/live/${k}`, webrtc: `http://localhost:8889/live/${k}/whip` },
      playback_url: `http://localhost:8888/live/${k}/index.m3u8`,
      signature: ksig(k, 'rotate', 'player-alpha-1', 'active'),
    });
    expect(Object.keys(r.body)).toEqual(['player_id', 'label', 'stream_key', 'status', 'ingest_endpoints', 'playback_url', 'signature']);
  });

  it('generate is 201 with a fresh sk_live_ key and default label; a second generate invalidates the first', async () => {
    const a = await key({ action: 'generate', player_id: 'player-alpha-1' });
    expect([a.status, a.body.label, a.body.status]).toEqual([201, 'default', 'active']);
    expect(a.body.stream_key).toMatch(/^sk_live_[a-f0-9]{16}$/);
    expect(a.body.signature).toBe(ksig(a.body.stream_key, 'generate', 'player-alpha-1', 'active'));
    const b = await key({ action: 'generate', player_id: 'player-alpha-1' });
    expect(b.body.stream_key).not.toBe(a.body.stream_key);
    expect([await status(a.body.stream_key), await status(b.body.stream_key)]).toEqual(['rotated', 'active']);
  });

  it('rotate with no prior key still issues one (200)', async () => {
    const r = await key({ action: 'rotate', player_id: 'player-beta-2' });
    expect([r.status, r.body.status]).toEqual([200, 'active']);
  });

  it('revoke returns 200 revoked with null endpoints; a repeat is idempotent', async () => {
    await key(VEC);
    const r = await key({ action: 'revoke', player_id: 'player-alpha-1' });
    const k = 'sk_live_9f83a1b2c3d4e5f6';
    expect([r.status, r.body]).toEqual([200, {
      player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key: k, status: 'revoked', ingest_endpoints: null, playback_url: null,
      signature: ksig(k, 'revoke', 'player-alpha-1', 'revoked'),
    }]);
    const again = await key({ action: 'revoke', player_id: 'player-alpha-1' });
    expect([again.status, again.raw]).toEqual([200, r.raw]);
  });

  it('revoke without any key is 404 STREAM_NOT_FOUND; a foreign override is 404 too', async () => {
    const r = await key({ action: 'revoke', player_id: 'player-beta-2' });
    expect([r.status, r.body.error.code]).toEqual([404, 'STREAM_NOT_FOUND']);
    await key({ ...VEC, player_id: 'player-alpha-2' });
    const f = await key({ action: 'revoke', player_id: 'player-alpha-1', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' });
    expect([f.status, f.body.error.code]).toEqual([404, 'STREAM_NOT_FOUND']);
  });

  it('a re-used override never 500s: same player refreshes it, another player takes it over', async () => {
    expect((await key({ ...VEC, action: 'generate' })).status).toBe(201);
    expect((await key({ ...VEC, action: 'generate' })).status).toBe(201);
    const other = await key({ ...VEC, player_id: 'player-beta-1' });
    expect([other.status, other.body.player_id]).toEqual([200, 'player-beta-1']);
    const r = await ctx.db.pool.query("SELECT player_id, status FROM stream_keys WHERE stream_key='sk_live_9f83a1b2c3d4e5f6'");
    expect(r.rows).toEqual([{ player_id: 'player-beta-1', status: 'active' }]);
  });

  it('10 concurrent rotates leave exactly one active key', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => key({ action: 'rotate', player_id: 'player-alpha-1' })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const n = await ctx.db.pool.query("SELECT count(*)::int AS n FROM stream_keys WHERE player_id='player-alpha-1' AND status='active'");
    expect(n.rows[0].n).toBe(1);
    expect((await ctx.app.inject({ method: 'GET', url: '/metrics' })).body).toMatch(/^nascon_active_streams_total 1$/m);
  });

  it('publishes stream.revoked on the bus after commit for every severed key', async () => {
    const { subscribe } = await import('../../src/features/day2/observability/bus');
    const a = await key({ action: 'generate', player_id: 'player-alpha-1' });
    const got: any[] = [];
    const off = subscribe(`stream:${a.body.stream_key}`, (e) => got.push(e));
    await key({ action: 'rotate', player_id: 'player-alpha-1' });
    off();
    expect(got).toEqual([{ type: 'stream.revoked', stream_key: a.body.stream_key }]);
  });

  it.each([
    [{ action: 'pause', player_id: 'player-alpha-1' }, 'action'],
    [{ player_id: 'player-alpha-1' }, 'action'],
    [{ action: 'generate' }, 'player_id'],
    [{ action: 'generate', player_id: 'player-alpha-1', label: '' }, 'label'],
    [{ action: 'generate', player_id: 'player-alpha-1', label: 'x'.repeat(65) }, 'label'],
    [{ action: 'generate', player_id: 'player-alpha-1', stream_key_override: 'a/b' }, 'stream_key_override'],
  ])('400 VALIDATION_ERROR (%#)', async (b, field) => {
    const r = await key(b);
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(r.body.error.details.fields).toContain(field);
  });

  it('404 PLAYER_NOT_FOUND', async () => {
    const r = await key({ action: 'generate', player_id: 'player-nope' });
    expect([r.status, r.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
  });
});

describe('POST /internal/media/auth (MediaMTX callback)', () => {
  it('allows an active key and refuses revoked or rotated keys with 409 KEY_REVOKED', async () => {
    const a = (await key({ action: 'generate', player_id: 'player-alpha-1' })).body.stream_key;
    expect((await auth('publish', `live/${a}`)).status).toBe(200);
    expect((await auth('read', `live/${a}`)).status).toBe(200);
    const b = (await key({ action: 'rotate', player_id: 'player-alpha-1' })).body.stream_key;
    const old = await auth('publish', `live/${a}`);
    expect([old.status, old.body.error.code]).toEqual([409, 'KEY_REVOKED']);
    await key({ action: 'revoke', player_id: 'player-alpha-1' });
    for (const action of ['publish', 'read', 'playback']) expect((await auth(action, `live/${b}`)).body.error.code).toBe('KEY_REVOKED');
  });
  it('404 for unknown keys or sessions, 401 for other paths/actions', async () => {
    expect((await auth('publish', 'live/sk_live_0000000000000000')).status).toBe(404);
    expect((await auth('read', 'costream/cs-nope')).status).toBe(404);
    expect((await auth('publish', 'other/x')).status).toBe(401);
    expect((await auth('api', 'live/x')).status).toBe(401);
    expect((await call(ctx.app, 'POST', '/internal/media/auth', {})).status).toBe(400);
  });
  it('co-stream composites: readable once the session exists; publishing needs the compositor secret when set', async () => {
    await call(ctx.app, 'POST', '/audit/v1/costream/session', { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2'] });
    expect((await auth('read', 'costream/cs-session-101')).status).toBe(200);
    expect((await auth('publish', 'costream/cs-session-101')).status).toBe(200);
    const { mediaAuth } = await import('../../src/features/day2/streaming/service');
    await expect(mediaAuth({ action: 'publish', path: 'costream/cs-session-101', password: 'wrong' }, 's3cret')).rejects.toMatchObject({ status: 401 });
    await expect(mediaAuth({ action: 'publish', path: 'costream/cs-session-101', password: 's3cret' }, 's3cret')).resolves.toEqual({ allowed: true });
  });
});

const cs = (b: unknown) => call(ctx.app, 'POST', '/audit/v1/costream/session', b);
const FOUR = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
const SPEC_CS = { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: FOUR, layout: 'grid_4', simulate_host_drop: true };
const csSig = (id: string, host: string | null, handoff: boolean, layout: string, count: number, st: string) =>
  ctx.crypto.sign(SALT2, id, { active_host: host, handoff_occurred: handoff, layout, participant_count: count, session_id: id, status: st });

describe('POST /audit/v1/costream/session (spec 5.5, scenario 1)', () => {
  it('reproduces the spec host-drop example (201) and replays byte-identically (200)', async () => {
    const r = await cs(SPEC_CS);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      session_id: 'cs-session-101', status: 'active', active_host: 'player-alpha-2', handoff_occurred: true, participant_count: 3,
      active_participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2'], layout: 'grid_4',
      composite_playback_url: 'http://localhost:8888/costream/cs-session-101/index.m3u8', chat_room_id: 'chat-cs-session-101',
      signature: csSig('cs-session-101', 'player-alpha-2', true, 'grid_4', 3, 'active'),
    });
    expect(Object.keys(r.body)).toEqual(['session_id', 'status', 'active_host', 'handoff_occurred', 'participant_count', 'active_participants', 'layout', 'composite_playback_url', 'chat_room_id', 'signature']);
    const again = await cs(SPEC_CS);
    expect([again.status, again.raw]).toEqual([200, r.raw]);
  });

  it('defaults: layout grid_4, no drop', async () => {
    const r = await cs({ session_id: 'cs-a', host_player_id: 'player-alpha-1', participants: FOUR });
    expect([r.status, r.body.active_host, r.body.handoff_occurred, r.body.participant_count, r.body.layout]).toEqual([201, 'player-alpha-1', false, 4, 'grid_4']);
    expect(r.body.signature).toBe(csSig('cs-a', 'player-alpha-1', false, 'grid_4', 4, 'active'));
  });

  it('the sole host dropping terminates cleanly', async () => {
    const r = await cs({ session_id: 'cs-solo', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'], layout: 'solo', simulate_host_drop: true });
    expect(r.body).toMatchObject({ status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [], composite_playback_url: null, chat_room_id: 'chat-cs-solo' });
    expect(r.body.signature).toBe(csSig('cs-solo', null, false, 'solo', 0, 'terminated'));
  });

  it('a changed body for the same session is re-evaluated (201) and keeps chat_room_id', async () => {
    await cs({ ...SPEC_CS, simulate_host_drop: false });
    const r = await cs(SPEC_CS);
    expect([r.status, r.body.active_host, r.body.chat_room_id]).toEqual([201, 'player-alpha-2', 'chat-cs-session-101']);
  });

  it('10 concurrent identical creates: one 201, nine 200, one row', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => cs(SPEC_CS)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.raw)).size).toBe(1);
  });

  it('layout capacity uses the effective count after the drop', async () => {
    const three = FOUR.slice(0, 3);
    const bad = await cs({ session_id: 'cs-l', host_player_id: 'player-alpha-1', participants: three, layout: 'grid_2' });
    expect([bad.status, bad.body.error.code]).toEqual([400, 'UNSUPPORTED_LAYOUT']);
    expect((await cs({ session_id: 'cs-l', host_player_id: 'player-alpha-1', participants: three, layout: 'grid_2', simulate_host_drop: true })).status).toBe(201);
    const solo = await cs({ session_id: 'cs-s', host_player_id: 'player-alpha-1', participants: FOUR.slice(0, 2), layout: 'solo' });
    expect(solo.body.error.code).toBe('UNSUPPORTED_LAYOUT');
    expect((await cs({ session_id: 'cs-s', host_player_id: 'player-alpha-1', participants: FOUR.slice(0, 2), layout: 'solo', simulate_host_drop: true })).status).toBe(201);
    expect((await cs({ session_id: 'cs-sp', host_player_id: 'player-alpha-1', participants: FOUR, layout: 'spotlight' })).status).toBe(201);
  });

  it('validation order: 400 schema -> 404 player -> 400 host not in participants -> 409 full -> 400 layout', async () => {
    const miss = await cs({ session_id: 'cs-o', host_player_id: 'player-zzz', participants: ['player-alpha-1', 'player-nope'] });
    expect([miss.status, miss.body.error.code, miss.body.error.details.player_id]).toEqual([404, 'PLAYER_NOT_FOUND', 'player-nope']);
    const host = await cs({ session_id: 'cs-o', host_player_id: 'player-beta-2', participants: ['player-alpha-1'] });
    expect([host.status, host.body.error.code, host.body.error.details.fields]).toEqual([400, 'VALIDATION_ERROR', ['host_player_id']]);
    const five = [...FOUR, 'u-viewer'];
    const full = await cs({ session_id: 'cs-o', host_player_id: 'player-alpha-1', participants: five, layout: 'solo' });
    expect([full.status, full.body.error.code]).toEqual([409, 'COSTREAM_SESSION_FULL']);
  });

  it.each([
    [{ ...SPEC_CS, participants: [] }, 'participants'],
    [{ ...SPEC_CS, participants: ['player-alpha-1', 'player-alpha-1'] }, 'participants'],
    [{ ...SPEC_CS, layout: 'grid_9' }, 'layout'],
    [{ ...SPEC_CS, simulate_host_drop: 'yes' }, 'simulate_host_drop'],
    [{ ...SPEC_CS, session_id: undefined }, 'session_id'],
    [{ ...SPEC_CS, host_player_id: undefined }, 'host_player_id'],
  ])('400 VALIDATION_ERROR (%#)', async (b, field) => {
    const r = await cs(b);
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(r.body.error.details.fields).toContain(field);
  });

  it('the session QR follows its live status', async () => {
    await cs({ ...SPEC_CS, simulate_host_drop: false });
    const q1 = await call(ctx.app, 'GET', '/audit/v1/qr/cs-session-101?inspect=true');
    expect([q1.status, q1.body.entity_status, q1.body.target_route]).toEqual([200, 'active', '/web/costream/cs-session-101']);
    await cs({ session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'], simulate_host_drop: true });
    expect((await call(ctx.app, 'GET', '/audit/v1/qr/cs-session-101?inspect=true')).body.entity_status).toBe('terminated');
  });
});
