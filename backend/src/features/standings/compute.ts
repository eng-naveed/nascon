import { lotsKey } from '../../core/crypto';
import type { SportConfig } from '../events/projection';

export interface Played {
  home: string;
  away: string;
  hs: number;
  as: number;
  hFair: number;
  aFair: number;
  hBalls: number;
  hWk: number;
  aBalls: number;
  aWk: number;
  outcome: 'home_win' | 'away_win' | 'draw';
}

export interface StandingsInput {
  league_id: string;
  sport: SportConfig;
  teams: string[];
  points: { win: number; draw: number; loss: number };
  tieBreakOrder: string[];
  spots: number;
  lotsSeed: number;
  fixtures: { home: string; away: string; played: Played | null }[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function computeStandings(inp: StandingsInput) {
  const { sport, teams, points } = inp;
  const innings = sport.scoring_model === 'innings';
  const ipt = sport.periods?.innings_per_team ?? 1;
  const opi = sport.periods?.overs_per_innings ?? 20;
  const bpo = sport.periods?.balls_per_over ?? 6;
  const wpi = sport.periods?.wickets_per_innings ?? 10;
  const oversOf = (balls: number, wk: number) => (wk >= ipt * wpi ? ipt * opi : balls / bpo);

  const side = (p: Played, team: string) =>
    p.home === team
      ? { f: p.hs, c: p.as, fair: p.hFair, of: oversOf(p.hBalls, p.hWk), ob: oversOf(p.aBalls, p.aWk), pts: p.outcome === 'home_win' ? 'w' : p.outcome === 'draw' ? 'd' : 'l' }
      : { f: p.as, c: p.hs, fair: p.aFair, of: oversOf(p.aBalls, p.aWk), ob: oversOf(p.hBalls, p.hWk), pts: p.outcome === 'away_win' ? 'w' : p.outcome === 'draw' ? 'd' : 'l' };

  const diffOver = (team: string, recs: Played[]) => {
    let f = 0;
    let c = 0;
    let of = 0;
    let ob = 0;
    for (const p of recs) {
      if (p.home !== team && p.away !== team) continue;
      const s = side(p, team);
      f += s.f;
      c += s.c;
      of += s.of;
      ob += s.ob;
    }
    if (innings) return round3((of > 0 ? f / of : 0) - (ob > 0 ? c / ob : 0));
    return f - c;
  };
  const ptsOver = (team: string, recs: Played[]) => {
    let pt = 0;
    for (const p of recs) {
      if (p.home !== team && p.away !== team) continue;
      const r = side(p, team).pts;
      pt += r === 'w' ? points.win : r === 'd' ? points.draw : points.loss;
    }
    return pt;
  };

  const played = inp.fixtures.filter((f) => f.played).map((f) => f.played!);
  const stats = new Map<string, any>();
  for (const t of teams) {
    let won = 0;
    let drawn = 0;
    let lost = 0;
    let scored = 0;
    let conceded = 0;
    let fair = 0;
    let pl = 0;
    for (const p of played) {
      if (p.home !== t && p.away !== t) continue;
      pl++;
      const s = side(p, t);
      if (s.pts === 'w') won++;
      else if (s.pts === 'd') drawn++;
      else lost++;
      scored += s.f;
      conceded += s.c;
      fair += s.fair;
    }
    stats.set(t, {
      team_id: t,
      played: pl,
      won,
      drawn,
      lost,
      scored,
      conceded,
      diff: diffOver(t, played),
      points: won * points.win + drawn * points.draw + lost * points.loss,
      fair_play: fair,
    });
  }

  const order = inp.tieBreakOrder.includes('draw_lots') ? inp.tieBreakOrder : [...inp.tieBreakOrder, 'draw_lots'];

  // returns ordered teams and the criterion separating each adjacent pair
  const resolve = (group: string[]): { order: string[]; sep: (string | null)[] } => {
    if (group.length <= 1) return { order: group, sep: [] };
    const recs = played.filter((p) => group.includes(p.home) && group.includes(p.away));
    for (const crit of order) {
      const val = (t: string): number | string => {
        switch (crit) {
          case 'h2h_points':
            return ptsOver(t, recs);
          case 'h2h_diff':
            return diffOver(t, recs);
          case 'overall_diff':
            return stats.get(t).diff;
          case 'scored':
            return stats.get(t).scored;
          case 'fair_play':
            return stats.get(t).fair_play;
          default:
            return lotsKey(inp.lotsSeed, inp.league_id, t);
        }
      };
      const vals = new Map(group.map((t) => [t, val(t)]));
      const distinct = new Set(vals.values());
      if (distinct.size === 1) continue;
      const sorted = [...distinct].sort((x, y) => {
        if (crit === 'draw_lots') return x < y ? -1 : x > y ? 1 : 0;
        return (y as number) - (x as number);
      });
      const out: string[] = [];
      const sep: (string | null)[] = [];
      sorted.forEach((v, gi) => {
        const sub = group.filter((t) => vals.get(t) === v);
        const r = resolve(sub);
        if (gi > 0) sep.push(crit);
        out.push(...r.order);
        sep.push(...r.sep);
      });
      return { order: out, sep };
    }
    return { order: group, sep: group.slice(1).map(() => null) };
  };

  const byPoints = new Map<number, string[]>();
  for (const t of teams) {
    const p = stats.get(t).points;
    if (!byPoints.has(p)) byPoints.set(p, []);
    byPoints.get(p)!.push(t);
  }
  const final: string[] = [];
  const resolvedBy: (string | null)[] = [];
  for (const p of [...byPoints.keys()].sort((a, b) => b - a)) {
    const r = resolve(byPoints.get(p)!);
    final.push(...r.order);
    resolvedBy.push(...r.sep, null);
  }

  const remaining = new Map(teams.map((t) => [t, 0]));
  for (const f of inp.fixtures)
    if (!f.played) {
      remaining.set(f.home, remaining.get(f.home)! + 1);
      remaining.set(f.away, remaining.get(f.away)! + 1);
    }
  const W = points.win;
  const maxP = (t: string) => stats.get(t).points + W * remaining.get(t)!;
  const k = inp.spots;
  const table = final.map((t, i) => {
    const me = stats.get(t);
    const others = teams.filter((x) => x !== t);
    let status = 'still_possible';
    if (others.filter((x) => maxP(x) >= me.points).length < k) status = 'clinched';
    else if (others.filter((x) => stats.get(x).points > maxP(t)).length >= k) status = 'eliminated';
    return { rank: i + 1, ...me, status, resolved_by: resolvedBy[i] ?? null };
  });

  const h2h: Record<string, Record<string, any>> = {};
  for (const a of teams) {
    h2h[a] = {};
    for (const b of teams) {
      if (a === b) continue;
      const recs = played.filter((p) => (p.home === a && p.away === b) || (p.home === b && p.away === a));
      let sc = 0;
      let co = 0;
      for (const p of recs) {
        const s = side(p, a);
        sc += s.f;
        co += s.c;
      }
      h2h[a][b] = { played: recs.length, points: ptsOver(a, recs), scored: sc, conceded: co };
    }
  }
  return { league_id: inp.league_id, sport_id: sport.sport_id, qualification_spots: k, table, h2h };
}
