import { validation } from '../../core/errors';

export interface RRParams {
  legs?: number;
  withdrawals?: { team_id: string; after_round: number }[];
  withdrawal_policy?: 'void_all' | 'forfeit_remaining';
}

export interface RRMatch {
  match_id: string;
  leg: number;
  home: string;
  away: string;
  status: 'scheduled' | 'forfeit' | 'voided';
  awarded_to: string | null;
}

/** Circle method pairings for one leg: returns rounds of [i, j] index pairs (j/i may be the dummy index n). */
export function circleRounds(n: number): [number, number][][] {
  const size = n % 2 === 0 ? n : n + 1; // dummy = index n when odd
  const arr = Array.from({ length: size }, (_, i) => i);
  const rounds: [number, number][][] = [];
  for (let r = 0; r < size - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < size / 2; i++) pairs.push([arr[i], arr[size - 1 - i]]);
    rounds.push(pairs);
    // rotate all but the first element
    const last = arr.pop()!;
    arr.splice(1, 0, last);
  }
  return rounds;
}

/** Balanced orientation of the complete graph: |home - away| <= 1 for every team per leg. */
function homeFirst(i: number, j: number, n: number): boolean {
  if (n % 2 === 1) {
    const d = (((j - i) % n) + n) % n;
    return d >= 1 && d <= (n - 1) / 2;
  }
  const d = (((j - i) % n) + n) % n;
  if (d === n / 2) return i < j;
  return d >= 1 && d < n / 2;
}

export function generateRoundRobin(teams: string[], params: RRParams = {}) {
  const n = teams.length;
  const legs = params.legs ?? 1;
  if (legs !== 1 && legs !== 2) throw validation(['params.legs', 'legs']);
  const policy = params.withdrawal_policy ?? 'forfeit_remaining';
  const base = circleRounds(n);
  const perLeg = base.length;
  const roundCount = perLeg * legs;

  const withdrawn = new Map<string, number>();
  for (const w of params.withdrawals ?? []) {
    if (!teams.includes(w.team_id)) throw validation(['params.withdrawals', 'withdrawals']);
    if (!Number.isInteger(w.after_round) || w.after_round < 0 || w.after_round > roundCount)
      throw validation(['params.withdrawals', 'withdrawals']);
    const prev = withdrawn.get(w.team_id);
    withdrawn.set(w.team_id, prev === undefined ? w.after_round : Math.min(prev, w.after_round));
  }

  const rounds: { round: number; matches: RRMatch[]; byes: string[] }[] = [];
  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };

  for (let leg = 1; leg <= legs; leg++) {
    base.forEach((pairs, ri) => {
      const round = (leg - 1) * perLeg + ri + 1;
      const matches: RRMatch[] = [];
      const byes: string[] = [];
      let idx = 0;
      for (const [a, b] of pairs) {
        if (a >= n || b >= n) {
          byes.push(teams[a >= n ? b : a]);
          continue;
        }
        let home = a;
        let away = b;
        if (!homeFirst(a, b, n)) {
          home = b;
          away = a;
        }
        if (leg === 2) [home, away] = [away, home];
        idx++;
        const h = teams[home];
        const aw = teams[away];
        let status: RRMatch['status'] = 'scheduled';
        let awarded: string | null = null;
        const hOut = withdrawn.has(h) && (policy === 'void_all' || round > withdrawn.get(h)!);
        const aOut = withdrawn.has(aw) && (policy === 'void_all' || round > withdrawn.get(aw)!);
        if (policy === 'void_all') {
          if (withdrawn.has(h) || withdrawn.has(aw)) status = 'voided';
        } else if (hOut && aOut) status = 'voided';
        else if (hOut) {
          status = 'forfeit';
          awarded = aw;
        } else if (aOut) {
          status = 'forfeit';
          awarded = h;
        }
        summary.total++;
        if (status === 'scheduled') summary.scheduled++;
        else if (status === 'forfeit') summary.forfeit++;
        else summary.voided++;
        matches.push({ match_id: `RR-L${leg}-R${round}-M${idx}`, leg, home: h, away: aw, status, awarded_to: awarded });
      }
      rounds.push({ round, matches, byes });
    });
  }

  return {
    format: 'round_robin',
    legs,
    team_count: n,
    round_count: roundCount,
    rounds: rounds.map((r) => ({ round: r.round, matches: r.matches, byes: r.byes })),
    summary,
  };
}
