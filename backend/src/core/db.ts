import { Pool, PoolClient } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = Pick<PoolClient, 'query'>;

/** Callbacks queued by code running inside tx(): they run only once the transaction has committed. */
const pending = new WeakMap<object, (() => void)[]>();

/**
 * Runs `fn` after the surrounding tx() commits (dropped on rollback). Outside a tx() it runs immediately.
 * Used for cache invalidation and bus publishing, which must never observe uncommitted state.
 */
export function afterCommit(c: object, fn: () => void) {
  const q = pending.get(c);
  if (q) q.push(fn);
  else fn();
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  const queued: (() => void)[] = [];
  pending.set(c, queued);
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    pending.delete(c);
    for (const f of queued) {
      try {
        f();
      } catch {
        /* a post-commit hook never fails the committed write */
      }
    }
    return r;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    pending.delete(c);
    c.release();
  }
}
