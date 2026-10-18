import { buildApp } from './app';
import { config, missingSalts } from './core/config';
import { pool, tx } from './core/db';
import { migrate } from './core/migrate';
import { needsBaselineSeed, resetAndSeed } from './core/seed';
import { processQueueOnce } from './features/orders/service';
import { loadErased } from './features/day2/qr_guest/privacy';

async function main() {
  const missing = missingSalts();
  if (missing.length) console.warn(`WARNING: ${missing.join(', ')} not set: signatures will not match the grader.`);
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
  // A fresh volume, or a Day 1 volume missing the Phase II baseline, gets the full /reset baseline.
  if (await needsBaselineSeed(pool)) {
    console.log('Baseline seed missing: seeding');
    await tx((c) => resetAndSeed(c, {}));
  }
  await loadErased(pool);
  // internal job queue consumer
  setInterval(() => {
    processQueueOnce().catch(() => undefined);
  }, 1000).unref();
  const app = buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`API listening on :${config.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
