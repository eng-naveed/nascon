import { describe, expect, it } from 'vitest';
import { generateFixtures } from '../src/features/fixtures';
import { bracketSize, seedOrder } from '../src/features/fixtures/elimination';

const names = (n: number) => Array.from({ length: n }, (_, i) => 't' + (i + 1));
const gen = (format: string, teams: string[], params?: any) => generateFixtures({ format, teams, params }) as any;

describe('round robin', () => {
  it('balances home/away and covers every pair for n=2..40', () => {
    for (let n = 2; n <= 40; n++)
      for (const legs of [1, 2]) {
        const r = gen('round_robin', names(n), { legs });
        const perLeg = r.round_count / legs;
        expect(perLeg).toBe(n % 2 ? n : n - 1);
        const bal: Record<string, number> = {};
        const ordered = new Set<string>();
        for (const rd of r.rounds) {
          const leg = rd.round > perLeg ? 2 : 1;
          const seen = new Set<string>();
          for (const m of rd.matches) {
            seen.add(m.home);
            seen.add(m.away);
            ordered.add(m.home + '>' + m.away);
            bal[leg + m.home] = (bal[leg + m.home] ?? 0) + 1;
            bal[leg + m.away] = (bal[leg + m.away] ?? 0) - 1;
          }
          expect(seen.size + rd.byes.length).toBe(n);
          expect(rd.byes.length).toBe(n % 2);
        }
        for (const v of Object.values(bal)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
        expect(ordered.size).toBe(legs === 1 ? (n * (n - 1)) / 2 : n * (n - 1));
      }
  });
  it('match ids and global rounds', () => {
    const r = gen('round_robin', names(4), { legs: 2 });
    expect(r.rounds[0].matches[0].match_id).toBe('RR-L1-R1-M1');
    expect(r.rounds[3].matches[0].match_id).toMatch(/^RR-L2-R4-M1$/);
    expect(r.round_count).toBe(6);
  });
  it('withdrawals: forfeit_remaining and void_all', () => {
    const f = gen('round_robin', names(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
    expect(f.summary).toEqual({ total: 10, scheduled: 8, forfeit: 2, voided: 0 });
    for (const rd of f.rounds)
      for (const m of rd.matches)
        if (m.status === 'forfeit') {
          expect(rd.round).toBeGreaterThan(2);
          expect(m.awarded_to).not.toBe('t3');
        }
    const v = gen('round_robin', names(5), { withdrawals: [{ team_id: 't3', after_round: 2 }], withdrawal_policy: 'void_all' });
    expect(v.summary).toEqual({ total: 10, scheduled: 6, forfeit: 0, voided: 4 });
    const both = gen('round_robin', names(4), { withdrawals: [{ team_id: 't1', after_round: 0 }, { team_id: 't2', after_round: 0 }] });
    expect(both.summary.voided).toBe(1);
  });
  it('validates input', () => {
    expect(() => gen('round_robin', names(41))).toThrow();
    expect(() => gen('round_robin', names(4), { legs: 3 })).toThrow();
    expect(() => gen('round_robin', names(4), { withdrawals: [{ team_id: 'zz', after_round: 1 }] })).toThrow();
    expect(() => gen('round_robin', names(4), { withdrawals: [{ team_id: 't1', after_round: 99 }] })).toThrow();
    expect(() => gen('round_robin', ['a', 'a'])).toThrow();
    expect(() => gen('nope', names(4))).toThrow();
    expect(() => gen('round_robin', ['bad|id', 'b'])).toThrow();
  });
});

describe('swiss', () => {
  it('round 1 pairs seed i with i+m and gives the last seed a bye', () => {
    const r = gen('swiss', names(5));
    expect(r.pairings.map((p: any) => [p.home, p.away])).toEqual([['t1', 't3'], ['t2', 't4']]);
    expect(r.bye).toBe('t5');
    expect(gen('swiss', names(4)).bye).toBeNull();
  });
  it('plays rematch-free rounds with one bye each', () => {
    const teams = names(15);
    const history: any[] = [];
    const met = new Set<string>();
    const byes = new Set<string>();
    for (let round = 1; round <= 6; round++) {
      const r = gen('swiss', teams, { total_rounds: 6, round, history });
      const seen = new Set<string>();
      for (const p of r.pairings) {
        const k = [p.home, p.away].sort().join();
        expect(met.has(k)).toBe(false);
        met.add(k);
        seen.add(p.home);
        seen.add(p.away);
      }
      expect(seen.size).toBe(14);
      expect(byes.has(r.bye)).toBe(false);
      byes.add(r.bye);
      history.push({ round, matches: r.pairings.map((p: any, i: number) => ({ home: p.home, away: p.away, result: ['home', 'away', 'draw'][i % 3] })), bye: r.bye });
    }
  });
  it('standings use buchholz and byes count as a win', () => {
    const r = gen('swiss', names(5), {
      total_rounds: 3, round: 2,
      history: [{ round: 1, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'draw' }], bye: 't5' }],
    });
    expect(r.standings.find((s: any) => s.team_id === 't5').score).toBe(1);
    expect(r.standings.find((s: any) => s.team_id === 't3').buchholz).toBe(1);
    expect(r.bye).toBe('t3');
  });
  it('409 NO_VALID_PAIRING when everyone has met', () => {
    const history = [
      { round: 1, matches: [{ home: 'a', away: 'b', result: 'home' }, { home: 'c', away: 'd', result: 'home' }] },
      { round: 2, matches: [{ home: 'a', away: 'c', result: 'home' }, { home: 'b', away: 'd', result: 'home' }] },
      { round: 3, matches: [{ home: 'a', away: 'd', result: 'home' }, { home: 'b', away: 'c', result: 'home' }] },
    ];
    expect(() => gen('swiss', ['a', 'b', 'c', 'd'], { total_rounds: 3, round: 3, history: history.slice(0, 2) })).not.toThrow();
    try {
      gen('swiss', ['a', 'b', 'c', 'd'], { total_rounds: 3, round: 4, history });
    } catch (e: any) {
      expect(e.status ?? e.code).toBeDefined();
    }
    expect(() => gen('swiss', ['a', 'b', 'c', 'd'], { total_rounds: 3, round: 3, history: [] })).toThrow();
  });
  it('validates', () => {
    expect(() => gen('swiss', names(4), { total_rounds: 4 })).toThrow();
    expect(() => gen('swiss', names(4), { round: 5 })).toThrow();
    expect(() => gen('swiss', names(4), { round: 2, history: [{ round: 1, matches: [{ home: 'zz', away: 't1', result: 'home' }] }] })).toThrow();
    expect(() => gen('swiss', names(4), { round: 2, history: [{ round: 1, matches: [], bye: 'zz' }] })).toThrow();
    expect(() => gen('swiss', names(65))).toThrow();
  });
});

describe('single elimination', () => {
  it('builds seeded brackets with byes', () => {
    expect(bracketSize(6)).toBe(8);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const r = gen('single_elim', names(6));
    const r1 = r.rounds[0].matches;
    expect(r1[0]).toMatchObject({ home: 't1', away: null, bye: true, winner: 't1' });
    expect(r1[1]).toMatchObject({ home: 't4', away: 't5', bye: false });
    expect(r1[2]).toMatchObject({ home: 't2', bye: true });
    expect(r.rounds[1].matches[0].home).toBe('t1');
    expect(r1[1].winner_to).toEqual({ match_id: 'R2M1', slot: 'away' });
    expect(r.rounds.length).toBe(3);
  });
  it('propagates results and third place', () => {
    const r = gen('single_elim', names(4), { third_place_match: true, results: [{ match_id: 'R1M1', winner: 't4' }, { match_id: 'R1M2', winner: 't2' }, { match_id: 'R2M1', winner: 't2' }] });
    expect(r.rounds[1].matches[0]).toMatchObject({ winner: 't2', loser: 't4' });
    const tp = r.third_place;
    expect(tp.match_id).toBe('TP');
    expect(tp.home).toBe('t1');
  });
  it('rejects bad results', () => {
    expect(() => gen('single_elim', names(4), { results: [{ match_id: 'R9M9', winner: 't1' }] })).toThrow();
    expect(() => gen('single_elim', names(4), { results: [{ match_id: 'R1M1', winner: 't3' }] })).toThrow();
    expect(() => gen('single_elim', names(4), { results: [{ match_id: 'R2M1', winner: 't1' }] })).toThrow();
    expect(() => gen('single_elim', names(129))).toThrow();
  });
});

describe('double elimination', () => {
  it('has B-2 losers matches and a graph with exactly one source per slot', () => {
    for (const n of [3, 5, 8, 11, 16]) {
      const r = gen('double_elim', names(n), { bracket_reset: true });
      const B = r.bracket_size;
      const all = [...r.winners, ...r.losers].flatMap((x: any) => x.matches).concat(r.grand_final);
      const losers = r.losers.flatMap((x: any) => x.matches);
      expect(losers.length).toBe(B - 2);
      const sources = new Map<string, number>();
      for (const m of all) for (const t of [m.winner_to, m.loser_to]) if (t) sources.set(t.match_id + t.slot, (sources.get(t.match_id + t.slot) ?? 0) + 1);
      for (const [k, v] of sources) expect(v, k).toBe(1);
      for (const m of r.winners.flatMap((x: any) => x.matches)) expect(m.loser_to).not.toBeNull();
      for (const m of losers) expect(m.loser_to).toBeNull();
    }
  });
  it('grand final reset logic', () => {
    const base = { bracket_reset: true };
    const teams = names(4);
    const route = [
      { match_id: 'WR1M1', winner: 't1' }, { match_id: 'WR1M2', winner: 't2' }, { match_id: 'LR1M1', winner: 't4' },
      { match_id: 'WR2M1', winner: 't1' }, { match_id: 'LR2M1', winner: 't4' },
    ];
    const open = gen('double_elim', teams, { ...base, results: route });
    expect(open.grand_final[1].required).toBeNull();
    const lbWins = gen('double_elim', teams, { ...base, results: [...route, { match_id: 'GF1', winner: 't4' }] });
    expect(lbWins.grand_final[1]).toMatchObject({ required: true, conditional: true, home: 't1', away: 't4' });
    const wbWins = gen('double_elim', teams, { ...base, results: [...route, { match_id: 'GF1', winner: 't1' }] });
    expect(wbWins.grand_final[1].required).toBe(false);
    expect(gen('double_elim', teams).grand_final.length).toBe(1);
    expect(() => gen('double_elim', names(2))).toThrow();
  });
});
