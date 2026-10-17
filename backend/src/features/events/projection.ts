export interface SportConfig {
  sport_id: string;
  name: string;
  scoring_model: 'event' | 'innings' | 'round';
  periods: any;
  scoring_events: Record<string, any>;
  draw_allowed: boolean;
  overtime: { policy: string; duration_minutes?: number };
  tie_break_order?: string[];
  roster: { min_squad_size: number; max_squad_size: number; required_positions: Record<string, number> };
}

export interface MatchMeta {
  match_id: string;
  sport_id: string;
  league_id: string | null;
  home_team_id: string;
  away_team_id: string;
}

export interface StoredEvent {
  seq: number;
  event_id: string;
  type: string;
  payload: any;
  signature: string;
}

export interface TeamView {
  team_id: string;
  score: number;
  wickets: number | null;
  balls: number | null;
  overs: string | null;
  fair_play: number;
}

export const SCORABLE = ['score', 'discipline', 'tiebreak_winner'];

export function compensationMap(events: StoredEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) if (e.type === 'compensation' && !m.has(e.payload.compensates)) m.set(e.payload.compensates, e.event_id);
  return m;
}

export function project(sport: SportConfig, meta: MatchMeta, events: StoredEvent[]) {
  const comp = compensationMap(events);
  let status: 'upcoming' | 'in_progress' | 'completed' = 'upcoming';
  const teams: Record<string, { score: number; wickets: number; balls: number; fair: number }> = {
    [meta.home_team_id]: { score: 0, wickets: 0, balls: 0, fair: 0 },
    [meta.away_team_id]: { score: 0, wickets: 0, balls: 0, fair: 0 },
  };
  let tiebreak: string | null = null;
  for (const e of events) {
    if (e.type === 'match_start') status = 'in_progress';
    else if (e.type === 'match_end') status = 'completed';
    if (comp.has(e.event_id) || e.type === 'compensation') continue;
    const t = teams[e.payload?.team_id];
    if (e.type === 'score' && t) {
      const def = Object.hasOwn(sport.scoring_events, e.payload.event_type) ? sport.scoring_events[e.payload.event_type] : undefined;
      if (!def) continue;
      if (sport.scoring_model === 'event') t.score += def.points;
      else if (sport.scoring_model === 'innings') {
        t.score += def.runs;
        if (def.legal_ball) t.balls += 1;
        if (def.wicket) t.wickets += 1;
      } else t.score += def.rounds;
    } else if (e.type === 'discipline' && t) t.fair += Number(e.payload.points) || 0;
    else if (e.type === 'tiebreak_winner' && t) tiebreak = e.payload.team_id;
  }
  const h = teams[meta.home_team_id];
  const a = teams[meta.away_team_id];
  let winner: string | null = null;
  if (h.score !== a.score) winner = h.score > a.score ? meta.home_team_id : meta.away_team_id;
  else winner = tiebreak;
  let outcome = 'pending';
  if (status === 'completed') {
    if (winner) outcome = winner === meta.home_team_id ? 'home_win' : 'away_win';
    else outcome = sport.draw_allowed ? 'draw' : 'undecided';
  }
  const innings = sport.scoring_model === 'innings';
  const bpo = sport.periods?.balls_per_over ?? 6;
  const view = (id: string, t: (typeof teams)[string]): TeamView => ({
    team_id: id,
    score: t.score,
    wickets: innings ? t.wickets : null,
    balls: innings ? t.balls : null,
    overs: innings ? `${Math.floor(t.balls / bpo)}.${t.balls % bpo}` : null,
    fair_play: t.fair,
  });
  return {
    match_id: meta.match_id,
    sport_id: meta.sport_id,
    league_id: meta.league_id,
    status,
    outcome,
    winner_team_id: winner,
    tiebreak_winner_team_id: tiebreak,
    home: view(meta.home_team_id, h),
    away: view(meta.away_team_id, a),
    version: events.length,
    events: events.map((e) => ({
      sequence: e.seq,
      event_id: e.event_id,
      type: e.type,
      payload: e.payload,
      signature: e.signature,
      compensated: comp.has(e.event_id),
      compensated_by: comp.get(e.event_id) ?? null,
    })),
  };
}

export type ScoreView = ReturnType<typeof project>;
