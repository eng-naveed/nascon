import { describe, expect, it } from 'vitest';
import { computeStandings, Played } from '../src/features/standings/compute';
import { BASELINE_SPORTS } from '../src/features/sports/service';
import { lotsKey } from '../src/core/crypto';

const fb = BASELINE_SPORTS.find((s) => s.sport_id === 'football')!;
const cr = BASELINE_SPORTS.find((s) => s.sport_id === 'cricket')!;
const P = { win: 3, draw: 1, loss: 0 };
const ORDER = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const rec = (home: string, away: string, hs: number, as: number, extra: Partial<Played> = {}): Played => ({
  home, away, hs, as, hFair: 0, aFair: 0, hBalls: 0, hWk: 0, aBalls: 0, aWk: 0,
  outcome: hs > as ? 'home_win' : hs < as ? 'away_win' : 'draw', ...extra,
});
const run = (teams: string[], plays: Played[], remaining: [string, string][] = [], extra: any = {}) =>
  computeStandings({
    league_id: 'lg', sport: fb, teams, points: P, tieBreakOrder: ORDER, spots: 1, lotsSeed: 42,
    fixtures: [...plays.map((p) => ({ home: p.home, away: p.away, played: p })), ...remaining.map(([home, away]) => ({ home, away, played: null }))], ...extra,
  });

describe('standings', () => {
  it('computes basic table and h2h', () => {
    const r = run(['a', 'b', 'c'], [rec('a', 'b', 2, 1), rec('b', 'c', 1, 1), rec('c', 'a', 0, 3)]);
    expect(r.table.map((t) => t.team_id)).toEqual(['a', 'b', 'c']);
    expect(r.table[0]).toMatchObject({ played: 2, won: 2, points: 6, scored: 5, conceded: 1, diff: 4, rank: 1 });
    expect(r.h2h.a.b).toEqual({ played: 1, points: 3, scored: 2, conceded: 1 });
    expect(r.h2h.b.a).toEqual({ played: 1, points: 0, scored: 1, conceded: 2 });
    expect(r.h2h.a.a).toBeUndefined();
  });
  it('resolves a 3-way tie with the head-to-head mini league', () => {
    // a beats b, b beats c, c beats a: all on 3 points; goal differences break the mini-league
    const r = run(['a', 'b', 'c'], [rec('a', 'b', 3, 0), rec('b', 'c', 1, 0), rec('c', 'a', 1, 0)]);
    expect(r.table.map((t) => [t.team_id, t.resolved_by])).toEqual([['a', 'h2h_diff'], ['c', 'h2h_diff'], ['b', null]]);
    expect(r.table.map((t) => t.team_id)).toEqual(['a', 'c', 'b']);
  });
  it('recurses into sub-groups after a split', () => {
    // a,b,c,d all on 3 points; overall_diff splits {a,b} (+2) from {c,d} (-2), then each pair is re-resolved
    const r = run(['a', 'b', 'c', 'd'], [rec('a', 'c', 2, 0), rec('b', 'd', 2, 0), rec('c', 'b', 1, 0), rec('d', 'a', 1, 0)], [], { tieBreakOrder: ['overall_diff'] });
    expect(r.table.map((t) => t.team_id).slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(r.table[1].resolved_by).toBe('overall_diff');
    expect(['draw_lots']).toContain(r.table[0].resolved_by);
  });
  it('falls through scored, fair play and draw lots', () => {
    const lots = run(['a', 'b'], [rec('a', 'b', 1, 1)]);
    const keys = ['a', 'b'].sort((x, y) => (lotsKey(42, 'lg', x) < lotsKey(42, 'lg', y) ? -1 : 1));
    expect(lots.table.map((t) => t.team_id)).toEqual(keys);
    expect(lots.table[0].resolved_by).toBe('draw_lots');
    const fair = run(['a', 'b'], [rec('a', 'b', 1, 1, { hFair: -3, aFair: 0 })], [], { tieBreakOrder: ['fair_play'] });
    expect(fair.table[0].team_id).toBe('b');
    expect(fair.table[0].resolved_by).toBe('fair_play');
    const scored = run(['a', 'b', 'c', 'd'], [rec('a', 'c', 2, 2), rec('b', 'd', 1, 1)], [], { tieBreakOrder: ['scored'] });
    expect(scored.table.slice(0, 2).map((t) => t.team_id).sort()).toEqual(['a', 'c']);
    const od = run(['a', 'b', 'c', 'd'], [rec('a', 'c', 3, 3), rec('b', 'd', 1, 1)], [], { tieBreakOrder: ['overall_diff', 'scored'] });
    expect(od.table[1].resolved_by).toBe('scored');
  });
  it('qualification status', () => {
    const clinched = run(['a', 'b', 'c'], [rec('a', 'b', 1, 0), rec('a', 'c', 1, 0)], [['b', 'c']]);
    expect(clinched.table.find((t) => t.team_id === 'a')!.status).toBe('clinched');
    const t = clinched.table.reduce((m, x) => ({ ...m, [x.team_id]: x.status }), {} as any);
    expect(t.b).toBe('eliminated');
    const elim = run(['a', 'b', 'c'], [rec('a', 'b', 1, 0), rec('a', 'c', 1, 0), rec('b', 'c', 1, 0)]);
    expect(elim.table.find((x) => x.team_id === 'c')!.status).toBe('eliminated');
    expect(run(['a', 'b'], [], [['a', 'b']]).table[0].status).toBe('still_possible');
  });
  it('net run rate for innings sports', () => {
    const plays: Played[] = [
      { ...rec('a', 'b', 120, 100), hBalls: 120, hWk: 4, aBalls: 120, aWk: 10 },
    ];
    const r = computeStandings({ league_id: 'lg', sport: cr, teams: ['a', 'b'], points: P, tieBreakOrder: ORDER, spots: 1, lotsSeed: 42, fixtures: [{ home: 'a', away: 'b', played: plays[0] }] });
    // a: 120/20 - 100/20 = 1 ; b: all out counts as 20 overs
    expect(r.table[0]).toMatchObject({ team_id: 'a', diff: 1 });
    expect(r.table[1].diff).toBe(-1);
    const empty = computeStandings({ league_id: 'lg', sport: cr, teams: ['a', 'b'], points: P, tieBreakOrder: ORDER, spots: 1, lotsSeed: 42, fixtures: [] });
    expect(empty.table[0].diff).toBe(0);
  });
});
