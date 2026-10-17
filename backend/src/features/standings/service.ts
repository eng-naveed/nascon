import { z } from 'zod';
import type { PoolClient } from 'pg';
import { conflict, notFound, validation } from '../../core/errors';
import { idSchema, parse } from '../../core/validate';
import { getSport, DEFAULT_TIE_BREAK } from '../sports/service';
import { loadEvents } from '../events/service';
import { project } from '../events/projection';
import { Played, computeStandings } from './compute';

const int = z.number().int();
const TOKENS = DEFAULT_TIE_BREAK as [string, ...string[]];
const leagueSchema = z.object({
  league_id: idSchema,
  sport_id: z.string().min(1).max(64),
  teams: z.array(idSchema).min(2).max(40),
  fixtures: z.array(z.object({ match_id: idSchema, home: idSchema, away: idSchema, scheduled_at: z.string().optional() })),
  points: z.object({ win: int, draw: int, loss: int }).optional(),
  tie_break_order: z.array(z.enum(TOKENS)).optional(),
  qualification: z.object({ spots: int.min(1) }),
  lots_seed: int.optional(),
  name: z.string().max(120).optional(),
  tenant_id: z.string().max(64).optional(),
});

export async function createLeague(c: PoolClient, body: unknown) {
  const b = parse(leagueSchema, body);
  if (new Set(b.teams).size !== b.teams.length) throw validation(['teams']);
  if (b.qualification.spots > b.teams.length) throw validation(['qualification.spots', 'qualification']);
  if (b.tie_break_order && new Set(b.tie_break_order).size !== b.tie_break_order.length) throw validation(['tie_break_order']);
  const ids = new Set<string>();
  for (const f of b.fixtures) {
    if (!b.teams.includes(f.home) || !b.teams.includes(f.away) || f.home === f.away || ids.has(f.match_id)) throw validation(['fixtures']);
    ids.add(f.match_id);
  }
  const sport = await getSport(c, b.sport_id);
  if ((await c.query('SELECT 1 FROM leagues WHERE league_id=$1', [b.league_id])).rowCount)
    throw conflict('LEAGUE_EXISTS', `League ${b.league_id} already exists.`, { league_id: b.league_id });
  for (const f of b.fixtures)
    if ((await c.query('SELECT 1 FROM matches WHERE match_id=$1', [f.match_id])).rowCount)
      throw conflict('MATCH_EXISTS', `Match ${f.match_id} already exists.`, { match_id: f.match_id });
  let lots = b.lots_seed;
  if (lots === undefined) {
    const k = await c.query("SELECT value FROM kv WHERE key='seed'");
    lots = k.rowCount ? Number(k.rows[0].value) : 42;
  }
  const config = {
    teams: b.teams,
    points: b.points ?? { win: 3, draw: 1, loss: 0 },
    tie_break_order: b.tie_break_order ?? sport.tie_break_order ?? DEFAULT_TIE_BREAK,
    qualification: b.qualification,
    lots_seed: lots,
  };
  await c.query('INSERT INTO leagues(league_id, tenant_id, name, sport_id, config) VALUES ($1,$2,$3,$4,$5)', [
    b.league_id, b.tenant_id ?? null, b.name ?? b.league_id, b.sport_id, JSON.stringify(config),
  ]);
  for (const f of b.fixtures)
    await c.query('INSERT INTO matches(match_id, sport_id, league_id, home_team_id, away_team_id, scheduled_at) VALUES ($1,$2,$3,$4,$5,$6)', [
      f.match_id, b.sport_id, b.league_id, f.home, f.away, f.scheduled_at ?? null,
    ]);
  return { league_id: b.league_id, status: 'created', team_count: b.teams.length, fixture_count: b.fixtures.length };
}

export async function getStandings(c: Pick<PoolClient, 'query'>, leagueId: string) {
  const l = await c.query('SELECT league_id, sport_id, config FROM leagues WHERE league_id=$1', [leagueId]);
  if (!l.rowCount) throw notFound('LEAGUE_NOT_FOUND', `League ${leagueId} not found.`, { league_id: leagueId });
  const league = l.rows[0];
  const cfg = league.config;
  const sport = await getSport(c, league.sport_id);
  const ms = await c.query('SELECT match_id, sport_id, league_id, home_team_id, away_team_id FROM matches WHERE league_id=$1 ORDER BY match_id', [leagueId]);
  const fixtures = [];
  for (const m of ms.rows) {
    const v = project(sport, m, await loadEvents(c, m.match_id));
    let played: Played | null = null;
    if (v.status === 'completed' && v.outcome !== 'undecided')
      played = {
        home: m.home_team_id, away: m.away_team_id, hs: v.home.score, as: v.away.score, hFair: v.home.fair_play, aFair: v.away.fair_play,
        hBalls: v.home.balls ?? 0, hWk: v.home.wickets ?? 0, aBalls: v.away.balls ?? 0, aWk: v.away.wickets ?? 0, outcome: v.outcome as Played['outcome'],
      };
    fixtures.push({ home: m.home_team_id as string, away: m.away_team_id as string, played });
  }
  return computeStandings({
    league_id: leagueId, sport, teams: cfg.teams, points: cfg.points, tieBreakOrder: cfg.tie_break_order,
    spots: cfg.qualification.spots, lotsSeed: cfg.lots_seed, fixtures,
  });
}
