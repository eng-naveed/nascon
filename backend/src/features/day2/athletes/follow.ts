import { pool } from '../../../core/db';
import { notFound } from '../../../core/errors';
import { playerExists } from '../common';

/**
 * FR-3.1 follow/unfollow. State is one row per (follower_id, athlete_id): following inserts it (ON CONFLICT DO NOTHING),
 * unfollowing deletes it, so repeats are idempotent and concurrent toggles resolve to the last committed write.
 * follower_count is always count(*) over the rows (never a counter column), so it cannot drift or go negative.
 */
async function followerCount(athleteId: string): Promise<number> {
  const r = await pool.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1', [athleteId]);
  return r.rows[0].n;
}

async function assertAthlete(athleteId: string) {
  if (!(await playerExists(pool, athleteId))) throw notFound('PLAYER_NOT_FOUND', `Player ${athleteId} not found.`, { player_id: athleteId });
}

export async function setFollow(user: { sub: string; player_id?: string | null }, athleteId: string, following: boolean) {
  await assertAthlete(athleteId);
  const followerId = user.player_id || user.sub;
  if (following) {
    await pool.query('INSERT INTO follows (follower_id, athlete_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [followerId, athleteId]);
  } else {
    await pool.query('DELETE FROM follows WHERE follower_id=$1 AND athlete_id=$2', [followerId, athleteId]);
  }
  return { athlete_id: athleteId, follower_id: followerId, following, follower_count: await followerCount(athleteId) };
}

/** Follower count; with a signed-in viewer also whether they follow (so a client can render the toggle state). */
export async function followers(athleteId: string, viewer?: { sub: string; player_id?: string | null } | null) {
  await assertAthlete(athleteId);
  const out: { athlete_id: string; follower_count: number; following?: boolean } = { athlete_id: athleteId, follower_count: await followerCount(athleteId) };
  if (viewer) {
    const r = await pool.query('SELECT 1 FROM follows WHERE follower_id=$1 AND athlete_id=$2', [viewer.player_id || viewer.sub, athleteId]);
    out.following = !!r.rowCount;
  }
  return out;
}
