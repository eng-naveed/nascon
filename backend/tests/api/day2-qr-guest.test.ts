import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, SALT2, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2qr');
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const BASE = 'http://localhost:8080';
const qr = (id: string, qs = '', headers: Record<string, string> = {}) => call(ctx.app, 'GET', `/audit/v1/qr/${id}${qs}`, undefined, { headers });
const scan = (code: string, ua = 'Mozilla/5.0 (Windows NT 10.0)') => ctx.app.inject({ method: 'GET', url: `/q/${code}`, headers: { 'user-agent': ua } });
const ev = (match_id: string, type: string, payload: any = {}) => call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id, type, payload });
const qrSig = (id: string, short_url: string, target_route: string) => ctx.crypto.sign(SALT2, id, { entity_id: id, short_url, target_route });

describe('GET /audit/v1/qr/{entity_id} (spec 5.6)', () => {
  it('returns the spec example for match-m1, counting the scan', async () => {
    const r = await qr('match-m1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      entity_id: 'match-m1',
      entity_type: 'match',
      entity_status: 'in_progress',
      short_url: `${BASE}/q/m1-live`,
      target_route: '/web/matches/match-m1/live',
      deep_link_uri: 'nascon://entity/match-m1',
      scan_count: 1,
      export_formats: {
        svg: `${BASE}/audit/v1/qr/match-m1/export.svg`,
        png: `${BASE}/audit/v1/qr/match-m1/export.png`,
        pdf: `${BASE}/audit/v1/qr/match-m1/export.pdf`,
      },
      signature: qrSig('match-m1', `${BASE}/q/m1-live`, '/web/matches/match-m1/live'),
    });
    expect(Object.keys(r.body)).toEqual(['entity_id', 'entity_type', 'entity_status', 'short_url', 'target_route', 'deep_link_uri', 'scan_count', 'export_formats', 'signature']);
  });

  it('inspect=true reads without counting', async () => {
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(0);
    await qr('match-m1');
    await qr('match-m1');
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(2);
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(2);
  });

  it('counts 20 concurrent scans exactly', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => qr('match-m1')));
    expect(rs.map((r) => r.body.scan_count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(20);
    expect((await ctx.app.inject({ method: 'GET', url: '/metrics' })).body).toMatch(/^nascon_qr_scans_total 20$/m);
  });

  it('seeded player and club mappings use their short codes', async () => {
    const p = await qr('player-alpha-1', '?inspect=true');
    expect([p.body.entity_type, p.body.entity_status, p.body.short_url, p.body.target_route]).toEqual(['player', 'active', `${BASE}/q/p-alpha-1`, '/web/players/player-alpha-1']);
    const c = await qr('club-alpha-1', '?inspect=true');
    expect([c.body.entity_type, c.body.short_url, c.body.target_route]).toEqual(['club', `${BASE}/q/c-alpha-1`, '/web/clubs/club-alpha-1']);
  });

  it('auto-registers seeded and newly created entities on first use (FR-4.1)', async () => {
    const p = await qr('player-alpha-2', '?inspect=true');
    expect([p.status, p.body.short_url, p.body.target_route]).toEqual([200, `${BASE}/q/player-alpha-2`, '/web/players/player-alpha-2']);
    const id = uniq('match');
    await ev(id, 'match_init', { sport_id: 'football', home_team_id: 'club-alpha-3', away_team_id: 'club-alpha-4' });
    const m = await qr(id);
    expect([m.body.entity_status, m.body.target_route, m.body.scan_count]).toEqual(['upcoming', `/web/matches/${id}/preview`, 1]);
    await ctx.db.pool.query(
      `INSERT INTO costream_sessions(session_id, host_player_id, participants, layout, status, active_host, participant_count, active_participants, request_hash, response)
       VALUES ('cs-session-9', 'player-alpha-1', '["player-alpha-1"]', 'solo', 'active', 'player-alpha-1', 1, '["player-alpha-1"]', 'h', '{}')`,
    );
    const s = await qr('cs-session-9', '?inspect=true');
    expect([s.body.entity_type, s.body.entity_status, s.body.target_route, s.body.deep_link_uri]).toEqual(['costream', 'active', '/web/costream/cs-session-9', 'nascon://entity/cs-session-9']);
    // the short code never changes once generated
    await qr(id);
    expect((await qr(id, '?inspect=true')).body.short_url).toBe(m.body.short_url);
  });

  it.each(['match-nope', 'player-nope', 'club-nope', 'cs-session-nope', 'league-alpha-1', 'random'])('404 QR_NOT_FOUND for %s', async (id) => {
    const r = await qr(id);
    expect([r.status, r.body.error.code]).toEqual([404, 'QR_NOT_FOUND']);
  });
});

describe('scenario 2: dynamic target mutation after print', () => {
  it('match_end moves the same short URL to /vod with a fresh signature, in the audit probe and in /q', async () => {
    const before = await qr('match-m1', '?inspect=true');
    const s1 = await scan('m1-live');
    expect([s1.statusCode, s1.headers.location, s1.headers['cache-control']]).toEqual([302, '/web/matches/match-m1/live', 'no-store']);
    expect((await ev('match-m1', 'match_end')).status).toBe(201);
    const after = await qr('match-m1', '?inspect=true');
    expect([after.body.short_url, after.body.target_route, after.body.entity_status]).toEqual([before.body.short_url, '/web/matches/match-m1/vod', 'completed']);
    expect(after.body.signature).toBe(qrSig('match-m1', `${BASE}/q/m1-live`, '/web/matches/match-m1/vod'));
    expect(after.body.signature).not.toBe(before.body.signature);
    expect((await scan('m1-live')).headers.location).toBe('/web/matches/match-m1/vod');
  });

  it.each(['postponed', 'cancelled', 'abandoned'])('%s -> /notice?state=%s', async (st) => {
    await qr('match-m1', '?inspect=true'); // warm the cache first
    expect((await ev('match-m1', 'status_change', { status: st })).status).toBe(201);
    const r = await qr('match-m1', '?inspect=true');
    expect([r.body.entity_status, r.body.target_route]).toEqual([st, `/web/matches/match-m1/notice?state=${st}`]);
    expect((await scan('m1-live')).headers.location).toBe(`/web/matches/match-m1/notice?state=${st}`);
  });

  it('a status change through the member events API also invalidates', async () => {
    await qr('match-m1', '?inspect=true');
    const login = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'organizer@nascon.test', password: PASSWORD });
    const r = await call(ctx.app, 'POST', '/api/v1/events', { event_id: uniq('e'), match_id: 'match-m1', type: 'match_end', payload: {} }, bearer(login.body.token));
    expect(r.status).toBe(201);
    expect((await qr('match-m1', '?inspect=true')).body.target_route).toBe('/web/matches/match-m1/vod');
  });

  it('reset restores the in_progress target and scan_count 0 even when cached', async () => {
    await qr('match-m1');
    await ev('match-m1', 'match_end');
    await qr('match-m1', '?inspect=true');
    await ctx.reset();
    const r = await qr('match-m1', '?inspect=true');
    expect([r.body.target_route, r.body.scan_count]).toEqual(['/web/matches/match-m1/live', 0]);
  });
});

describe('GET /q/{code} and privacy-safe telemetry', () => {
  it('302s, counts the scan by device family and UTC hour, stores no IP or User-Agent', async () => {
    await scan('m1-live', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    await scan('m1-live', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    await scan('m1-live');
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(3);
    const rows = (await ctx.db.pool.query('SELECT device_family, bucket_utc, n::int FROM qr_scan_stats ORDER BY device_family')).rows;
    expect(rows.map((r) => [r.device_family, r.n])).toEqual([['desktop', 1], ['mobile', 2]]);
    const b = rows[0].bucket_utc as Date;
    expect([b.getUTCMinutes(), b.getUTCSeconds(), b.getUTCMilliseconds()]).toEqual([0, 0, 0]);
    const cols = (await ctx.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('qr_scan_stats','qr_codes')")).rows.map((r) => r.column_name);
    expect(cols.filter((c) => /ip|agent|cookie|ua/i.test(c))).toEqual([]);
  });

  it('member stats endpoint lists buckets; 401 without a token', async () => {
    await scan('p-alpha-1', 'Android Mobile');
    const t = (await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'organizer@nascon.test', password: PASSWORD })).body.token;
    const r = await call(ctx.app, 'GET', '/api/v1/qr/player-alpha-1/stats', undefined, bearer(t));
    expect([r.status, r.body.scan_count, r.body.buckets.map((x: any) => [x.device_family, x.scans])]).toEqual([200, 1, [['mobile', 1]]]);
    expect((await call(ctx.app, 'GET', '/api/v1/qr/player-alpha-1/stats')).status).toBe(401);
  });

  it('404 QR_NOT_FOUND for an unknown short code', async () => {
    const r = await scan('nope');
    expect([r.statusCode, JSON.parse(r.body).error.code]).toEqual([404, 'QR_NOT_FOUND']);
  });
});

describe('QR exports (spec 5.6)', () => {
  it('serve SVG, PNG and PDF with exact content types and never count scans', async () => {
    const svg = await ctx.app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.svg' });
    expect([svg.statusCode, svg.headers['content-type']]).toEqual([200, 'image/svg+xml']);
    expect(svg.body.startsWith('<svg')).toBe(true);
    expect(svg.body).toContain(`${BASE}/q/m1-live`);
    const png = await ctx.app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.png' });
    expect([png.statusCode, png.headers['content-type']]).toEqual([200, 'image/png']);
    expect(png.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const pdf = await ctx.app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.pdf' });
    expect([pdf.statusCode, pdf.headers['content-type']]).toEqual([200, 'application/pdf']);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.toString('latin1')).toContain('match-m1');
    expect((await qr('match-m1', '?inspect=true')).body.scan_count).toBe(0);
  });
  it.each(['svg', 'png', 'pdf'])('404 QR_NOT_FOUND for an unknown entity (%s)', async (f) => {
    const r = await call(ctx.app, 'GET', `/audit/v1/qr/match-nope/export.${f}`);
    expect([r.status, r.body.error.code]).toEqual([404, 'QR_NOT_FOUND']);
  });
});

const merge = (body: unknown, headers: Record<string, string> = {}) => call(ctx.app, 'POST', '/audit/v1/guest/cart-merge', body, { headers });
const SPEC_MERGE = { guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], test_write_block: true };
const inv = async (v: string) => (await call(ctx.app, 'GET', `/audit/v1/inventory/${v}`)).body;
const mergeSig = (token: string, user: string, total: number, code = 403) =>
  ctx.crypto.sign(SALT2, token, { cart_merged: true, guest_token: token, registered_user_id: user, total_items: total, write_rejection_code: code });

describe('POST /audit/v1/guest/cart-merge (spec 5.7)', () => {
  it('returns the spec example (200) and reserves stock once', async () => {
    const r = await merge(SPEC_MERGE);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      guest_token: 'guest_anon_tok_7721',
      write_block_verified: true,
      write_rejection_code: 403,
      cart_merged: true,
      active_cart: {
        user_id: 'player-alpha-1', currency: 'PKR', total_items: 1, subtotal_minor: 450000,
        items: [{ variant_id: 'var-jersey-001-L', quantity: 1, unit_price_minor: 450000 }],
      },
      signature: mergeSig('guest_anon_tok_7721', 'player-alpha-1', 1),
    });
    expect(Object.keys(r.body)).toEqual(['guest_token', 'write_block_verified', 'write_rejection_code', 'cart_merged', 'active_cart', 'signature']);
    expect(await inv('var-jersey-001-L')).toEqual({ variant_id: 'var-jersey-001-L', stock: 4, reserved: 1 });
  });

  it('scenario 4: identical replays (sequential and 10 concurrent) return the same 200 body, never double-add or double-reserve', async () => {
    const first = await merge(SPEC_MERGE);
    const again = await merge(SPEC_MERGE);
    expect([again.status, again.raw]).toEqual([200, first.raw]); // byte-identical, key order included
    const rs = await Promise.all(Array.from({ length: 10 }, () => merge(SPEC_MERGE)));
    for (const r of rs) expect([r.status, r.body.active_cart.total_items]).toEqual([200, 1]);
    expect(await inv('var-jersey-001-L')).toEqual({ variant_id: 'var-jersey-001-L', stock: 4, reserved: 1 });
    const cart = await ctx.db.pool.query("SELECT quantity FROM carts WHERE user_id='player-alpha-1'");
    expect(cart.rows).toEqual([{ quantity: 1 }]);
  });

  it('10 concurrent FIRST merges of the same token merge exactly once', async () => {
    const body = { ...SPEC_MERGE, guest_token: 'guest_race_1' };
    const rs = await Promise.all(Array.from({ length: 10 }, () => merge(body)));
    expect(new Set(rs.map((r) => JSON.stringify([r.status, r.body])).values()).size).toBe(1);
    expect(await inv('var-jersey-001-L')).toEqual({ variant_id: 'var-jersey-001-L', stock: 4, reserved: 1 });
  });

  it('a merged token reused with another user or cart is 409 GUEST_TOKEN_ALREADY_MERGED', async () => {
    await merge(SPEC_MERGE);
    for (const b of [
      { ...SPEC_MERGE, registered_user_id: 'player-alpha-2' },
      { ...SPEC_MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] },
    ]) {
      const r = await merge(b);
      expect([r.status, r.body.error.code, r.body.error.details.guest_token]).toEqual([409, 'GUEST_TOKEN_ALREADY_MERGED', 'guest_anon_tok_7721']);
    }
  });

  it('sums duplicate lines; the same content in another order is a replay', async () => {
    const a = await merge({ guest_token: 'guest_dup', registered_user_id: 'player-alpha-2', guest_cart: [
      { variant_id: 'var-jersey-001-L', quantity: 1 }, { variant_id: 'var-merch-003-ONE', quantity: 2 }, { variant_id: 'var-jersey-001-L', quantity: 1 },
    ] });
    expect(a.body.active_cart.items).toEqual([
      { variant_id: 'var-jersey-001-L', quantity: 2, unit_price_minor: 450000 },
      { variant_id: 'var-merch-003-ONE', quantity: 2, unit_price_minor: 150000 },
    ]);
    expect([a.body.active_cart.total_items, a.body.active_cart.subtotal_minor]).toEqual([4, 1200000]);
    const b = await merge({ guest_token: 'guest_dup', registered_user_id: 'player-alpha-2', guest_cart: [
      { variant_id: 'var-merch-003-ONE', quantity: 2 }, { variant_id: 'var-jersey-001-L', quantity: 2 },
    ] });
    expect([b.status, b.body]).toEqual([200, a.body]);
  });

  it('adds to an existing persistent cart from an earlier guest session', async () => {
    await merge(SPEC_MERGE);
    const r = await merge({ ...SPEC_MERGE, guest_token: 'guest_second', guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 2 }] });
    expect([r.body.active_cart.total_items, r.body.active_cart.items]).toEqual([3, [{ variant_id: 'var-jersey-001-L', quantity: 3, unit_price_minor: 450000 }]]);
    expect(r.body.signature).toBe(mergeSig('guest_second', 'player-alpha-1', 3));
  });

  it('409 OUT_OF_STOCK leaves nothing merged or reserved, and the token stays usable', async () => {
    const r = await merge({ ...SPEC_MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }, { variant_id: 'var-jersey-001-M', quantity: 2 }] });
    expect([r.status, r.body.error.code, r.body.error.details.variant_id]).toEqual([409, 'OUT_OF_STOCK', 'var-jersey-001-M']);
    expect(await inv('var-jersey-001-L')).toEqual({ variant_id: 'var-jersey-001-L', stock: 5, reserved: 0 });
    expect((await merge(SPEC_MERGE)).status).toBe(200);
  });

  it('404s in spec order: player before variant', async () => {
    const p = await merge({ ...SPEC_MERGE, registered_user_id: 'player-nope', guest_cart: [{ variant_id: 'var-nope', quantity: 1 }] });
    expect([p.status, p.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    const v = await merge({ ...SPEC_MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }, { variant_id: 'var-nope', quantity: 1 }] });
    expect([v.status, v.body.error.code, v.body.error.details.variant_id]).toEqual([404, 'VARIANT_NOT_FOUND', 'var-nope']);
    expect((await merge({ ...SPEC_MERGE, registered_user_id: 'u-viewer' })).status).toBe(200); // a user id also counts
  });

  it('test_write_block false skips the simulated write', async () => {
    const r = await merge({ ...SPEC_MERGE, test_write_block: false });
    expect([r.body.write_block_verified, r.body.write_rejection_code]).toEqual([false, 403]);
  });

  it('works when the caller itself carries the guest token (probe is exempt from the guard)', async () => {
    expect((await merge(SPEC_MERGE, { authorization: 'Bearer guest_anon_tok_7721' })).status).toBe(200);
  });

  it.each([
    [{ ...SPEC_MERGE, guest_token: 'anon_7721' }, 'guest_token'],
    [{ ...SPEC_MERGE, guest_token: 'guest_' }, 'guest_token'],
    [{ ...SPEC_MERGE, registered_user_id: 7 }, 'registered_user_id'],
    [{ ...SPEC_MERGE, guest_cart: [] }, 'guest_cart'],
    [{ ...SPEC_MERGE, guest_cart: Array.from({ length: 11 }, () => ({ variant_id: 'var-jersey-001-L', quantity: 1 })) }, 'guest_cart'],
    [{ ...SPEC_MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 0 }] }, 'guest_cart'],
    [{ ...SPEC_MERGE, guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1.5 }] }, 'guest_cart'],
    [{ ...SPEC_MERGE, test_write_block: 'yes' }, 'test_write_block'],
  ])('400 VALIDATION_ERROR (%#)', async (b, field) => {
    const r = await merge(b);
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(r.body.error.details.fields).toContain(field);
  });
});

describe('POST /api/v1/guest/session (FR-4.2)', () => {
  it('issues a short-lived read-only guest token that the write guard refuses', async () => {
    const r = await call(ctx.app, 'POST', '/api/v1/guest/session');
    expect(r.status).toBe(201);
    expect(r.body.guest_token).toMatch(/^guest_anon_tok_[A-Za-z0-9_-]{24}$/);
    expect([r.body.role, r.body.scope]).toEqual(['guest', ['stream_playback', 'live_score', 'guest_cart']]);
    const ttl = new Date(r.body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(2 * 3600 * 1000 - 60_000);
    expect(ttl).toBeLessThanOrEqual(2 * 3600 * 1000);
    const w = await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: 'chat-cs-session-101', text: 'hi' }, bearer(r.body.guest_token));
    expect([w.status, w.body.error.code]).toEqual([403, 'GUEST_WRITE_FORBIDDEN']);
    expect((await call(ctx.app, 'GET', '/audit/v1/qr/match-m1?inspect=true', undefined, bearer(r.body.guest_token))).status).toBe(200);
    const row = await ctx.db.pool.query('SELECT status FROM guest_tokens WHERE guest_token=$1', [r.body.guest_token]);
    expect(row.rows).toEqual([{ status: 'active' }]);
    expect((await call(ctx.app, 'POST', '/api/v1/guest/session')).body.guest_token).not.toBe(r.body.guest_token);
  });
});

describe('DELETE /audit/v1/privacy/user/{user_id} (spec 5.9, NFR-9)', () => {
  const erase = (id: string) => call(ctx.app, 'DELETE', `/audit/v1/privacy/user/${id}`);
  const login = (email: string) => call(ctx.app, 'POST', '/api/v1/auth/login', { email, password: PASSWORD });

  it('anonymises PII, wipes linked tokens and live sessions within 1 s, idempotently', async () => {
    const tok = (await login('player@nascon.test')).body.token;
    await merge(SPEC_MERGE);
    const t0 = Date.now();
    const r = await erase('player-alpha-1');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect([r.status, r.body]).toEqual([200, { user_id: 'player-alpha-1', status: 'anonymized', pii_retained: false, tokens_wiped: true }]);
    const u = (await ctx.db.pool.query("SELECT email, name FROM users WHERE user_id='u-player'")).rows[0];
    expect(u.email).toMatch(/^erased\+[0-9a-f]{32}@invalid\.local$/);
    expect(u.name).toBe('Erased User');
    const g = (await ctx.db.pool.query("SELECT status, merged_user_id FROM guest_tokens WHERE guest_token='guest_anon_tok_7721'")).rows[0];
    expect(g).toEqual({ status: 'wiped', merged_user_id: null });
    expect((await login('player@nascon.test')).status).toBe(401);
    expect((await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: 'chat-x', text: 'hi' }, bearer(tok))).status).toBe(401);
    const m = await merge(SPEC_MERGE);
    expect([m.status, m.body.error.code]).toEqual([409, 'GUEST_TOKEN_ALREADY_MERGED']);
    expect((await erase('player-alpha-1')).body).toEqual(r.body);
  });

  it('anonymises chat authorship and accepts the user id form', async () => {
    const tok = (await login('viewer@nascon.test')).body.token;
    await call(ctx.app, 'POST', '/api/v1/chat', { chat_room_id: 'chat-x', text: 'hello' }, bearer(tok));
    expect((await erase('u-viewer')).status).toBe(200);
    const s = (await ctx.db.pool.query("SELECT sender FROM chat_messages WHERE chat_room_id='chat-x'")).rows[0].sender;
    expect(s).toMatch(/^erased-[0-9a-f]{32}$/);
  });

  it('404 PLAYER_NOT_FOUND for an unknown user; reset restores erased accounts', async () => {
    const r = await erase('player-nope');
    expect([r.status, r.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    await erase('player-alpha-1');
    await ctx.reset();
    expect((await login('player@nascon.test')).status).toBe(200);
  });
});
