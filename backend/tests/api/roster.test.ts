import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('roster');
});
afterAll(async () => ctx.close());

const setup = (body: unknown) => call(ctx.app, 'POST', '/audit/v1/roster/setup', body);
const xfer = (body: unknown) => call(ctx.app, 'POST', '/audit/v1/roster/transfer', body);
const hist = (id: string, asOf?: string) => call(ctx.app, 'GET', `/audit/v1/roster/history/${id}${asOf !== undefined ? `?as_of=${asOf}` : ''}`);

/** A fresh scenario with unique ids. */
async function scenario() {
  const p = uniq('r');
  const L = `${p}-lg`;
  const id = (s: string) => `${p}-${s}`;
  const body = {
    league: { league_id: L, tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-09-01', close: '2026-09-30' }, max_squad_size: 3, required_positions: { gk: 1 } },
    squads: [
      { squad_id: id('a'), club_id: 'club-a', tenant_id: 'tenant-alpha', name: 'A' },
      { squad_id: id('b'), tenant_id: 'tenant-alpha' },
      { squad_id: id('c'), tenant_id: 'tenant-alpha', name: 'C' },
      { squad_id: id('x'), tenant_id: 'tenant-beta', name: 'Foreign' },
    ],
    players: [
      { player_id: id('p1'), name: 'Ali', position: 'gk', squad_id: id('a'), role: 'captain' },
      { player_id: id('p2'), name: 'Bilal', position: 'df', squad_id: id('a'), role: 'starter' },
      { player_id: id('p3'), position: 'mf', squad_id: id('a') },
      { player_id: id('p4'), position: 'gk', squad_id: id('b') },
      { player_id: id('p5'), position: 'df', squad_id: id('b') },
      { player_id: id('p6'), position: 'df', squad_id: id('b') },
      { player_id: id('p7'), position: 'fw', squad_id: id('c') },
    ],
    matches_in_progress: [{ match_id: `${p}-live`, home_squad_id: id('c'), away_squad_id: 'someone-else' }],
  };
  const r = await setup(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body).toEqual({ league_id: L, status: 'configured', squad_counts: { [id('a')]: 3, [id('b')]: 3, [id('c')]: 1, [id('x')]: 0 } });
  let n = 0;
  const req = (o: Record<string, unknown>) => ({
    request_id: `${p}-req${++n}`, league_id: L, type: 'transfer', effective_date: '2026-09-15', loan_end_date: null, reason: 'test', requested_by: 'user-1', ...o,
  });
  return { p, L, id, body, req };
}

describe('roster setup', () => {
  it('rejects inconsistent scenarios with 400 and falls back to sport/default limits', async () => {
    const s = await scenario();
    const bad = [
      { ...s.body, players: [{ player_id: 'zz1', position: 'gk', squad_id: 'nope' }] },
      { ...s.body, players: [s.body.players[0], s.body.players[0]] },
      { ...s.body, squads: [s.body.squads[0], s.body.squads[0]], players: [] },
      { ...s.body, league: { ...s.body.league, transfer_window: { open: '2026-02-30', close: '2026-03-01' } } },
      { ...s.body, players: [{ ...s.body.players[0], role: 'coach' }] },
    ];
    for (const b of bad) expect((await setup(b)).status, JSON.stringify(b).slice(0, 200)).toBe(400);
    // re-sending the same league replaces its state; omit limits -> sport roster config, then -> defaults
    const { max_squad_size: _m, required_positions: _r, ...leagueNoLimits } = s.body.league;
    expect((await setup({ ...s.body, league: leagueNoLimits })).status).toBe(201);
    const { sport_id: _s, ...leagueNoSport } = leagueNoLimits;
    expect((await setup({ ...s.body, league: leagueNoSport, matches_in_progress: undefined })).status).toBe(201);
  });
});

describe('roster transfer rule checks (spec 5.11 order)', () => {
  it('1: 400 VALIDATION_ERROR', async () => {
    const { id, req } = await scenario();
    const cases: [Record<string, unknown>, string][] = [
      [{ player_id: id('p2'), from_squad_id: id('a') }, 'to_squad_id'],
      [{ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), type: 'loan' }, 'loan_end_date'],
      [{ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), type: 'loan', loan_end_date: '2026-09-15' }, 'loan_end_date'],
      [{ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-13-01' }, 'effective_date'],
      [{ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), type: 'swap' }, 'type'],
    ];
    for (const [o, f] of cases) {
      const r = await xfer(req(o));
      expect(r.status).toBe(400);
      expect(r.body.error.details.fields).toContain(f);
    }
  });
  it('2: 404 LEAGUE/PLAYER/SQUAD_NOT_FOUND', async () => {
    const { id, req } = await scenario();
    const l = await xfer(req({ league_id: 'ghost-league', player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c') }));
    expect([l.status, l.body.error.code]).toEqual([404, 'LEAGUE_NOT_FOUND']);
    const p = await xfer(req({ player_id: 'ghost-player', from_squad_id: id('a'), to_squad_id: id('c') }));
    expect([p.status, p.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    const s = await xfer(req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: 'ghost-squad' }));
    expect([s.status, s.body.error.code]).toEqual([404, 'SQUAD_NOT_FOUND']);
    const f = await xfer(req({ player_id: id('p2'), from_squad_id: 'ghost-squad', to_squad_id: id('c') }));
    expect(f.body.error.code).toBe('SQUAD_NOT_FOUND');
  });
  it('3: 409 CROSS_TENANT_TRANSFER (same league and squad from another tenant league)', async () => {
    const { id, req } = await scenario();
    const r = await xfer(req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('x') }));
    expect([r.status, r.body.error.code]).toEqual([409, 'CROSS_TENANT_TRANSFER']);
    const beta = uniq('beta');
    await setup({
      league: { league_id: `${beta}-lg`, tenant_id: 'tenant-beta', transfer_window: { open: '2026-01-01', close: '2026-12-31' } },
      squads: [{ squad_id: `${beta}-sq`, tenant_id: 'tenant-beta' }], players: [],
    });
    const r2 = await xfer(req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: `${beta}-sq` }));
    expect(r2.body.error.code).toBe('CROSS_TENANT_TRANSFER');
  });
  it('4: 409 NOT_IN_SQUAD', async () => {
    const { id, req } = await scenario();
    const r = await xfer(req({ player_id: id('p2'), from_squad_id: id('b'), to_squad_id: id('c') }));
    expect([r.status, r.body.error.code]).toEqual([409, 'NOT_IN_SQUAD']);
  });
  it('5: 409 TRANSFER_WINDOW_CLOSED (release is allowed any day)', async () => {
    const { id, req } = await scenario();
    for (const d of ['2026-08-31', '2026-10-01']) {
      const r = await xfer(req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: d }));
      expect([r.status, r.body.error.code]).toEqual([409, 'TRANSFER_WINDOW_CLOSED']);
    }
    const rel = await xfer(req({ type: 'release', player_id: id('p2'), from_squad_id: id('a'), to_squad_id: null, effective_date: '2026-12-01' }));
    expect(rel.status).toBe(201);
    expect(rel.body).toMatchObject({ status: 'accepted', state: 'active', registration: null, audit_entry: { action: 'release', to_squad_id: null } });
    const h = await hist(id('p2'), '2026-12-02');
    expect(h.body).toMatchObject({ current_squad_id: null, parent_squad_id: null });
  });
  it('6: 409 PLAYER_ON_LOAN', async () => {
    const { id, req } = await scenario();
    const loan = await xfer(req({ type: 'loan', player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-09-05', loan_end_date: '2026-10-20' }));
    expect(loan.status).toBe(201);
    expect(loan.body.registration).toMatchObject({ registration_type: 'loan', squad_id: id('c'), parent_squad_id: id('a'), loan_end_date: '2026-10-20' });
    const r = await xfer(req({ player_id: id('p2'), from_squad_id: id('c'), to_squad_id: id('a'), effective_date: '2026-09-20' }));
    expect([r.status, r.body.error.code]).toEqual([409, 'PLAYER_ON_LOAN']);
  });
  it('7: 409 SQUAD_FULL', async () => {
    const { id, req } = await scenario();
    const r = await xfer(req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('b') }));
    expect([r.status, r.body.error.code]).toEqual([409, 'SQUAD_FULL']);
  });
  it('8: 409 MIN_POSITION_VIOLATION', async () => {
    const { id, req } = await scenario();
    const r = await xfer(req({ player_id: id('p1'), from_squad_id: id('a'), to_squad_id: id('c') }));
    expect([r.status, r.body.error.code]).toEqual([409, 'MIN_POSITION_VIOLATION']);
  });
  it('rejected requests write no audit entry', async () => {
    const { id, req } = await scenario();
    await xfer(req({ player_id: id('p1'), from_squad_id: id('a'), to_squad_id: id('c') }));
    expect((await hist(id('p1'), '2026-09-20')).body.history).toEqual([]);
  });
});

describe('roster effects', () => {
  it('transfer + idempotent replay', async () => {
    const { id, req, L } = await scenario();
    const body = req({ player_id: id('p2'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-09-30' });
    const r = await xfer(body);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'accepted', state: 'active', blocking_match_id: null,
      registration: { player_id: id('p2'), league_id: L, squad_id: id('c'), parent_squad_id: null, registration_type: 'transfer', start_date: '2026-09-30', role: 'substitute' },
      audit_entry: { action: 'transfer', from_squad_id: id('a'), to_squad_id: id('c'), who: 'user-1', why: 'test', state: 'active' },
    });
    expect(r.body.audit_entry.audit_id).toMatch(/^au-\d{4}$/);
    const replay = await xfer(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(r.body);
    const h = await hist(id('p2'), '2026-10-01');
    expect(h.body.history).toHaveLength(1);
    expect(h.body.current_squad_id).toBe(id('c'));
  });
  it('a player in an in-progress match is deferred on the last window day', async () => {
    const { id, req, p } = await scenario();
    // squad a is full (3/3): free a slot with a release, then move p7 out of squad c, which is playing a live match
    const full = await xfer(req({ player_id: id('p7'), from_squad_id: id('c'), to_squad_id: id('a'), effective_date: '2026-09-30' }));
    expect(full.body.error.code).toBe('SQUAD_FULL');
    expect((await xfer(req({ type: 'release', player_id: id('p3'), from_squad_id: id('a'), to_squad_id: null }))).status).toBe(201);
    const ok = await xfer(req({ player_id: id('p7'), from_squad_id: id('c'), to_squad_id: id('a'), effective_date: '2026-09-30', reason: undefined, requested_by: undefined }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ state: 'deferred_until_match_end', blocking_match_id: `${p}-live`, audit_entry: { who: 'unknown', why: '', state: 'deferred_until_match_end' } });
  });
  it('loan auto-return appears once via as_of', async () => {
    const { id, req } = await scenario();
    const loan = await xfer(req({ type: 'loan', player_id: id('p3'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-09-05', loan_end_date: '2026-09-10' }));
    expect(loan.status).toBe(201);
    const during = await hist(id('p3'), '2026-09-10');
    expect(during.body).toMatchObject({ current_squad_id: id('c'), parent_squad_id: id('a') });
    const after = await hist(id('p3'), '2026-09-11');
    expect(after.body.current_squad_id).toBe(id('a'));
    expect(after.body.history.map((h: any) => h.action)).toEqual(['loan', 'loan_return']);
    expect(after.body.history[1]).toMatchObject({ who: 'system', effective_date: '2026-09-11', from_squad_id: id('c'), to_squad_id: id('a') });
    const again = await hist(id('p3'), '2026-12-01');
    expect(again.body.history).toHaveLength(2);
    // default as_of = today
    const today = await hist(id('p3'));
    expect(today.body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const empty = await hist(id('p3'), '');
    expect(empty.status).toBe(200);
  });
  it('a transfer after the loan ended triggers the return first', async () => {
    const { id, req } = await scenario();
    await xfer(req({ type: 'loan', player_id: id('p3'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-09-05', loan_end_date: '2026-09-10' }));
    const r = await xfer(req({ player_id: id('p3'), from_squad_id: id('a'), to_squad_id: id('c'), effective_date: '2026-09-20' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const h = await hist(id('p3'), '2026-09-21');
    expect(h.body.history.map((x: any) => x.action)).toEqual(['loan', 'loan_return', 'transfer']);
  });
  it('history errors', async () => {
    const nf = await hist('ghost-player', '2026-01-01');
    expect([nf.status, nf.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    const { id } = await scenario();
    const bad = await hist(id('p1'), '2026-02-30');
    expect(bad.status).toBe(400);
  });
});
