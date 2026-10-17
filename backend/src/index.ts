import { buildApp } from './app';
import { config } from './core/config';
import { pool, tx } from './core/db';
import { migrate } from './core/migrate';
import { resetAndSeed } from './core/seed';

async function main() {
  for (let i = 0; ; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (e) {
      if (i > 60) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await migrate();
  const seeded = await pool.query('SELECT count(*)::int AS n FROM tenants');
  if (seeded.rows[0].n === 0) await tx((c) => resetAndSeed(c, {}));
  const app = buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`API listening on :${config.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
