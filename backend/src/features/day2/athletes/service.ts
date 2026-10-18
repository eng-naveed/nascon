import type { PoolClient } from 'pg';
import { pool, tx } from '../../../core/db';
import type { JwtClaims } from '../../../core/crypto';
import { AppError, notFound } from '../../../core/errors';
import { getScore } from '../../events/service';
import { playerExists } from '../common';

/**
 * FR-3.1 public athlete identity + concurrency-safe social graph.
 *
 * Follows are one row per (follower_id, athlete_id): `INSERT ... ON CONFLICT DO NOTHING` / `DELETE` make each
 * toggle idempotent, and follower_count is always `count(*)` of those rows, so a burst of simultaneous
 * follow/unfollow requests can never drift a stored counter (there is none).
 */

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

async function requireAthlete(id: string) {
  if (!ID.test(id) || !(await playerExists(pool, id))) throw notFound('PLAYER_NOT_FOUND', `Player ${id} not found.`, { player_id: id });
}

const followerOf = (u: JwtClaims) => u.player_id ?? u.sub;

async function countFollowers(db: Pick<PoolClient, 'query'>, athleteId: string): Promise<number> {
  const r = await db.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1', [athleteId]);
  return r.rows[0].n;
}

export async function setFollow(u: JwtClaims, athleteId: string, following: boolean) {
  await requireAthlete(athleteId);
  const follower = followerOf(u);
  if (follower === athleteId) throw new AppError(400, 'VALIDATION_ERROR', 'You cannot follow yourself.', { fields: ['athlete_id'] });
  return tx(async (c) => {
    if (following)
      await c.query('INSERT INTO follows(follower_id, athlete_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [follower, athleteId]);
    else await c.query('DELETE FROM follows WHERE follower_id=$1 AND athlete_id=$2', [follower, athleteId]);
    return { athlete_id: athleteId, follower_id: follower, following, follower_count: await countFollowers(c, athleteId) };
  });
}

/** Aggregated public profile: identity, club affiliation, career record, upcoming fixtures, VOD archive. */
export async function athleteProfile(athleteId: string, viewer?: JwtClaims | null) {
  await requireAthlete(athleteId);
  const p = (
    await pool.query(
      `SELECT coalesce(rp.name, u.name) AS name, rp.position, coalesce(e.club_id, u.club_id) AS club_id, c.name AS club_name
         FROM (SELECT $1::text AS id) x
         LEFT JOIN roster_players rp ON rp.player_id = x.id
         LEFT JOIN users u ON u.player_id = x.id
         LEFT JOIN rbac_entities e ON e.kind='player' AND e.id = x.id
         LEFT JOIN clubs c ON c.club_id = coalesce(e.club_id, u.club_id)`,
      [athleteId],
    )
  ).rows[0];

  const record = { played: 0, won: 0, drawn: 0, lost: 0 };
  const upcoming: { match_id: string; opponent_id: string; home: boolean; scheduled_at: string | null }[] = [];
  const vod: { match_id: string; title: string; vod_url: string }[] = [];
  if (p.club_id) {
    const ms = await pool.query(
      'SELECT match_id, home_team_id, away_team_id, scheduled_at FROM matches WHERE home_team_id=$1 OR away_team_id=$1 ORDER BY scheduled_at NULLS LAST, match_id',
      [p.club_id],
    );
    for (const m of ms.rows) {
      const home = m.home_team_id === p.club_id;
      const opponent = home ? m.away_team_id : m.home_team_id;
      let s;
      try {
        s = await getScore(pool, m.match_id);
      } catch {
        continue; // a match whose sport config is unreadable must not break the profile
      }
      if (s.status === 'upcoming') upcoming.push({ match_id: m.match_id, opponent_id: opponent, home, scheduled_at: m.scheduled_at });
      if (s.status !== 'completed') continue;
      record.played++;
      if (!s.winner_team_id) record.drawn++;
      else if (s.winner_team_id === p.club_id) record.won++;
      else record.lost++;
      vod.push({ match_id: m.match_id, title: `${m.home_team_id} v ${m.away_team_id}`, vod_url: `/web/matches/${m.match_id}/vod` });
    }
  }

  const streams = await pool.query(
    "SELECT label, status, created_at, revoked_at FROM stream_keys WHERE player_id=$1 AND status <> 'active' ORDER BY created_at DESC LIMIT 20",
    [athleteId],
  );
  const viewerId = viewer ? followerOf(viewer) : null;
  const following = viewerId
    ? !!(await pool.query('SELECT 1 FROM follows WHERE follower_id=$1 AND athlete_id=$2', [viewerId, athleteId])).rowCount
    : false;

  return {
    athlete_id: athleteId,
    name: p.name ?? athleteId,
    position: p.position ?? null,
    club: p.club_id ? { club_id: p.club_id, name: p.club_name ?? p.club_id } : null,
    career: record,
    upcoming_fixtures: upcoming,
    vod_archive: vod,
    past_streams: streams.rows.map((r) => ({ label: r.label, status: r.status, started_at: r.created_at, ended_at: r.revoked_at })),
    follower_count: await countFollowers(pool, athleteId),
    following,
  };
}
