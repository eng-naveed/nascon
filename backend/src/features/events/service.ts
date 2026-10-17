import { z } from 'zod';
import type { PoolClient } from 'pg';
import { config } from '../../core/config';
import { bodyHash, sign } from '../../core/crypto';
import { AppError, conflict, notFound, validation } from '../../core/errors';
import { idSchema, parse } from '../../core/validate';
import { getSport } from '../sports/service';
import { MatchMeta, SCORABLE, StoredEvent, project } from './projection';

const envelope = z.object({
  event_id: idSchema,
  match_id: idSchema,
  type: z.enum(['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation']),
  payload: z.record(z.string(), z.any()).optional(),
});
const team = idSchema;
const payloads: Record<string, z.ZodTypeAny> = {
  match_init: z.object({ sport_id: z.string().min(1).max(64), home_team_id: team, away_team_id: team, league_id: idSchema.optional() }).refine((v) => v.home_team_id !== v.away_team_id, { path: ['away_team_id'], message: 'must differ from home_team_id' }),
  match_start: z.object({}),
  score: z.object({ team_id: team, event_type: z.string().min(1).max(64) }),
  discipline: z.object({ team_id: team, points: z.number().int() }),
  tiebreak_winner: z.object({ team_id: team }),
  match_end: z.object({}),
  compensation: z.object({ compensates: idSchema, reason: z.string().max(500).optional() }),
};

export async function loadEvents(db: Pick<PoolClient, 'query'>, matchId: string): Promise<StoredEvent[]> {
  const r = await db.query('SELECT seq, event_id, type, payload, signature FROM events WHERE match_id=$1 ORDER BY seq', [matchId]);
  return r.rows;
}

export async function getMatchMeta(db: Pick<PoolClient, 'query'>, matchId: string): Promise<MatchMeta> {
  const r = await db.query('SELECT match_id, sport_id, league_id, home_team_id, away_team_id FROM matches WHERE match_id=$1', [matchId]);
  if (!r.rowCount) throw notFound('MATCH_NOT_FOUND', `Match ${matchId} not found.`, { match_id: matchId });
  return r.rows[0];
}

export async function getScore(db: Pick<PoolClient, 'query'>, matchId: string) {
  const meta = await getMatchMeta(db, matchId);
  const sport = await getSport(db, meta.sport_id);
  return project(sport, meta, await loadEvents(db, matchId));
}

/** Appends one signed event to the append-only log. Must run inside a transaction. */
export async function appendEvent(c: PoolClient, rawBody: unknown): Promise<{ status: number; body: any }> {
  const body = parse(envelope, rawBody);
  const payload = body.payload ?? {};
  const hash = bodyHash({ match_id: body.match_id, type: body.type, payload });
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [body.match_id]);

  const dup = await c.query('SELECT body_hash, response FROM events WHERE event_id=$1', [body.event_id]);
  if (dup.rowCount) {
    if (dup.rows[0].body_hash === hash) return { status: 200, body: dup.rows[0].response };
    throw conflict('DUPLICATE_EVENT_ID', `Event id ${body.event_id} was already used with different content.`, { event_id: body.event_id });
  }
  const pl: any = parse(payloads[body.type], payload);
  let seq = 1;

  if (body.type === 'match_init') {
    const exists = await c.query('SELECT 1 FROM matches WHERE match_id=$1', [body.match_id]);
    if (exists.rowCount) throw conflict('MATCH_EXISTS', `Match ${body.match_id} already exists.`, { match_id: body.match_id });
    const sport = await getSport(c, pl.sport_id);
    await c.query('INSERT INTO matches(match_id, sport_id, league_id, home_team_id, away_team_id) VALUES ($1,$2,$3,$4,$5)', [
      body.match_id, sport.sport_id, pl.league_id ?? null, pl.home_team_id, pl.away_team_id,
    ]);
  } else {
    const meta = await getMatchMeta(c, body.match_id);
    const sport = await getSport(c, meta.sport_id);
    const events = await loadEvents(c, body.match_id);
    const view = project(sport, meta, events);
    seq = events.length + 1;
    const inProgress = () => {
      if (view.status !== 'in_progress') throw conflict('MATCH_NOT_IN_PROGRESS', 'The match is not in progress.', { match_id: body.match_id, status: view.status });
    };
    const checkTeam = () => {
      if (pl.team_id !== meta.home_team_id && pl.team_id !== meta.away_team_id) throw validation(['payload.team_id', 'team_id']);
    };
    if (body.type === 'match_start') {
      if (view.status !== 'upcoming') throw conflict('ILLEGAL_TRANSITION', `Cannot start a match that is ${view.status}.`, { status: view.status });
    } else if (body.type === 'score') {
      inProgress();
      checkTeam();
      const def = Object.hasOwn(sport.scoring_events, pl.event_type) ? sport.scoring_events[pl.event_type] : undefined;
      if (!def) throw new AppError(400, 'UNKNOWN_EVENT_TYPE', `Unknown event type ${pl.event_type} for ${sport.sport_id}.`, { event_type: pl.event_type });
      if (sport.scoring_model === 'innings') {
        const t = pl.team_id === meta.home_team_id ? view.home : view.away;
        const p = sport.periods;
        if (t.balls! >= p.innings_per_team * p.overs_per_innings * p.balls_per_over || t.wickets! >= p.innings_per_team * p.wickets_per_innings)
          throw conflict('INNINGS_COMPLETE', 'This innings is already complete.', { team_id: pl.team_id });
      } else if (sport.scoring_model === 'round') {
        const need = (sport.periods.best_of + 1) / 2;
        if (view.home.score >= need || view.away.score >= need) throw conflict('SERIES_ALREADY_DECIDED', 'The series is already decided.', { match_id: body.match_id });
      }
    } else if (body.type === 'discipline' || body.type === 'tiebreak_winner') {
      inProgress();
      checkTeam();
    } else if (body.type === 'match_end') {
      if (view.status !== 'in_progress') throw conflict('ILLEGAL_TRANSITION', `Cannot end a match that is ${view.status}.`, { status: view.status });
      if (view.home.score === view.away.score && !sport.draw_allowed && !view.tiebreak_winner_team_id)
        throw conflict('TIE_NOT_ALLOWED', 'The score is level and draws are not allowed.', { match_id: body.match_id });
    } else if (body.type === 'compensation') {
      const t = await c.query('SELECT match_id, type, event_id FROM events WHERE event_id=$1', [pl.compensates]);
      if (!t.rowCount) throw notFound('EVENT_NOT_FOUND', `Event ${pl.compensates} not found.`, { event_id: pl.compensates });
      const target = t.rows[0];
      if (target.match_id !== body.match_id) throw conflict('INVALID_COMPENSATION', 'The target event belongs to another match.', { event_id: pl.compensates });
      if (!SCORABLE.includes(target.type)) throw conflict('INVALID_COMPENSATION', 'This event type cannot be compensated.', { event_id: pl.compensates });
      if (events.some((e) => e.type === 'compensation' && e.payload.compensates === pl.compensates))
        throw conflict('INVALID_COMPENSATION', 'The target event is already compensated.', { event_id: pl.compensates });
    }
  }

  const signature = sign(config.salt, body.event_id, payload);
  const response = { event_id: body.event_id, match_id: body.match_id, type: body.type, sequence: seq, match_version: seq, signature };
  await c.query('INSERT INTO events(event_id, match_id, seq, type, payload, signature, body_hash, response) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    body.event_id, body.match_id, seq, body.type, JSON.stringify(payload), signature, hash, JSON.stringify(response),
  ]);
  return { status: 201, body: response };
}
