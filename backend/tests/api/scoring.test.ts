import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx, SALT, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('scoring');
});
afterAll(async () => ctx.close());

const ev = (event_id: string, match_id: string, type: string, payload?: unknown) =>
  call(ctx.app, 'POST', '/audit/v1/events', payload === undefined ? { event_id, match_id, type } : { event_id, match_id, type, payload });
const score = (id: string) => call(ctx.app, 'GET', `/audit/v1/score/${id}`);

/** creates a match for sport and returns ids + an event helper with unique event ids */
async function newMatch(sport: string, extra: Record<string, unknown> = {}) {
  const m = uniq('m');
  const home = uniq('h');
  const away = uniq('a');
  const r = await ev(uniq('e'), m, 'match_init', { sport_id: sport, home_team_id: home, away_team_id: away, ...extra });
  expect(r.status).toBe(201);
  const e = (type: string, payload?: unknown) => ev(uniq('e'), m, type, payload);
  return { m, home, away, e };
}

describe('sports', () => {
  const eventSport = (id: string) => ({
    sport_id: id, name: 'Hockey', scoring_model: 'event', periods: { count: 3, duration_minutes: 20 }, scoring_events: { goal: { points: 1 } },
    draw_allowed: true, overtime: { policy: 'shootout' }, roster: { min_squad_size: 6, max_squad_size: 20, required_positions: { goalie: 1 } },
  });
  it('creates an event-model sport and fills the default tie-break order', async () => {
    const r = await call(ctx.app, 'POST', '/audit/v1/sports', eventSport('hockey'));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ sport_id: 'hockey', status: 'created' });
    expect(r.body.config.tie_break_order).toEqual(['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots']);
  });
  it('creates innings and round model sports with explicit tie-break order', async () => {
    const inn = await call(ctx.app, 'POST', '/audit/v1/sports', {
      sport_id: 'baseball_lite', name: 'Baseball', scoring_model: 'innings', draw_allowed: false, overtime: { policy: 'extra_time', duration_minutes: 0 },
      periods: { innings_per_team: 2, overs_per_innings: 3, balls_per_over: 3, wickets_per_innings: 3 },
      scoring_events: { hit: { runs: 1, legal_ball: true, wicket: false }, out: { runs: 0, legal_ball: true, wicket: true } },
      tie_break_order: ['scored', 'draw_lots'], roster: { min_squad_size: 9, max_squad_size: 9, required_positions: {} },
    });
    expect(inn.status).toBe(201);
    expect(inn.body.config.tie_break_order).toEqual(['scored', 'draw_lots']);
    const rnd = await call(ctx.app, 'POST', '/audit/v1/sports', {
      sport_id: 'chess-bo5', name: 'Chess', scoring_model: 'round', draw_allowed: false, overtime: { policy: 'golden_score' },
      periods: { best_of: 5 }, scoring_events: { game_win: { rounds: 1 } }, roster: { min_squad_size: 1, max_squad_size: 4, required_positions: {} },
    });
    expect(rnd.status).toBe(201);
  });
  it('rejects a duplicate sport with 409 SPORT_EXISTS', async () => {
    const r = await call(ctx.app, 'POST', '/audit/v1/sports', eventSport('football'));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SPORT_EXISTS');
  });
  it('rejects invalid sports with 400 VALIDATION_ERROR', async () => {
    const cases: [unknown, string][] = [
      [{ ...eventSport('x1'), scoring_model: 'weird' }, 'scoring_model'],
      [[1, 2], 'scoring_model'],
      [{ ...eventSport('X Bad') }, 'sport_id'],
      [{ ...eventSport('x2'), scoring_events: {} }, 'scoring_events'],
      [{ ...eventSport('x3'), tie_break_order: ['scored', 'scored'] }, 'tie_break_order'],
      [{ ...eventSport('x4'), roster: { min_squad_size: 5, max_squad_size: 2, required_positions: {} } }, 'roster'],
      [{ ...eventSport('x5'), scoring_model: 'round', periods: { best_of: 4 }, scoring_events: { w: { rounds: 1 } } }, 'periods'],
      [{ ...eventSport('x6'), scoring_model: 'innings' }, 'periods'],
    ];
    for (const [b, field] of cases) {
      const r = await call(ctx.app, 'POST', '/audit/v1/sports', b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details.fields).toContain(field);
    }
  });
});

describe('events: football (event model, draws allowed)', () => {
  it('runs the full lifecycle with every error code and an idempotent replay', async () => {
    const m = uniq('fb');
    const init = { sport_id: 'football', home_team_id: 'H', away_team_id: 'A' };
    const first = await ev(`${m}-1`, m, 'match_init', init);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ event_id: `${m}-1`, match_id: m, type: 'match_init', sequence: 1, match_version: 1 });
    expect(first.body.signature).toBe(ctx.crypto.sign(SALT, `${m}-1`, init));

    const replay = await ev(`${m}-1`, m, 'match_init', init);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const dup = await ev(`${m}-1`, m, 'match_init', { ...init, home_team_id: 'X' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EVENT_ID');

    const exists = await ev(`${m}-1b`, m, 'match_init', init);
    expect(exists.status).toBe(409);
    expect(exists.body.error.code).toBe('MATCH_EXISTS');

    const early = await ev(`${m}-2`, m, 'score', { team_id: 'H', event_type: 'goal' });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('MATCH_NOT_IN_PROGRESS');
    const earlyEnd = await ev(`${m}-2b`, m, 'match_end');
    expect(earlyEnd.body.error.code).toBe('ILLEGAL_TRANSITION');
    const earlyDisc = await ev(`${m}-2c`, m, 'discipline', { team_id: 'H', points: 1 });
    expect(earlyDisc.body.error.code).toBe('MATCH_NOT_IN_PROGRESS');

    expect((await ev(`${m}-3`, m, 'match_start')).status).toBe(201);
    const again = await ev(`${m}-3b`, m, 'match_start');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ILLEGAL_TRANSITION');

    const unk = await ev(`${m}-4`, m, 'score', { team_id: 'H', event_type: 'touchdown' });
    expect(unk.status).toBe(400);
    expect(unk.body.error.code).toBe('UNKNOWN_EVENT_TYPE');
    const proto = await ev(`${m}-4b`, m, 'score', { team_id: 'H', event_type: 'toString' });
    expect(proto.body.error.code).toBe('UNKNOWN_EVENT_TYPE');
    const wrongTeam = await ev(`${m}-4c`, m, 'score', { team_id: 'Z', event_type: 'goal' });
    expect(wrongTeam.status).toBe(400);
    expect(wrongTeam.body.error.details.fields).toContain('team_id');
    const badPayload = await ev(`${m}-4d`, m, 'score', { team_id: 'H' });
    expect(badPayload.status).toBe(400);

    const g1 = await ev(`${m}-5`, m, 'score', { team_id: 'H', event_type: 'goal' });
    expect(g1.status).toBe(201);
    expect(g1.body.sequence).toBe(3);
    expect((await ev(`${m}-6`, m, 'score', { team_id: 'A', event_type: 'goal' })).status).toBe(201);
    expect((await ev(`${m}-7`, m, 'discipline', { team_id: 'A', points: -2 })).status).toBe(201);

    // compensation rules
    const missing = await ev(`${m}-8`, m, 'compensation', { compensates: 'no-such-event' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('EVENT_NOT_FOUND');
    const notScorable = await ev(`${m}-8b`, m, 'compensation', { compensates: `${m}-3` });
    expect(notScorable.status).toBe(409);
    expect(notScorable.body.error.code).toBe('INVALID_COMPENSATION');
    const other = await newMatch('football');
    const otherGoal = await other.e('match_start');
    expect(otherGoal.status).toBe(201);
    const foreign = await ev(`${m}-8c`, m, 'compensation', { compensates: otherGoal.body.event_id });
    expect(foreign.body.error.code).toBe('INVALID_COMPENSATION');
    const comp = await ev(`${m}-9`, m, 'compensation', { compensates: `${m}-5`, reason: 'offside' });
    expect(comp.status).toBe(201);
    const twice = await ev(`${m}-9b`, m, 'compensation', { compensates: `${m}-5` });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_COMPENSATION');

    const live = await score(m);
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'in_progress', outcome: 'pending', home: { score: 0 }, away: { score: 1, fair_play: -2 }, version: 6 });
    expect(live.body.events.find((x: any) => x.event_id === `${m}-5`)).toMatchObject({ compensated: true, compensated_by: `${m}-9` });

    expect((await ev(`${m}-10`, m, 'score', { team_id: 'H', event_type: 'goal' })).status).toBe(201);
    const end = await ev(`${m}-11`, m, 'match_end');
    expect(end.status).toBe(201);
    const done = await score(m);
    expect(done.body).toMatchObject({ status: 'completed', outcome: 'draw', winner_team_id: null });
    const after = await ev(`${m}-12`, m, 'match_end');
    expect(after.body.error.code).toBe('ILLEGAL_TRANSITION');
    // compensation after completion is allowed and re-projects the result
    expect((await ev(`${m}-13`, m, 'compensation', { compensates: `${m}-10` })).status).toBe(201);
    expect((await score(m)).body).toMatchObject({ outcome: 'away_win', winner_team_id: 'A' });
  });

  it('validates envelopes and ids', async () => {
    const bad = await call(ctx.app, 'POST', '/audit/v1/events', { event_id: 'e 1', match_id: 'm', type: 'score' });
    expect(bad.status).toBe(400);
    const badType = await call(ctx.app, 'POST', '/audit/v1/events', { event_id: 'e1', match_id: 'm', type: 'goal' });
    expect(badType.body.error.details.fields).toContain('type');
    const same = await ev(uniq('e'), uniq('m'), 'match_init', { sport_id: 'football', home_team_id: 'T', away_team_id: 'T' });
    expect(same.status).toBe(400);
    expect(same.body.error.details.fields).toContain('away_team_id');
    const noSport = await ev(uniq('e'), uniq('m'), 'match_init', { sport_id: 'curling', home_team_id: 'a', away_team_id: 'b' });
    expect(noSport.status).toBe(404);
    expect(noSport.body.error.code).toBe('SPORT_NOT_FOUND');
    const noMatch = await ev(uniq('e'), 'ghost-match', 'match_start');
    expect(noMatch.status).toBe(404);
    expect(noMatch.body.error.code).toBe('MATCH_NOT_FOUND');
    const s404 = await score('ghost-match');
    expect(s404.status).toBe(404);
    expect(s404.body.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('a concurrent duplicate event id on different matches yields exactly one 201', async () => {
    const a = await newMatch('football');
    const b = await newMatch('football');
    await a.e('match_start');
    await b.e('match_start');
    const id = uniq('race');
    const rs = await Promise.all([
      ev(id, a.m, 'score', { team_id: a.home, event_type: 'goal' }),
      ev(id, b.m, 'score', { team_id: b.home, event_type: 'goal' }),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.body.error.code).toBe('DUPLICATE_EVENT_ID');
  });
});

describe('events: basketball (no draws, tiebreak winner)', () => {
  it('refuses a tied end, then accepts it after a tiebreak_winner', async () => {
    const { m, home, away, e } = await newMatch('basketball');
    await e('match_start');
    expect((await e('score', { team_id: home, event_type: 'three_pointer' })).status).toBe(201);
    expect((await e('score', { team_id: away, event_type: 'two_pointer' })).status).toBe(201);
    expect((await e('score', { team_id: away, event_type: 'free_throw' })).status).toBe(201);
    const tie = await e('match_end');
    expect(tie.status).toBe(409);
    expect(tie.body.error.code).toBe('TIE_NOT_ALLOWED');
    const badTb = await e('tiebreak_winner', { team_id: 'nobody' });
    expect(badTb.status).toBe(400);
    expect((await e('tiebreak_winner', { team_id: away })).status).toBe(201);
    expect((await e('match_end')).status).toBe(201);
    const s = await score(m);
    expect(s.body).toMatchObject({ outcome: 'away_win', winner_team_id: away, tiebreak_winner_team_id: away, home: { score: 3, wickets: null, overs: null } });
  });
  it('a decided game ends as home_win', async () => {
    const { m, home, e } = await newMatch('basketball', { league_id: 'some-league' });
    await e('match_start');
    await e('score', { team_id: home, event_type: 'two_pointer' });
    await e('match_end');
    expect((await score(m)).body).toMatchObject({ league_id: 'some-league', outcome: 'home_win' });
  });
});

describe('events: cricket (innings model)', () => {
  it('tracks runs, balls, wickets and refuses scoring once the innings is complete', async () => {
    const { m, home, away, e } = await newMatch('cricket');
    await e('match_start');
    for (const t of ['four', 'six', 'wide', 'no_ball', 'single', 'dot_ball', 'two']) expect((await e('score', { team_id: home, event_type: t })).status).toBe(201);
    let s = await score(m);
    expect(s.body.home).toMatchObject({ score: 15, balls: 5, wickets: 0, overs: '0.5' });
    for (let i = 0; i < 10; i++) expect((await e('score', { team_id: away, event_type: 'wicket' })).status).toBe(201);
    const over = await e('score', { team_id: away, event_type: 'single' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INNINGS_COMPLETE');
    s = await score(m);
    expect(s.body.away).toMatchObject({ score: 0, wickets: 10, balls: 10, overs: '1.4' });
    expect((await e('match_end')).status).toBe(201);
    expect((await score(m)).body.outcome).toBe('home_win');
  });
  it('refuses scoring after all legal balls are bowled', async () => {
    const { m, home, e } = await newMatch('cricket');
    await e('match_start');
    // 20 overs * 6 balls = 120 legal balls
    const body = (i: number) => ({ event_id: `${m}-b${i}`, match_id: m, type: 'score', payload: { team_id: home, event_type: 'dot_ball' } });
    for (let i = 0; i < 120; i++) await call(ctx.app, 'POST', '/audit/v1/events', body(i));
    const r = await e('score', { team_id: home, event_type: 'dot_ball' });
    expect(r.body.error.code).toBe('INNINGS_COMPLETE');
    expect((await score(m)).body.home.overs).toBe('20.0');
  });
});

describe('events: esports (round model, best of 3)', () => {
  it('refuses rounds once the series is decided', async () => {
    const { m, home, away, e } = await newMatch('esports');
    await e('match_start');
    await e('score', { team_id: home, event_type: 'round_win' });
    await e('score', { team_id: away, event_type: 'round_win' });
    await e('score', { team_id: home, event_type: 'round_win' });
    const r = await e('score', { team_id: away, event_type: 'round_win' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SERIES_ALREADY_DECIDED');
    await e('match_end');
    expect((await score(m)).body).toMatchObject({ outcome: 'home_win', home: { score: 2 }, away: { score: 1 } });
  });
  it('an undecided esports end without tiebreak is refused', async () => {
    const { e } = await newMatch('esports');
    await e('match_start');
    const r = await e('match_end');
    expect(r.body.error.code).toBe('TIE_NOT_ALLOWED');
  });
});
