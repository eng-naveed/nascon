import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, SALT, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('offline');
});
afterAll(async () => ctx.close());

const sync = (body: unknown) => call(ctx.app, 'POST', '/audit/v1/offline-sync', body);
const T = (min: number) => `2026-10-17T11:${String(min).padStart(2, '0')}:00Z`;
const act = (action_id: string, type: string, min: number, base_version: number, payload: unknown) => ({ action_id, type, queued_at: T(min), base_version, payload });

describe('offline sync: score_event', () => {
  it('applied, rebased_append, duplicate, rejected variants, ordering and full replay', async () => {
    const m = uniq('om');
    const init = { event_id: `${m}-e1`, match_id: m, type: 'match_init', payload: { sport_id: 'football', home_team_id: 'H', away_team_id: 'A' } };
    const dev = uniq('dev');
    const goal = { event_id: `${m}-e3`, match_id: m, type: 'score', payload: { team_id: 'H', event_type: 'goal' } };
    const body = {
      device_id: dev,
      actions: [
        // listed out of order on purpose: processing is by queued_at
        act('a3', 'score_event', 3, 1, goal), // stale device: base 1 < current 2 -> rebased_append
        act('a1', 'score_event', 1, 0, init), // creates the stream (version 0)
        act('a2', 'score_event', 2, 1, { event_id: `${m}-e2`, match_id: m, type: 'match_start' }), // appended
        act('a4', 'score_event', 4, 99, { event_id: `${m}-e4`, match_id: m, type: 'score', payload: { team_id: 'H', event_type: 'goal' } }),
        act('a5', 'score_event', 5, 0, { event_id: `${m}-e5`, match_id: 'ghost-match', type: 'match_start' }),
        act('a6', 'score_event', 6, 3, { match_id: m, type: 'score' }),
        act('a7', 'score_event', 7, 3, { event_id: `${m}-e7`, match_id: m, type: 'match_start' }),
        act('a8', 'score_event', 8, 3, goal), // same event id + identical payload -> duplicate
        act('a9', 'score_event', 8, 3, { ...goal, payload: { team_id: 'A', event_type: 'goal' } }), // same id, different body
      ],
    };
    const r = await sync(body);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.results.map((x: any) => [x.action_id, x]));
    expect(r.body.results.map((x: any) => x.action_id)).toEqual(['a3', 'a1', 'a2', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9']);
    expect(by.a1).toMatchObject({ status: 'applied', resolution: 'appended', processed_order: 1, server_version: 1, error_code: null });
    expect(by.a1.signature).toBe(ctx.crypto.sign(SALT, `${m}-e1`, init.payload));
    expect(by.a2).toMatchObject({ status: 'applied', resolution: 'appended', processed_order: 2, server_version: 2 });
    expect(by.a3).toMatchObject({ status: 'applied', resolution: 'rebased_append', processed_order: 3, server_version: 3 });
    expect(by.a4).toMatchObject({ status: 'rejected', resolution: 'server_wins', error_code: 'INVALID_BASE_VERSION', server_version: 3, signature: null });
    expect(by.a5).toMatchObject({ status: 'rejected', error_code: 'MATCH_NOT_FOUND', server_version: 0 });
    expect(by.a6).toMatchObject({ status: 'rejected', error_code: 'VALIDATION_ERROR' });
    expect(by.a7).toMatchObject({ status: 'rejected', error_code: 'ILLEGAL_TRANSITION', server_version: 3 });
    expect(by.a8).toMatchObject({ status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, signature: null });
    expect(by.a9).toMatchObject({ status: 'rejected', error_code: 'DUPLICATE_EVENT_ID' });
    expect(r.body.summary).toEqual({ applied: 3, rejected: 5, duplicate: 1 });

    const again = await sync(body);
    expect(again.status).toBe(200);
    expect(again.body.results.every((x: any) => x.status === 'duplicate')).toBe(true);
    expect(again.body.summary).toEqual({ applied: 0, rejected: 0, duplicate: 9 });
    expect((await call(ctx.app, 'GET', `/audit/v1/score/${m}`)).body.version).toBe(3);
  });
});

describe('offline sync: roster_transfer', () => {
  it('applies, deduplicates by request id and reports rule codes', async () => {
    const p = uniq('or');
    const L = `${p}-lg`;
    const setup = await call(ctx.app, 'POST', '/audit/v1/roster/setup', {
      league: { league_id: L, tenant_id: 'tenant-alpha', transfer_window: { open: '2026-01-01', close: '2026-12-31' }, max_squad_size: 2 },
      squads: [{ squad_id: `${p}-a`, tenant_id: 'tenant-alpha' }, { squad_id: `${p}-b`, tenant_id: 'tenant-alpha' }],
      players: [
        { player_id: `${p}-p1`, position: 'df', squad_id: `${p}-a` }, { player_id: `${p}-p2`, position: 'df', squad_id: `${p}-a` },
        { player_id: `${p}-p3`, position: 'df', squad_id: `${p}-b` },
      ],
    });
    expect(setup.status).toBe(201);
    const tr = (req: string, player: string, from: string, to: string) => ({
      request_id: `${p}-${req}`, league_id: L, player_id: `${p}-${player}`, type: 'transfer', from_squad_id: `${p}-${from}`, to_squad_id: `${p}-${to}`, effective_date: '2026-06-01',
    });
    const r = await sync({
      device_id: uniq('dev'),
      actions: [
        act('b1', 'roster_transfer', 1, 0, tr('r1', 'p1', 'a', 'b')), // b: 1 -> 2
        act('b2', 'roster_transfer', 2, 0, tr('r1', 'p1', 'a', 'b')), // same request id -> duplicate
        act('b3', 'roster_transfer', 3, 0, tr('r2', 'p2', 'a', 'b')), // b is full
        act('b4', 'roster_transfer', 4, 5, tr('r3', 'p2', 'a', 'b')), // base ahead
        act('b5', 'roster_transfer', 5, 0, { ...tr('r4', 'p2', 'a', 'b'), league_id: 'ghost' }),
        act('b6', 'roster_transfer', 6, 0, tr('r5', 'ghost', 'a', 'b')),
        act('b7', 'roster_transfer', 7, 0, { request_id: 'x' }),
        act('b8', 'roster_transfer', 8, 0, tr('r6', 'p2', 'b', 'a')), // not in squad b
      ],
    });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.results.map((x: any) => [x.action_id, x]));
    expect(by.b1).toMatchObject({ status: 'applied', resolution: 'appended', server_version: 1, signature: null });
    expect(by.b2).toMatchObject({ status: 'duplicate', resolution: 'skipped_duplicate', server_version: 1 });
    expect(by.b3).toMatchObject({ status: 'rejected', error_code: 'SQUAD_FULL', server_version: 0 });
    expect(by.b4).toMatchObject({ status: 'rejected', error_code: 'INVALID_BASE_VERSION' });
    expect(by.b5).toMatchObject({ status: 'rejected', error_code: 'LEAGUE_NOT_FOUND' });
    expect(by.b6).toMatchObject({ status: 'rejected', error_code: 'PLAYER_NOT_FOUND', server_version: 0 });
    expect(by.b7).toMatchObject({ status: 'rejected', error_code: 'VALIDATION_ERROR' });
    expect(by.b8).toMatchObject({ status: 'rejected', error_code: 'NOT_IN_SQUAD' });
    // a stale device (base 0 while the player is at version 1) gets rebased
    const stale = await sync({ device_id: uniq('dev'), actions: [act('c1', 'roster_transfer', 1, 0, tr('r7', 'p1', 'b', 'a'))] });
    expect(stale.body.results[0]).toMatchObject({ status: 'applied', resolution: 'rebased_append', server_version: 2 });
  });
});

describe('offline sync: envelope validation', () => {
  it('400 for malformed envelopes', async () => {
    const one = act('z', 'score_event', 1, 0, {});
    for (const b of [
      { device_id: 'd', actions: [] },
      { device_id: 'd', actions: Array.from({ length: 101 }, (_, i) => ({ ...one, action_id: `z${i}` })) },
      { device_id: 'd', actions: [{ ...one, queued_at: 'yesterday' }] },
      { device_id: 'd', actions: [{ ...one, type: 'chat' }] },
      { device_id: 'd', actions: [{ ...one, base_version: -1 }] },
      { actions: [one] },
    ]) {
      const r = await sync(b);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
