import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('fixtures');
});
afterAll(async () => ctx.close());

const names = (n: number) => Array.from({ length: n }, (_, i) => 't' + (i + 1));
const fx = (format: string, teams: unknown, params?: unknown) => call(ctx.app, 'POST', '/audit/v1/fixtures', params === undefined ? { format, teams } : { format, teams, params });
const err400 = async (p: Promise<any>, field?: string) => {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(400);
  expect(r.body.error.code).toBe('VALIDATION_ERROR');
  if (field) expect(r.body.error.details.fields).toContain(field);
};

describe('POST /audit/v1/fixtures round_robin', () => {
  it('single and double leg schedules cover every pair, odd counts get one bye per round', async () => {
    for (const n of [4, 5]) {
      const r = await fx('round_robin', names(n), { legs: 2 });
      expect(r.status).toBe(200);
      const perLeg = n % 2 ? n : n - 1;
      expect(r.body.round_count).toBe(perLeg * 2);
      const ordered = new Set<string>();
      for (const rd of r.body.rounds) {
        expect(rd.byes.length).toBe(n % 2);
        for (const m of rd.matches) ordered.add(m.home + '>' + m.away);
      }
      expect(ordered.size).toBe(n * (n - 1));
    }
    const one = await fx('round_robin', names(4), null);
    expect(one.body.rounds[0].matches[0].match_id).toBe('RR-L1-R1-M1');
  });
  it('withdrawals with forfeit_remaining (default) and void_all', async () => {
    const f = await fx('round_robin', names(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
    expect(f.body.summary).toEqual({ total: 10, scheduled: 8, forfeit: 2, voided: 0 });
    const v = await fx('round_robin', names(5), { withdrawals: [{ team_id: 't3', after_round: 2 }], withdrawal_policy: 'void_all' });
    expect(v.body.summary).toEqual({ total: 10, scheduled: 6, forfeit: 0, voided: 4 });
  });
  it('400s', async () => {
    await err400(fx('round_robin', names(41)), 'teams');
    await err400(fx('round_robin', ['a']), 'teams');
    await err400(fx('round_robin', ['a', 'a']), 'teams');
    await err400(fx('round_robin', ['bad|id', 'b']));
    await err400(fx('nope', names(4)), 'format');
    await err400(fx('round_robin', names(4), { legs: 3 }), 'params.legs');
    await err400(fx('round_robin', names(4), { legs: 'two' }), 'params.legs');
    await err400(fx('round_robin', names(4), { withdrawals: [{ team_id: 'zz', after_round: 1 }] }), 'params.withdrawals');
    await err400(fx('round_robin', names(4), { withdrawals: [{ team_id: 't1', after_round: 99 }] }), 'params.withdrawals');
    await err400(fx('round_robin', names(4), { withdrawal_policy: 'maybe' }), 'params.withdrawal_policy');
  });
});

describe('POST /audit/v1/fixtures swiss', () => {
  it('round 1, later rounds with history and standings', async () => {
    const r1 = await fx('swiss', names(5));
    expect(r1.status).toBe(200);
    expect(r1.body.pairings.map((p: any) => [p.home, p.away])).toEqual([['t1', 't3'], ['t2', 't4']]);
    expect(r1.body.bye).toBe('t5');
    const r2 = await fx('swiss', names(5), {
      total_rounds: 3, round: 2,
      history: [{ round: 1, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'draw' }], bye: 't5' }],
    });
    expect(r2.status).toBe(200);
    expect(r2.body.standings.find((s: any) => s.team_id === 't5').score).toBe(1);
    expect(r2.body.bye).toBe('t3');
  });
  it('409 NO_VALID_PAIRING when no rematch-free pairing exists', async () => {
    const history = [
      { round: 1, matches: [{ home: 'a', away: 'b', result: 'home' }, { home: 'c', away: 'd', result: 'away' }] },
      { round: 2, matches: [{ home: 'a', away: 'c', result: 'draw' }, { home: 'b', away: 'd', result: 'home' }] },
    ];
    const ok = await fx('swiss', ['a', 'b', 'c', 'd'], { total_rounds: 3, round: 3, history });
    expect(ok.status).toBe(200);
    const imp = await fx('swiss', ['a', 'b', 'c', 'd'], {
      total_rounds: 3, round: 3,
      history: [
        { round: 1, matches: [{ home: 'a', away: 'b', result: 'home' }, { home: 'c', away: 'd', result: 'home' }] },
        { round: 2, matches: [{ home: 'a', away: 'c', result: 'home' }, { home: 'b', away: 'd', result: 'home' }, { home: 'a', away: 'd', result: 'home' }, { home: 'b', away: 'c', result: 'home' }] },
      ],
    });
    expect(imp.status).toBe(409);
    expect(imp.body.error.code).toBe('NO_VALID_PAIRING');
  });
  it('400s', async () => {
    await err400(fx('swiss', names(4), { total_rounds: 4 }), 'params.total_rounds');
    await err400(fx('swiss', names(4), { round: 5 }), 'params.round');
    await err400(fx('swiss', names(4), { round: 2, history: [{ round: 1, matches: [{ home: 'zz', away: 't1', result: 'home' }] }] }), 'params.history');
    await err400(fx('swiss', names(4), { round: 2, history: [{ round: 1, matches: [], bye: 'zz' }] }), 'params.history');
    await err400(fx('swiss', names(4), { total_rounds: 3, round: 3, history: [] }), 'params.history');
    await err400(fx('swiss', names(65)), 'teams');
    await err400(fx('swiss', names(4), { history: 'x' }), 'params.history');
  });
});

describe('POST /audit/v1/fixtures single_elim', () => {
  it('seeds byes and propagates results incl. third place match', async () => {
    const r = await fx('single_elim', names(6));
    expect(r.status).toBe(200);
    expect(r.body.rounds[0].matches[0]).toMatchObject({ home: 't1', away: null, bye: true, winner: 't1' });
    const tp = await fx('single_elim', names(4), {
      third_place_match: true, results: [{ match_id: 'R1M1', winner: 't4' }, { match_id: 'R1M2', winner: 't2' }, { match_id: 'R2M1', winner: 't2' }],
    });
    expect(tp.body.rounds[1].matches[0]).toMatchObject({ winner: 't2', loser: 't4' });
    expect(tp.body.third_place).toMatchObject({ match_id: 'TP', home: 't1' });
  });
  it('400s', async () => {
    await err400(fx('single_elim', names(4), { results: [{ match_id: 'R9M9', winner: 't1' }] }), 'params.results');
    await err400(fx('single_elim', names(4), { results: [{ match_id: 'R1M1', winner: 't3' }] }), 'params.results');
    await err400(fx('single_elim', names(4), { results: [{ match_id: 'R2M1', winner: 't1' }] }), 'params.results');
    await err400(fx('single_elim', names(129)), 'teams');
    await err400(fx('single_elim', names(4), { third_place_match: 'yes' }), 'params.third_place_match');
  });
});

describe('POST /audit/v1/fixtures double_elim', () => {
  it('builds winners/losers brackets and handles the grand-final reset', async () => {
    const plain = await fx('double_elim', names(5));
    expect(plain.status).toBe(200);
    expect(plain.body.losers.flatMap((x: any) => x.matches).length).toBe(plain.body.bracket_size - 2);
    expect(plain.body.grand_final.length).toBe(1);
    const route = [
      { match_id: 'WR1M1', winner: 't1' }, { match_id: 'WR1M2', winner: 't2' }, { match_id: 'LR1M1', winner: 't4' },
      { match_id: 'WR2M1', winner: 't1' }, { match_id: 'LR2M1', winner: 't4' },
    ];
    const open = await fx('double_elim', names(4), { bracket_reset: true, results: route });
    expect(open.body.grand_final[1].required).toBeNull();
    const lb = await fx('double_elim', names(4), { bracket_reset: true, results: [...route, { match_id: 'GF1', winner: 't4' }, { match_id: 'GF2', winner: 't1' }] });
    expect(lb.body.grand_final[1]).toMatchObject({ required: true, conditional: true, home: 't1', away: 't4', winner: 't1' });
    const wb = await fx('double_elim', names(4), { bracket_reset: true, results: [...route, { match_id: 'GF1', winner: 't1' }] });
    expect(wb.body.grand_final[1].required).toBe(false);
    await err400(fx('double_elim', names(4), { bracket_reset: true, results: [...route, { match_id: 'GF1', winner: 't1' }, { match_id: 'GF2', winner: 't1' }] }), 'params.results');
  });
  it('400s', async () => {
    await err400(fx('double_elim', names(2)), 'teams');
    await err400(fx('double_elim', 'abc'), 'teams');
  });
});
