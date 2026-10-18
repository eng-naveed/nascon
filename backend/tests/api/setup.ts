/**
 * Shared harness for the API integration tests (tests/api/*.test.ts).
 *
 * Each test file gets its OWN throwaway database (created on the test Postgres given by
 * TEST_PG_URL, default postgres://t:t@localhost:55432/t), so files can run in parallel.
 * Environment variables are set BEFORE any src module is imported: src/core/config.ts reads
 * them at import time, therefore every src import in this harness is dynamic.
 */
import pg from 'pg';
import type { FastifyInstance, InjectOptions } from 'fastify';

const ADMIN_URL = process.env.TEST_PG_URL ?? 'postgres://t:t@localhost:55432/t';
process.env.DAY1_SALT = 'test-salt';
process.env.DAY2_SALT = 'test-salt-d2';

export const SALT = 'test-salt';
export const SALT2 = 'test-salt-d2';
export const PASSWORD = 'Nascon@26';

export interface Ctx {
  app: FastifyInstance;
  /** src modules, loaded after the env was set */
  db: typeof import('../../src/core/db');
  crypto: typeof import('../../src/core/crypto');
  reset: (body?: unknown) => Promise<void>;
  close: () => Promise<void>;
}

/** Admin connection; a server-side termination must not surface as an unhandled 'error' event. */
const adminClient = () => {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  c.on('error', () => {});
  return c;
};

let ipCounter = 0;
/** A fresh client address per call site keeps the per-IP /api/v1 rate limiter out of the way. */
export const freshIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`;

let uid = 0;
/** Unique id per test so tests never collide on event/order/request ids. */
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

export async function boot(name: string): Promise<Ctx> {
  const dbName = `t_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}_${process.pid}`;
  const admin = adminClient();
  try {
    await admin.connect();
  } catch (e: any) {
    throw new Error(
      `API tests need a throwaway Postgres at ${ADMIN_URL} (set TEST_PG_URL to override). Start one with:\n` +
        '  docker run -d --rm --name nascon-test-pg -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t -p 55432:5432 postgres:16-alpine\n' +
        `(${e?.message ?? e})`,
    );
  }
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.pathname = '/' + dbName;
  process.env.DATABASE_URL = u.toString();

  const db = await import('../../src/core/db');
  const crypto = await import('../../src/core/crypto');
  const { migrate } = await import('../../src/core/migrate');
  const { resetAndSeed } = await import('../../src/core/seed');
  const { buildApp } = await import('../../src/app');
  await migrate();
  await db.tx((c) => resetAndSeed(c, {}));
  const app = buildApp();
  await app.ready();
  return {
    app,
    db,
    crypto,
    reset: async (body?: unknown) => {
      const r = await app.inject({ method: 'POST', url: '/audit/v1/reset', payload: (body ?? {}) as any });
      if (r.statusCode !== 200) throw new Error('reset failed: ' + r.body);
    },
    close: async () => {
      await app.close();
      await db.pool.end();
      const a = adminClient();
      await a.connect();
      // pool.end() resolves before its idle sockets have closed: wait for the backends to go away so the
      // forced drop does not terminate live connections (57P01)
      for (let i = 0; i < 100; i++) {
        const r = await a.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [dbName]);
        if (!r.rows[0].n) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

export interface Res {
  status: number;
  body: any;
  headers: Record<string, any>;
  raw: string;
}

/** Thin inject wrapper returning parsed JSON. */
export async function call(app: FastifyInstance, method: string, url: string, payload?: unknown, opts: Partial<InjectOptions> = {}): Promise<Res> {
  const r = await app.inject({ method: method as any, url, payload: payload as any, remoteAddress: freshIp(), ...opts });
  let body: any = null;
  try {
    body = r.body ? JSON.parse(r.body) : null;
  } catch {
    body = r.body;
  }
  return { status: r.statusCode, body, headers: r.headers, raw: r.body };
}

export const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
