import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2found');
});
afterAll(async () => ctx.close());

const guest = { headers: { authorization: 'Bearer guest_anon_tok_7721' } };
const ev = (event_id: string, match_id: string, type: string, payload: any = {}) =>
  call(ctx.app, 'POST', '/audit/v1/events', { event_id, match_id, type, payload });
const init = async (id: string) => {
  const r = await ev(uniq('i'), id, 'match_init', { sport_id: 'football', home_team_id: 't1', away_team_id: 't2' });
  expect(r.status).toBe(201);
};
const status = async (id: string) => (await call(ctx.app, 'GET', `/audit/v1/score/${id}`)).body.status;

describe('reset seed delta (spec 5.2)', () => {
  it('seeds match-m1 as a live football match at 1 - 0 in league-alpha-1', async () => {
    const r = await call(ctx.app, 'GET', '/audit/v1/score/match-m1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'in_progress', sport_id: 'football', league_id: 'league-alpha-1' });
    expect([r.body.home.team_id, r.body.home.score, r.body.away.team_id, r.body.away.score]).toEqual(['club-alpha-1', 1, 'club-alpha-2', 0]);
  });

  it('seeds the QR mappings, the read-only guest token, player-beta-2 and an empty cart/DLQ', async () => {
    const q = async (sql: string) => (await ctx.db.pool.query(sql)).rows;
    expect(await q('SELECT entity_id, short_code, scan_count::int AS n FROM qr_codes ORDER BY entity_id')).toEqual([
      { entity_id: 'club-alpha-1', short_code: 'c-alpha-1', n: 0 },
      { entity_id: 'match-m1', short_code: 'm1-live', n: 0 },
      { entity_id: 'player-alpha-1', short_code: 'p-alpha-1', n: 0 },
    ]);
    expect(await q("SELECT status, merged_user_id FROM guest_tokens WHERE guest_token='guest_anon_tok_7721'")).toEqual([{ status: 'active', merged_user_id: null }]);
    expect(await q("SELECT tenant_id, club_id FROM rbac_entities WHERE kind='player' AND id='player-beta-2'")).toEqual([{ tenant_id: 'tenant-beta', club_id: 'club-beta-1' }]);
    expect(await q("SELECT count(*)::int AS n FROM carts WHERE user_id='player-alpha-1'")).toEqual([{ n: 0 }]);
    expect(await q('SELECT count(*)::int AS n FROM dlq_events')).toEqual([{ n: 0 }]);
  });

  it('is repeatable: a second reset leaves identical Phase II state and wipes anything added', async () => {
    await ctx.db.pool.query("UPDATE qr_codes SET scan_count = 9 WHERE entity_id='match-m1'");
    await ctx.db.pool.query("INSERT INTO carts VALUES ('player-alpha-1','var-jersey-001-L',2)");
    await ctx.reset();
    const r = await ctx.db.pool.query("SELECT (SELECT scan_count::int FROM qr_codes WHERE entity_id='match-m1') AS scans, (SELECT count(*)::int FROM carts) AS carts");
    expect(r.rows[0]).toEqual({ scans: 0, carts: 0 });
    expect((await call(ctx.app, 'GET', '/audit/v1/score/match-m1')).body.version).toBe(3);
  });

  it('keeps the Day 1 baseline intact', async () => {
    const r = await call(ctx.app, 'POST', '/audit/v1/reset', {});
    expect(r.body).toMatchObject({ status: 'reset_complete', tenants: ['tenant-alpha', 'tenant-beta'], stock: { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 } });
  });
});

describe('guest write boundary (FR-4.3)', () => {
  it.each([
    ['POST', '/api/v1/chat'],
    ['POST', '/audit/v1/checkout'],
    ['POST', '/audit/v1/events'],
    ['PATCH', '/anything'],
    ['DELETE', '/audit/v1/privacy/user/player-alpha-1'],
  ])('%s %s with a guest token -> 403 GUEST_WRITE_FORBIDDEN, even with an empty body', async (method, url) => {
    const r = await call(ctx.app, method, url, {}, guest);
    expect([r.status, r.body.error.code]).toEqual([403, 'GUEST_WRITE_FORBIDDEN']);
    expect(r.body.error.details).toEqual({ guest_token: 'guest_anon_tok_7721' });
    expect(typeof r.body.error.message).toBe('string');
  });

  it('answers 403 before body validation (malformed JSON) and is case-insensitive on the scheme', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/audit/v1/events', payload: '{not json', headers: { 'content-type': 'application/json', authorization: 'bearer guest_anon_tok_abc' } });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error.details.guest_token).toBe('guest_anon_tok_abc');
  });

  it('never blocks reads, other tokens, or no token (Day 1 behaviour unchanged)', async () => {
    expect((await call(ctx.app, 'GET', '/audit/v1/score/match-m1', undefined, guest)).status).toBe(200);
    expect((await call(ctx.app, 'POST', '/audit/v1/events', {})).body.error.code).toBe('VALIDATION_ERROR');
    const member = await call(ctx.app, 'POST', '/audit/v1/events', {}, { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' } });
    expect(member.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('exempts token issuing and the cart-merge probe route', async () => {
    for (const url of ['/audit/v1/guest/cart-merge', '/api/v1/guest/session']) {
      const r = await call(ctx.app, 'POST', url, {}, guest);
      expect(r.body?.error?.code).not.toBe('GUEST_WRITE_FORBIDDEN');
    }
  });
});

describe('postponed / cancelled / abandoned (edge case 2 prerequisites)', () => {
  it.each([
    ['match_postponed', 'postponed'],
    ['match_postpone', 'postponed'],
    ['postpone', 'postponed'],
    ['match_cancelled', 'cancelled'],
    ['match_cancel', 'cancelled'],
    ['match_abandoned', 'abandoned'],
    ['match_abandon', 'abandoned'],
  ])('%s moves an in-progress match to %s', async (type, expected) => {
    const id = uniq('m');
    await init(id);
    expect((await ev(uniq('e'), id, 'match_start')).status).toBe(201);
    const r = await ev(uniq('e'), id, type, { reason: 'rain' });
    expect(r.status).toBe(201);
    expect(await status(id)).toBe(expected);
  });

  it('works from upcoming and through the generic status_change event', async () => {
    const a = uniq('m');
    await init(a);
    expect((await ev(uniq('e'), a, 'status_change', { status: 'postponed' })).status).toBe(201);
    expect(await status(a)).toBe('postponed');
    const b = uniq('m');
    await init(b);
    await ev(uniq('e'), b, 'match_start');
    await ev(uniq('e'), b, 'status_change', { status: 'abandoned' });
    expect(await status(b)).toBe('abandoned');
  });

  it('rejects further transitions and play on a non-playing match', async () => {
    const id = uniq('m');
    await init(id);
    await ev(uniq('e'), id, 'match_start');
    await ev(uniq('e'), id, 'match_postponed');
    for (const [type, payload, code] of [
      ['match_start', {}, 'ILLEGAL_TRANSITION'],
      ['match_end', {}, 'ILLEGAL_TRANSITION'],
      ['match_cancelled', {}, 'ILLEGAL_TRANSITION'],
      ['score', { team_id: 't1', event_type: 'goal' }, 'MATCH_NOT_IN_PROGRESS'],
    ] as const) {
      const r = await ev(uniq('e'), id, type, payload);
      expect([r.status, r.body.error.code]).toEqual([409, code]);
    }
    expect(await status(id)).toBe('postponed');
  });

  it('a completed match cannot be postponed; invalid status_change is a 400', async () => {
    const id = uniq('m');
    await init(id);
    await ev(uniq('e'), id, 'match_start');
    await ev(uniq('e'), id, 'match_end');
    const r = await ev(uniq('e'), id, 'match_postponed');
    expect([r.status, r.body.error.code]).toEqual([409, 'ILLEGAL_TRANSITION']);
    const bad = await ev(uniq('e'), id, 'status_change', { status: 'exploded' });
    expect([bad.status, bad.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect((await ev(uniq('e'), id, 'status_change', {})).status).toBe(400);
  });

  it('match-m1 can be completed or postponed by the grader (edge case 2 inputs)', async () => {
    await ctx.reset();
    expect((await ev('g-end', 'match-m1', 'match_end')).status).toBe(201);
    expect(await status('match-m1')).toBe('completed');
    await ctx.reset();
    expect((await ev('g-pp', 'match-m1', 'match_postponed')).status).toBe(201);
    expect(await status('match-m1')).toBe('postponed');
    await ctx.reset();
  });

  it('is idempotent on replay and standings ignore non-completed matches', async () => {
    const id = uniq('m');
    await init(id);
    const eid = uniq('e');
    expect((await ev(eid, id, 'match_postponed')).status).toBe(201);
    expect((await ev(eid, id, 'match_postponed')).status).toBe(200);
    const st = await call(ctx.app, 'GET', '/audit/v1/standings/league-alpha-1');
    expect(st.status).toBe(200);
    expect(st.body.table.every((r: any) => r.played <= 1)).toBe(true);
  });
});

describe('extended /health', () => {
  it('stays {"status":"ok"} when only the database is configured', async () => {
    const r = await call(ctx.app, 'GET', '/health');
    expect([r.status, r.body]).toEqual([200, { status: 'ok' }]);
  });
  it('503 keeps the exact Day 1 body and reports detail in x-health-checks', async () => {
    await ctx.db.pool.query('DELETE FROM tenants');
    const r = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ status: 'unavailable' });
    expect(JSON.parse(r.headers['x-health-checks'] as string)).toEqual({ db: 'down', redis: 'skipped', media: 'skipped' });
    await ctx.reset();
  });
});
