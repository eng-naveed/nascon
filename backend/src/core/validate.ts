import { z } from 'zod';
import { AppError } from './errors';

export const idSchema = z.string().regex(/^[A-Za-z0-9_.:\-]{1,64}$/);

/** Parses data with zod and converts failures into the contract's 400 VALIDATION_ERROR. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields = new Set<string>();
  for (const issue of r.error.issues) {
    const path = issue.path.map(String);
    if (path.length) {
      fields.add(path.join('.'));
      fields.add(path[0]);
    }
    if (issue.code === 'unrecognized_keys') for (const k of (issue as any).keys ?? []) fields.add(String(k));
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', { fields: [...fields] });
}
