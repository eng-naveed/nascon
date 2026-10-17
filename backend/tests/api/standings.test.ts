import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('standings');
});
afterAll(async () => ctx.close());

const league = (body: unknown) => call(ctx.app, 'POST', '/audit/v1/leagues', body);
const standings = (id: string) => call(ctx.app, 'GET', `/audit/v1/standings/${id}`);
const ev = (match_id: string, type: string, payload?: unknown) => call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id, type, payload });

/** plays a match: home scores hs, away scores as, then ends it */
async function play(m: string, home: string, away: string, hs: number, as: number, extra: [string, unknown][] = []) {
  expect((await ev(m, 'match_start')).status).toBe(201);
  for (let i = 0; i < hs; i++) await ev(m, 'score', { team_id: home, event_type: 'goal' });
  for (let i = 0; i < as; i++) await ev(m, 'score', { team_id: away, event_type: 'goal' });
  for (const [type, payload] of extra) expect((await ev(m, type, payload)).status).toBe(201);
  const end = await ev(m, 'match_end');
  expect(end.status, JSON.stringify(end.body)).toBe(201);
}

describe('leagues', () => {
  it('creates a league and rejects duplicates / existing matches with 409', async () => {
    const id = uniq('lg');
    const body = { league_id: id, sport_id: 'football', teams: ['a1', 'b1'], fixtures: [{ match_id: `${id}-m1`, home: 'a1', away: 'b1' }], qualification: { spots: 1 } };
    const r = await league(body);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ league_id: id, status: 'created', team_count: 2, fixture_count: 1 });
    const again = await league(body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LEAGUE_EXISTS');
    const reuse = await league({ ...body, league_id: uniq('lg') });
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('MATCH_EXISTS');
    const listed = await league({ ...body, league_id: uniq('lg'), fixtures: [{ match_id: 'x-dup', home: 'a1', away: 'b1' }, { match_id: 'x-dup', home: 'b1', away: 'a1' }] });
    expect(listed.status).toBe(409);
    expect(listed.body.error.code).toBe('MATCH_EXISTS');
  });
  it('400 / 404 validation', async () => {
    const base = { league_id: uniq('lg'), sport_id: 'football', teams: ['a', 'b', 'c'], fixtures: [], qualification: { spots: 1 } };
    const cases: [unknown, string][] = [
      [{ ...base, teams: ['a', 'a'] }, 'teams'],
      [{ ...base, teams: ['a'] }, 'teams'],
      [{ ...base, qualification: { spots: 4 } }, 'qualification.spots'],
      [{ ...base, tie_break_order: ['scored', 'scored'] }, 'tie_break_order'],
      [{ ...base, tie_break_order: ['coin_flip'] }, 'tie_break_order'],
      [{ ...base, fixtures: [{ match_id: 'm', home: 'a', away: 'zz' }] }, 'fixtures'],
      [{ ...base, fixtures: [{ match_id: 'm', home: 'a', away: 'a' }] }, 'fixtures'],
      [{ ...base, qualification: undefined }, 'qualification'],
    ];
    for (const [b, f] of cases) {
      const r = await league(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(r.body.error.details.fields).toContain(f);
    }
    const ns = await league({ ...base, sport_id: 'polo' });
    expect(ns.status).toBe(404);
    expect(ns.body.error.code).toBe('SPORT_NOT_FOUND');
    const nf = await standings('no-such-league');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('LEAGUE_NOT_FOUND');
  });
});

describe('standings', () => {
  it('seeded demo league has a table, h2h and qualification', async () => {
    const r = await standings('league-alpha-1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ league_id: 'league-alpha-1', sport_id: 'football', qualification_spots: 2 });
    expect(r.body.table).toHaveLength(4);
    expect(r.body.table[0]).toMatchObject({ team_id: 'club-alpha-1', points: 3, played: 1 });
    expect(r.body.h2h['club-alpha-1']['club-alpha-2']).toEqual({ played: 1, points: 3, scored: 2, conceded: 1 });
  });

  it('3-way tie resolved by the h2h mini-league; compensation recomputes from scratch', async () => {
    const id = uniq('lg3');
    const fixtures = [
      { match_id: `${id}-1`, home: 'a', away: 'b' }, { match_id: `${id}-2`, home: 'b', away: 'c' }, { match_id: `${id}-3`, home: 'c', away: 'a' },
      { match_id: `${id}-4`, home: 'a', away: 'd' },
    ];
    expect((await league({ league_id: id, sport_id: 'football', teams: ['a', 'b', 'c', 'd'], fixtures, qualification: { spots: 1 }, points: { win: 3, draw: 1, loss: 0 }, lots_seed: 9, name: 'Tie League', tenant_id: 'tenant-alpha' })).status).toBe(201);
    let s = await standings(id);
    expect(s.body.table.every((t: any) => t.points === 0 && t.status === 'still_possible')).toBe(true);
    await play(`${id}-1`, 'a', 'b', 3, 0);
    await play(`${id}-2`, 'b', 'c', 1, 0);
    await play(`${id}-3`, 'c', 'a', 1, 0);
    s = await standings(id);
    const order = s.body.table.map((t: any) => [t.team_id, t.resolved_by]);
    expect(order.slice(0, 3)).toEqual([['a', 'h2h_diff'], ['c', 'h2h_diff'], ['b', null]]);
    expect(s.body.table[3]).toMatchObject({ team_id: 'd', points: 0, status: 'still_possible' });
    // a beats d -> a clinches (nobody else can reach 6), d eliminated
    await play(`${id}-4`, 'a', 'd', 1, 0);
    s = await standings(id);
    const st = Object.fromEntries(s.body.table.map((t: any) => [t.team_id, t.status]));
    expect(st.a).toBe('clinched');
    expect(st.d).toBe('eliminated');
    // compensate the only goal of b-c: becomes a draw
    const sc = await call(ctx.app, 'GET', `/audit/v1/score/${id}-2`);
    const goal = sc.body.events.find((e: any) => e.type === 'score');
    expect((await ev(`${id}-2`, 'compensation', { compensates: goal.event_id })).status).toBe(201);
    s = await standings(id);
    const b = s.body.table.find((t: any) => t.team_id === 'b');
    expect(b).toMatchObject({ drawn: 1, lost: 1, points: 1 });
    expect(s.body.h2h.b.c).toEqual({ played: 1, points: 1, scored: 0, conceded: 0 });
  });

  it('falls through fair play and draw lots with a custom order', async () => {
    const id = uniq('lgfp');
    const fixtures = [{ match_id: `${id}-1`, home: 'x', away: 'y' }];
    await league({ league_id: id, sport_id: 'football', teams: ['x', 'y'], fixtures, qualification: { spots: 1 }, tie_break_order: ['fair_play', 'draw_lots'] });
    await play(`${id}-1`, 'x', 'y', 1, 1, [['discipline', { team_id: 'x', points: -3 }]]);
    const s = await standings(id);
    expect(s.body.table[0]).toMatchObject({ team_id: 'y', resolved_by: 'fair_play' });
    const id2 = uniq('lglots');
    await league({ league_id: id2, sport_id: 'football', teams: ['x', 'y'], fixtures: [{ match_id: `${id2}-1`, home: 'x', away: 'y' }], qualification: { spots: 1 } });
    await play(`${id2}-1`, 'x', 'y', 0, 0);
    const lots = await standings(id2);
    expect(lots.body.table[0].resolved_by).toBe('draw_lots');
  });

  it('cricket leagues use net run rate for diff', async () => {
    const id = uniq('lgcr');
    await league({ league_id: id, sport_id: 'cricket', teams: ['p', 'q'], fixtures: [{ match_id: `${id}-1`, home: 'p', away: 'q' }], qualification: { spots: 1 } });
    const m = `${id}-1`;
    await ev(m, 'match_start');
    for (const t of ['six', 'four', 'single']) await ev(m, 'score', { team_id: 'p', event_type: t });
    for (let i = 0; i < 10; i++) await ev(m, 'score', { team_id: 'q', event_type: 'wicket' });
    await ev(m, 'match_end');
    const s = await standings(id);
    expect(s.status).toBe(200);
    const p = s.body.table.find((t: any) => t.team_id === 'p');
    // p: 11 runs off 3 balls (0.5 overs); q all out -> counted as full 20 overs, 0 runs
    expect(p.diff).toBeCloseTo(22, 3);
    expect(p.status).toBe('clinched');
  });

  it('basketball leagues count tiebreak winners as wins', async () => {
    const id = uniq('lgbb');
    await league({ league_id: id, sport_id: 'basketball', teams: ['u', 'v'], fixtures: [{ match_id: `${id}-1`, home: 'u', away: 'v' }], qualification: { spots: 1 } });
    const m = `${id}-1`;
    await ev(m, 'match_start');
    await ev(m, 'tiebreak_winner', { team_id: 'v' });
    await ev(m, 'match_end');
    const s = await standings(id);
    expect(s.body.table[0]).toMatchObject({ team_id: 'v', won: 1, points: 3 });
  });
});
