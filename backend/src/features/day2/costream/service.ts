import { z } from 'zod';
import { bodyHash } from '../../../core/crypto';
import { afterCommit, tx } from '../../../core/db';
import { AppError, conflict, notFound, validation } from '../../../core/errors';
import { parse } from '../../../core/validate';
import { playerExists, sign2 } from '../common';
import { publish } from '../observability/bus';

/** Synchronized 4-way co-stream orchestration (FR-3.3, spec 5.5, scenario 1). */

export const MAX_BROADCASTERS = 4;
const LAYOUT_CAPACITY: Record<string, number> = { solo: 1, grid_2: 2, grid_4: MAX_BROADCASTERS, spotlight: MAX_BROADCASTERS };

const sessionSchema = z.object({
  session_id: z.string().regex(/^[A-Za-z0-9_.:\-]{1,128}$/),
  host_player_id: z.string().min(1).max(128),
  participants: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(64)
    .refine((p) => new Set(p).size === p.length, 'participants must be unique'),
  simulate_host_drop: z.boolean().optional(),
  layout: z.enum(['solo', 'grid_2', 'grid_4', 'spotlight']).optional(),
});

export interface SessionState {
  status: 'active' | 'terminated';
  active_host: string | null;
  handoff_occurred: boolean;
  participant_count: number;
  active_participants: string[];
}

/** Spec 5.5 rule 5: the host drops out; hosting passes to the first remaining participant in array order. */
export function handoff(host: string, participants: string[], hostDropped: boolean): SessionState {
  if (!hostDropped) return { status: 'active', active_host: host, handoff_occurred: false, participant_count: participants.length, active_participants: [...participants] };
  const remaining = participants.filter((p) => p !== host);
  if (!remaining.length) return { status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [] };
  return { status: 'active', active_host: remaining[0], handoff_occurred: true, participant_count: remaining.length, active_participants: remaining };
}

export const compositeUrl = (id: string) => `http://localhost:8888/costream/${id}/index.m3u8`;

/** Contract body in the spec's key order (also used to re-emit stored replays, since jsonb reorders keys). */
export function sessionBody(id: string, layout: string, s: SessionState) {
  return {
    session_id: id,
    status: s.status,
    active_host: s.active_host,
    handoff_occurred: s.handoff_occurred,
    participant_count: s.participant_count,
    active_participants: s.active_participants,
    layout,
    // a terminated session has no composite left to play
    composite_playback_url: s.status === 'active' ? compositeUrl(id) : null,
    chat_room_id: `chat-${id}`,
    signature: sign2(id, {
      active_host: s.active_host, handoff_occurred: s.handoff_occurred, layout, participant_count: s.participant_count, session_id: id, status: s.status,
    }),
  };
}

export async function costreamSession(rawBody: unknown) {
  const b = parse(sessionSchema, rawBody);
  const layout = b.layout ?? 'grid_4';
  const drop = b.simulate_host_drop ?? false;
  const hash = bodyHash({ session_id: b.session_id, host_player_id: b.host_player_id, participants: b.participants, layout, simulate_host_drop: drop });

  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['costream:' + b.session_id]);
    for (const p of [...b.participants, b.host_player_id])
      if (!(await playerExists(c, p))) throw notFound('PLAYER_NOT_FOUND', `Player ${p} not found.`, { player_id: p });
    if (!b.participants.includes(b.host_player_id)) throw validation(['host_player_id'], 'host_player_id must be one of the participants.');
    if (b.participants.length > MAX_BROADCASTERS)
      throw conflict('COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_BROADCASTERS} broadcasters.`, { max: MAX_BROADCASTERS, requested: b.participants.length });
    const state = handoff(b.host_player_id, b.participants, drop);
    if (state.participant_count > LAYOUT_CAPACITY[layout])
      throw new AppError(400, 'UNSUPPORTED_LAYOUT', `Layout ${layout} cannot fit ${state.participant_count} active participants.`, { layout, participant_count: state.participant_count });

    const prev = await c.query('SELECT request_hash FROM costream_sessions WHERE session_id=$1', [b.session_id]);
    const out = sessionBody(b.session_id, layout, state);
    if (prev.rows[0]?.request_hash === hash) return { status: 200, body: out };

    await c.query(
      `INSERT INTO costream_sessions(session_id, host_player_id, participants, layout, status, active_host, handoff_occurred, participant_count, active_participants, request_hash, response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id) DO UPDATE SET host_player_id=$2, participants=$3, layout=$4, status=$5, active_host=$6, handoff_occurred=$7,
         participant_count=$8, active_participants=$9, request_hash=$10, response=$11, updated_at=now()`,
      [b.session_id, b.host_player_id, JSON.stringify(b.participants), layout, state.status, state.active_host, state.handoff_occurred,
        state.participant_count, JSON.stringify(state.active_participants), hash, JSON.stringify(out)],
    );
    // QR targets, the compositor and live viewers react only to committed state
    afterCommit(c, () => publish(`costream:${b.session_id}`, { type: 'costream.session', ...out }));
    return { status: 201, body: out };
  });
}
