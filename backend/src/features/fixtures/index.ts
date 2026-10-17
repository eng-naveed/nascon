import { z } from 'zod';
import { validation } from '../../core/errors';
import { generateRoundRobin } from './roundRobin';
import { generateSwiss } from './swiss';
import { generateDoubleElim, generateSingleElim } from './elimination';
import { parse, idSchema } from '../../core/validate';

const base = z.object({
  format: z.enum(['round_robin', 'swiss', 'single_elim', 'double_elim']),
  teams: z.array(idSchema),
  params: z.record(z.string(), z.any()).optional(),
});

const limits: Record<string, [number, number]> = {
  round_robin: [2, 40],
  swiss: [2, 64],
  single_elim: [2, 128],
  double_elim: [3, 128],
};

const int = z.number().int();
const rrParams = z.object({
  legs: int.optional(),
  withdrawals: z.array(z.object({ team_id: idSchema, after_round: int })).optional(),
  withdrawal_policy: z.enum(['void_all', 'forfeit_remaining']).optional(),
});
const swissParams = z.object({
  total_rounds: int.optional(),
  round: int.optional(),
  history: z
    .array(
      z.object({
        round: int,
        matches: z.array(z.object({ home: idSchema, away: idSchema, result: z.enum(['home', 'away', 'draw']) })),
        bye: idSchema.nullable().optional(),
      }),
    )
    .optional(),
});
const elimParams = z.object({
  results: z.array(z.object({ match_id: idSchema, winner: idSchema })).optional(),
  third_place_match: z.boolean().optional(),
  bracket_reset: z.boolean().optional(),
});

export function generateFixtures(body: unknown) {
  const req = parse(base, body);
  if (new Set(req.teams).size !== req.teams.length) throw validation(['teams']);
  const [lo, hi] = limits[req.format];
  if (req.teams.length < lo || req.teams.length > hi) throw validation(['teams']);
  const raw = req.params ?? {};
  const sub = (schema: z.ZodTypeAny) => {
    try {
      return parse(schema, raw) as any;
    } catch (e: any) {
      const fields = (e.details?.fields ?? []).map((f: string) => `params.${f}`);
      throw validation(fields.length ? fields : ['params']);
    }
  };
  switch (req.format) {
    case 'round_robin':
      return generateRoundRobin(req.teams, sub(rrParams));
    case 'swiss':
      return generateSwiss(req.teams, sub(swissParams));
    case 'single_elim':
      return generateSingleElim(req.teams, sub(elimParams));
    default:
      return generateDoubleElim(req.teams, sub(elimParams));
  }
}
