import { pool } from '../../../core/db';
import { notFound } from '../../../core/errors';
import { getScore } from '../../events/service';
import { playerExists } from '../common';

/**
 * Athlete profile (FR-3.1), read-only: club affiliations, a career record replayed from the Phase I event log of the
 * club's matches, upcoming fixtures, and the VOD archive (retired stream keys; recording is not built, so no playback URL).
 */
export async function playerProfile(playerId: string) {
  if (!(await playerExists(pool, playerId))) throw notFound('PLAYER_NOT_FOUND', `Player ${playerId} not found.`, { player_id: playerId });
  const [ids, keys] = await Promise.all([
    pool.query(
      `SELECT club_id, NULL AS name FROM rbac_entities WHERE kind='player' AND id=$1 AND club_id IS NOT NULL
       UNION ALL SELECT club_id, name FROM users WHERE player_id=$1
       UNION ALL SELECT r.squad_id, p.name FROM roster_players p LEFT JOIN roster_regs r USING (player_id) WHERE p.player_id=$1`,
      [playerId],
    ),
    pool.query(
      `SELECT label, status, revoked_at FROM stream_keys WHERE player_id=$1 AND status <> 'active' ORDER BY revoked_at DESC NULLS LAST, created_at DESC`,
      [playerId],
    ),
  ]);
  const activeClubs = [...new Set(ids.rows.map((r) => r.club_id).filter(Boolean))] as string[];
  const name = ids.rows.find((r) => r.name)?.name ?? null;

  const career = { matches_played: 0, wins: 0, draws: 0, losses: 0, goals_or_points: 0 };
  const upcoming: any[] = [];
  if (activeClubs.length) {
    const m = await pool.query(
      `SELECT match_id, home_team_id, away_team_id, scheduled_at FROM matches
       WHERE home_team_id = ANY($1) OR away_team_id = ANY($1) ORDER BY scheduled_at NULLS LAST, match_id`,
      [activeClubs],
    );
    const scores = await Promise.all(m.rows.map((r) => getScore(pool, r.match_id).catch(() => null)));
    m.rows.forEach((r, i) => {
      const s = scores[i];
      const status = s?.status ?? 'upcoming';
      if (s && status === 'completed') {
        const mine = activeClubs.includes(s.home.team_id) ? s.home : s.away;
        career.matches_played++;
        career.goals_or_points += Number(mine.score) || 0;
        if (!s.winner_team_id) career.draws++;
        else if (s.winner_team_id === mine.team_id) career.wins++;
        else career.losses++;
      } else if (status === 'upcoming' || status === 'in_progress' || status === 'postponed') {
        upcoming.push({ match_id: r.match_id, home: r.home_team_id, away: r.away_team_id, scheduled_at: r.scheduled_at, status });
      }
    });
  }

  return {
    player_id: playerId,
    name,
    club_id: activeClubs[0] ?? null,
    active_clubs: activeClubs,
    career,
    upcoming_fixtures: upcoming,
    vod_archive: keys.rows.map((k) => ({ stream_key_label: k.label, status: k.status, ended_at: k.revoked_at, playback_url: null })),
  };
}
