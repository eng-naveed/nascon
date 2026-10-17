import { z } from 'zod';
import type { Db } from '../../core/db';
import { conflict, notFound, validation } from '../../core/errors';
import { parse } from '../../core/validate';
import type { SportConfig } from '../events/projection';

const TOKENS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
export const DEFAULT_TIE_BREAK = TOKENS;
const key = z.string().regex(/^[a-z0-9_]{1,40}$/);
const int = z.number().int();

const common = {
  sport_id: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(80),
  draw_allowed: z.boolean(),
  overtime: z.object({
    policy: z.enum(['none', 'extra_time', 'shootout', 'golden_score', 'super_over']),
    duration_minutes: int.min(0).optional(),
  }),
  tie_break_order: z
    .array(z.enum(TOKENS as [string, ...string[]]))
    .optional()
    .refine((a) => !a || new Set(a).size === a.length, 'duplicate'),
  roster: z
    .object({
      min_squad_size: int.min(1),
      max_squad_size: int.min(1),
      required_positions: z.record(z.string(), int.min(0)),
    })
    .refine((r) => r.min_squad_size <= r.max_squad_size, 'min>max'),
};

const eventSport = z.object({
  ...common,
  scoring_model: z.literal('event'),
  periods: z.object({ count: int.min(1), duration_minutes: int.min(1) }),
  scoring_events: z.record(key, z.object({ points: int.min(1) })),
});
const inningsSport = z.object({
  ...common,
  scoring_model: z.literal('innings'),
  periods: z.object({ innings_per_team: int.min(1), overs_per_innings: int.min(1), balls_per_over: int.min(1), wickets_per_innings: int.min(1) }),
  scoring_events: z.record(key, z.object({ runs: int.min(0), legal_ball: z.boolean(), wicket: z.boolean() })),
});
const roundSport = z.object({
  ...common,
  scoring_model: z.literal('round'),
  periods: z.object({ best_of: int.min(1).refine((n) => n % 2 === 1, 'odd') }),
  scoring_events: z.record(key, z.object({ rounds: int.min(1) })),
});

const sportSchema = z.discriminatedUnion('scoring_model', [eventSport, inningsSport, roundSport]);

export async function createSport(db: Db, body: unknown): Promise<SportConfig> {
  const b = body as any;
  if (!b || typeof b !== 'object' || !['event', 'innings', 'round'].includes(b.scoring_model)) throw validation(['scoring_model']);
  const cfg = parse(sportSchema, body) as SportConfig;
  if (Object.keys(cfg.scoring_events).length < 1) throw validation(['scoring_events']);
  const dup = await db.query('SELECT 1 FROM sports WHERE sport_id=$1', [cfg.sport_id]);
  if (dup.rowCount) throw conflict('SPORT_EXISTS', `Sport ${cfg.sport_id} already exists.`, { sport_id: cfg.sport_id });
  if (!cfg.tie_break_order) cfg.tie_break_order = [...DEFAULT_TIE_BREAK];
  await db.query('INSERT INTO sports(sport_id, config) VALUES ($1,$2)', [cfg.sport_id, cfg]);
  return cfg;
}

export async function getSport(db: Db, sportId: string): Promise<SportConfig> {
  const r = await db.query('SELECT config FROM sports WHERE sport_id=$1', [sportId]);
  if (!r.rowCount) throw notFound('SPORT_NOT_FOUND', `Sport ${sportId} not found.`, { sport_id: sportId });
  return r.rows[0].config;
}

export async function listSports(db: Db): Promise<SportConfig[]> {
  const r = await db.query('SELECT config FROM sports ORDER BY created_at, sport_id');
  return r.rows.map((x) => x.config);
}

const full = DEFAULT_TIE_BREAK;
export const BASELINE_SPORTS: SportConfig[] = [
  {
    sport_id: 'football', name: 'Football', scoring_model: 'event', periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } }, draw_allowed: true, overtime: { policy: 'none' }, tie_break_order: full,
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } },
  },
  {
    sport_id: 'basketball', name: 'Basketball', scoring_model: 'event', periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } },
    draw_allowed: false, overtime: { policy: 'extra_time', duration_minutes: 5 }, tie_break_order: full,
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} },
  },
  {
    sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false }, single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false }, four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false }, wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false }, wicket: { runs: 0, legal_ball: true, wicket: true },
    },
    draw_allowed: true, overtime: { policy: 'super_over' }, tie_break_order: full,
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } },
  },
  {
    sport_id: 'esports', name: 'Esports', scoring_model: 'round', periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } }, draw_allowed: false, overtime: { policy: 'none' }, tie_break_order: full,
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} },
  },
];
