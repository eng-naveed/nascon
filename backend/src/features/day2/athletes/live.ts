import { pool } from '../../../core/db';
import { notFound } from '../../../core/errors';
import { playerExists } from '../common';

/**
 * Where viewers watch an athlete's solo broadcast (FR-3.2) and chat with them. An athlete counts as live while they
 * hold an active stream key (the media server plays a placeholder until the phone or OBS publishes). The chat room
 * is per athlete, so the broadcaster and every viewer (app or web) share it.
 */
export const liveRoomOf = (athleteId: string) => `chat-live-${athleteId}`;

export async function athleteLive(athleteId: string) {
  if (!(await playerExists(pool, athleteId))) throw notFound('PLAYER_NOT_FOUND', `Player ${athleteId} not found.`, { player_id: athleteId });
  const r = await pool.query(
    "SELECT stream_key, label, created_at FROM stream_keys WHERE player_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
    [athleteId],
  );
  const k = r.rows[0];
  return {
    athlete_id: athleteId,
    live: !!k,
    label: k?.label ?? null,
    started_at: k?.created_at ?? null,
    hls_path: k ? `live/${k.stream_key}` : null,
    chat_room_id: liveRoomOf(athleteId),
  };
}
