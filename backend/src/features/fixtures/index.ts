import { z } from 'zod';
import { validation } from '../../core/errors';
import { generateRoundRobin } from './roundRobin';
import { generateSwiss } from './swiss';
import { generateDoubleElim, generateSingleElim } from './elimination';
import { parse, idSchema } from '../../core/validate';

const base = z.object({
  format: z.enum(['round_robin', 'swiss', 'single_elim', 'double_elim']),
  teams: z.array(idSchema),
  params: z.record(z.string(), z.any()).nullish(),
});

const limits: Record<string, [number, number]> = {
  round_robin: [2, 40],
  swiss: [2, 64],
  single_elim: [2, 128],
  double_elim: [3, 128],
};

const int = z.number().int();
const rrParams = z.object({
  legs: int.nullish(),
  withdrawals: z.array(z.object({ team_id: idSchema, after_round: int })).nullish(),
  withdrawal_policy: z.enum(['void_all', 'forfeit_remaining']).nullish(),
});
const swissParams = z.object({
  total_rounds: int.nullish(),
  round: int.nullish(),
  history: z
    .array(
      z.object({
        round: int,
        matches: z.array(z.object({ home: idSchema, away: idSchema, result: z.enum(['home', 'away', 'draw']) })),
        bye: idSchema.nullable().optional(),
      }),
    )
    .nullish(),
});
const elimParams = z.object({
  results: z.array(z.object({ match_id: idSchema, winner: idSchema })).nullish(),
  third_place_match: z.boolean().nullish(),
  bracket_reset: z.boolean().nullish(),
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
      const bare: string[] = e.details?.fields ?? [];
      const fields = [...new Set([...bare.map((f: string) => `params.${f}`), ...bare])];
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
