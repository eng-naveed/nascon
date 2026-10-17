import { validation } from '../../core/errors';

type Slot = 'home' | 'away';
interface Target {
  match_id: string;
  slot: Slot;
}
export interface BMatch {
  match_id: string;
  bracket: 'main' | 'third_place' | 'winners' | 'losers' | 'grand_final';
  round: number;
  index: number;
  home: string | null;
  away: string | null;
  home_seed: number | null;
  away_seed: number | null;
  bye: boolean;
  winner: string | null;
  loser: string | null;
  winner_to: Target | null;
  loser_to: Target | null;
  conditional?: boolean;
  required?: boolean | null;
}

export interface ElimParams {
  results?: { match_id: string; winner: string }[];
  third_place_match?: boolean;
  bracket_reset?: boolean;
}

export function bracketSize(n: number): number {
  let b = 2;
  while (b < n) b *= 2;
  return b;
}

export function seedOrder(b: number): number[] {
  let order = [1, 2];
  while (order.length < b) {
    const size = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, size + 1 - s);
    order = next;
  }
  return order;
}

const slotFor = (i: number): Slot => (i % 2 === 1 ? 'home' : 'away');

function blank(match_id: string, bracket: BMatch['bracket'], round: number, index: number): BMatch {
  return {
    match_id,
    bracket,
    round,
    index,
    home: null,
    away: null,
    home_seed: null,
    away_seed: null,
    bye: false,
    winner: null,
    loser: null,
    winner_to: null,
    loser_to: null,
  };
}

class Bracket {
  map = new Map<string, BMatch>();
  seedOf = new Map<string, number>();
  dead = new Set<string>(); // "matchId|slot": no team can ever arrive here
  deadMatch = new Set<string>();
  after: (() => void) | null = null;
  guard: ((m: BMatch) => void) | null = null;
  add(m: BMatch) {
    this.map.set(m.match_id, m);
    return m;
  }
  put(t: Target | null, team: string | null) {
    if (!t) return;
    if (!team) {
      this.dead.add(`${t.match_id}|${t.slot}`);
      return;
    }
    const m = this.map.get(t.match_id);
    if (!m) return;
    m[t.slot] = team;
    const seed = this.seedOf.get(team) ?? null;
    if (t.slot === 'home') m.home_seed = m.home_seed ?? seed;
    else m.away_seed = m.away_seed ?? seed;
  }
  decide(m: BMatch, winner: string) {
    m.winner = winner;
    m.loser = m.home === winner ? m.away : m.home;
    this.put(m.winner_to, m.winner);
    this.put(m.loser_to, m.loser);
  }
  /** Propagates "dead" slots (fed by a bye's missing loser) so the bracket can never stall. */
  settle() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of this.map.values()) {
        if (m.winner !== null || this.deadMatch.has(m.match_id)) continue;
        const hd = !m.home && this.dead.has(`${m.match_id}|home`);
        const ad = !m.away && this.dead.has(`${m.match_id}|away`);
        if (hd && ad) {
          this.deadMatch.add(m.match_id);
          this.put(m.winner_to, null);
          this.put(m.loser_to, null);
          changed = true;
        } else if ((m.home && ad) || (m.away && hd)) {
          m.bye = true;
          this.decide(m, (m.home ?? m.away)!);
          m.loser = null;
          changed = true;
        }
      }
    }
  }
  applyResults(results: { match_id: string; winner: string }[]) {
    const order = [...results].sort((a, b) => weight(this.map.get(a.match_id)) - weight(this.map.get(b.match_id)));
    for (const r of order) {
      const m = this.map.get(r.match_id);
      if (!m) throw validation(['params.results', 'results']);
      if (m.winner !== null && m.winner === r.winner) continue; // already decided (e.g. a bye): no-op
      if (!m.home || !m.away || m.winner !== null) throw validation(['params.results', 'results']);
      if (r.winner !== m.home && r.winner !== m.away) throw validation(['params.results', 'results']);
      this.guard?.(m);
      this.decide(m, r.winner);
      this.settle();
      this.after?.();
    }
  }
}

function weight(m: BMatch | undefined): number {
  if (!m) return -1;
  if (m.bracket === 'grand_final') return 1000 + m.round;
  if (m.bracket === 'losers') return m.round * 2 + 1;
  if (m.bracket === 'third_place') return 900;
  return m.round * 2;
}

function seedRound1(b: Bracket, teams: string[], prefix: string, bracketName: BMatch['bracket'], B: number) {
  const order = seedOrder(B);
  const n = teams.length;
  const r1: BMatch[] = [];
  for (let i = 1; i <= B / 2; i++) {
    const s1 = order[2 * i - 2];
    const s2 = order[2 * i - 1];
    const lo = Math.min(s1, s2);
    const hi = Math.max(s1, s2);
    const m = blank(`${prefix}1M${i}`, bracketName, 1, i);
    m.home = teams[lo - 1];
    m.home_seed = lo;
    if (hi <= n) {
      m.away = teams[hi - 1];
      m.away_seed = hi;
    } else m.bye = true;
    b.add(m);
    r1.push(m);
  }
  return r1;
}

const group = (ms: BMatch[]) => {
  const rounds = new Map<number, BMatch[]>();
  for (const m of ms) {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round)!.push(m);
  }
  return [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, matches]) => ({ round, matches }));
};

export function generateSingleElim(teams: string[], params: ElimParams = {}) {
  const n = teams.length;
  const B = bracketSize(n);
  const k = Math.log2(B);
  const br = new Bracket();
  teams.forEach((t, i) => br.seedOf.set(t, i + 1));
  seedRound1(br, teams, 'R', 'main', B);
  for (let r = 2; r <= k; r++) for (let i = 1; i <= B / 2 ** r; i++) br.add(blank(`R${r}M${i}`, 'main', r, i));
  for (const m of [...br.map.values()]) {
    if (m.round < k) m.winner_to = { match_id: `R${m.round + 1}M${Math.ceil(m.index / 2)}`, slot: slotFor(m.index) };
  }
  let tp: BMatch | null = null;
  if (params.third_place_match && k >= 2) {
    tp = br.add(blank('TP', 'third_place', k, 2));
    for (let i = 1; i <= 2; i++) br.map.get(`R${k - 1}M${i}`)!.loser_to = { match_id: 'TP', slot: slotFor(i) };
  }
  for (const m of br.map.values()) {
    if (m.bye && m.bracket === 'main') {
      br.decide(m, m.home!);
      m.loser = null;
    }
  }
  br.settle();
  br.applyResults(params.results ?? []);
  const mainMatches = [...br.map.values()].filter((m) => m.bracket === 'main');
  const rounds = group(mainMatches);
  if (tp) rounds[rounds.length - 1].matches.push(tp);
  return { format: 'single_elim', bracket_size: B, rounds, ...(tp ? { third_place: tp } : {}) };
}

export function generateDoubleElim(teams: string[], params: ElimParams = {}) {
  const n = teams.length;
  const B = bracketSize(n);
  const k = Math.log2(B);
  const reset = params.bracket_reset === true;
  const br = new Bracket();
  teams.forEach((t, i) => br.seedOf.set(t, i + 1));
  seedRound1(br, teams, 'WR', 'winners', B);
  for (let r = 2; r <= k; r++) for (let i = 1; i <= B / 2 ** r; i++) br.add(blank(`WR${r}M${i}`, 'winners', r, i));
  for (let j = 1; j <= k - 1; j++)
    for (const r of [2 * j - 1, 2 * j])
      for (let i = 1; i <= B / 2 ** (j + 1); i++) br.add(blank(`LR${r}M${i}`, 'losers', r, i));
  const gf1 = br.add(blank('GF1', 'grand_final', 1, 1));
  const gf2 = reset ? br.add(blank('GF2', 'grand_final', 2, 1)) : null;
  if (gf2) {
    gf2.conditional = true;
    gf2.required = null;
  }

  for (const m of br.map.values()) {
    if (m.bracket === 'winners') {
      m.winner_to = m.round < k ? { match_id: `WR${m.round + 1}M${Math.ceil(m.index / 2)}`, slot: slotFor(m.index) } : { match_id: 'GF1', slot: 'home' };
      m.loser_to =
        m.round === 1
          ? { match_id: `LR1M${Math.ceil(m.index / 2)}`, slot: slotFor(m.index) }
          : { match_id: `LR${2 * m.round - 2}M${m.index}`, slot: 'away' };
    } else if (m.bracket === 'losers') {
      const j = Math.ceil(m.round / 2);
      if (m.round % 2 === 1) m.winner_to = { match_id: `LR${m.round + 1}M${m.index}`, slot: 'home' };
      else if (j < k - 1) m.winner_to = { match_id: `LR${m.round + 1}M${Math.ceil(m.index / 2)}`, slot: slotFor(m.index) };
      else m.winner_to = { match_id: 'GF1', slot: 'away' };
    }
  }
  for (const m of br.map.values()) {
    if (m.bye && m.bracket === 'winners') {
      br.decide(m, m.home!);
      m.loser = null;
    }
  }
  gf1.conditional = false;
  gf1.required = true;
  const syncGF = () => {
    if (!gf2) return;
    if (gf1.home && gf1.away) {
      gf2.home = gf1.home;
      gf2.away = gf1.away;
      gf2.home_seed = gf1.home_seed;
      gf2.away_seed = gf1.away_seed;
    }
    gf2.required = gf1.winner ? gf1.winner === gf1.away : null;
  };
  br.guard = (m) => {
    if (m.match_id === 'GF2' && gf2 && gf2.required !== true) throw validation(['params.results', 'results']);
  };
  br.after = syncGF;
  br.settle();
  syncGF();
  br.applyResults(params.results ?? []);
  const all = [...br.map.values()];
  return {
    format: 'double_elim',
    bracket_size: B,
    bracket_reset: reset,
    winners: group(all.filter((m) => m.bracket === 'winners')),
    losers: group(all.filter((m) => m.bracket === 'losers')),
    grand_final: gf2 ? [gf1, gf2] : [gf1],
  };
}
