import type { MatchEvent } from '@/api/types';

export function describeEvent(e: MatchEvent, names: Record<string, string>): string {
  const p = e.payload ?? {};
  const team = p.team_id ? names[p.team_id] ?? p.team_id : '';
  switch (e.type) {
    case 'match_init': return 'Match created';
    case 'match_start': return 'Match started';
    case 'match_end': return 'Match ended';
    case 'score': return `${team}: ${String(p.event_type ?? 'score').replace(/_/g, ' ')}`;
    case 'discipline': return `${team}: fair-play penalty (${p.points} point${Math.abs(Number(p.points)) === 1 ? '' : 's'})`;
    case 'tiebreak_winner': return `${team} declared tie-break winner`;
    case 'compensation': return `Correction: undid ${p.compensates}${p.reason ? ` (${p.reason})` : ''}`;
    default: return e.type.replace(/_/g, ' ');
  }
}
