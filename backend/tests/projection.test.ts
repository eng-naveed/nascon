import { describe, expect, it } from 'vitest';
import { BASELINE_SPORTS } from '../src/features/sports/service';
import { project, StoredEvent } from '../src/features/events/projection';

const sport = (id: string) => BASELINE_SPORTS.find((s) => s.sport_id === id)!;
const meta = (s: string) => ({ match_id: 'm', sport_id: s, league_id: null, home_team_id: 'h', away_team_id: 'a' });
let n = 0;
const ev = (type: string, payload: any = {}): StoredEvent => ({ seq: ++n, event_id: 'e' + n, type, payload, signature: 'x' });
const score = (team: string, event_type: string) => ev('score', { team_id: team, event_type });

describe('event-sourced projection', () => {
  it('derives status and event-model scores', () => {
    n = 0;
    const events = [ev('match_init'), ev('match_start'), score('h', 'three_pointer'), score('a', 'free_throw'), score('h', 'two_pointer')];
    const v = project(sport('basketball'), meta('basketball'), events);
    expect(v).toMatchObject({ status: 'in_progress', outcome: 'pending', version: 5 });
    expect(v.home.score).toBe(5);
    expect(v.away.score).toBe(1);
    const done = project(sport('basketball'), meta('basketball'), [...events, ev('match_end')]);
    expect(done).toMatchObject({ status: 'completed', outcome: 'home_win', winner_team_id: 'h' });
  });
  it('compensation neutralises a score and itself', () => {
    n = 0;
    const g = score('h', 'goal');
    const v = project(sport('football'), meta('football'), [ev('match_start'), g, ev('compensation', { compensates: g.event_id, reason: 'var' })]);
    expect(v.home.score).toBe(0);
    expect(v.events[1]).toMatchObject({ compensated: true, compensated_by: 'e3' });
    expect(v.version).toBe(3);
  });
  it('draw, undecided and tiebreak winner', () => {
    n = 0;
    const base = [ev('match_start'), score('h', 'free_throw'), score('a', 'free_throw'), ev('match_end')];
    expect(project(sport('football'), meta('football'), [ev('match_start'), ev('match_end')]).outcome).toBe('draw');
    expect(project(sport('basketball'), meta('basketball'), base).outcome).toBe('undecided');
    const tb = ev('tiebreak_winner', { team_id: 'a' });
    const w = project(sport('basketball'), meta('basketball'), [base[0], base[1], base[2], tb, base[3]]);
    expect(w).toMatchObject({ outcome: 'away_win', winner_team_id: 'a', tiebreak_winner_team_id: 'a' });
    const undone = project(sport('basketball'), meta('basketball'), [base[0], base[1], base[2], tb, base[3], ev('compensation', { compensates: tb.event_id })]);
    expect(undone.outcome).toBe('undecided');
  });
  it('discipline adds to fair play', () => {
    n = 0;
    const v = project(sport('football'), meta('football'), [ev('match_start'), ev('discipline', { team_id: 'h', points: -2 })]);
    expect(v.home.fair_play).toBe(-2);
  });
  it('innings model counts legal balls, wickets and overs', () => {
    n = 0;
    const events = [ev('match_start'), score('h', 'six'), score('h', 'wide'), score('h', 'wicket'), score('h', 'dot_ball'), score('h', 'single'), score('h', 'dot_ball'), score('h', 'dot_ball')];
    const v = project(sport('cricket'), meta('cricket'), events);
    expect(v.home).toMatchObject({ score: 8, wickets: 1, balls: 6, overs: '1.0' });
    expect(v.away.overs).toBe('0.0');
  });
  it('round model counts rounds', () => {
    n = 0;
    const v = project(sport('esports'), meta('esports'), [ev('match_start'), score('a', 'round_win'), score('a', 'round_win'), ev('match_end')]);
    expect(v).toMatchObject({ outcome: 'away_win' })
    expect(v.home.wickets).toBeNull();
    expect(v.away.score).toBe(2);
  });
  it('ignores unknown event types and unknown teams', () => {
    n = 0;
    const v = project(sport('football'), meta('football'), [ev('match_start'), score('h', 'nope'), score('zz', 'goal')]);
    expect(v.home.score).toBe(0);
  });
});
