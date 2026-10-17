// Generates COVERAGE.json from the vitest v8 summary. Areas map to the pure domain-logic
// modules that the unit tests exercise (route handlers / SQL services are covered by
// backend/tests/integration/smoke.py against the running stack, not by line coverage).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const summary = JSON.parse(readFileSync(resolve(root, 'backend/coverage/coverage-summary.json'), 'utf8'));
const areas = {
  fixtures: ['src/features/fixtures/'],
  scoring: ['src/features/events/projection.ts', 'src/core/crypto.ts'],
  standings: ['src/features/standings/compute.ts'],
  store: ['src/features/store/pdf.ts'],
  roster: ['src/features/roster/rules.ts'],
  rbac: ['src/features/rbac/policy.ts'],
};
const out = {};
for (const [area, prefixes] of Object.entries(areas)) {
  let covered = 0;
  let total = 0;
  for (const [file, m] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = file.replace(/\\/g, '/').split('/backend/')[1] ?? file;
    if (prefixes.some((p) => rel.startsWith(p) || rel === p)) {
      covered += m.lines.covered;
      total += m.lines.total;
    }
  }
  // round DOWN so the declared figure never exceeds the measured one
  out[area] = total ? Math.floor((covered / total) * 1000) / 10 : 0;
}
writeFileSync(resolve(root, 'COVERAGE.json'), JSON.stringify(out) + '\n');
console.log('COVERAGE.json', out);
