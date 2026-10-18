// Generates COVERAGE.json (Day 1) and COVERAGE_DAY2.json (Phase II) from the vitest v8 summary produced by ./run_tests.sh.
// Every area is measured over ALL of its source files (domain logic AND the SQL service layers),
// by unit tests plus the API integration tests (tests/api, real Postgres). Figures are rounded DOWN.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const summary = JSON.parse(readFileSync(resolve(root, 'backend/coverage/coverage-summary.json'), 'utf8'));
const day1 = {
  fixtures: ['src/features/fixtures/'],
  scoring: ['src/features/events/', 'src/features/sports/', 'src/core/crypto.ts'],
  standings: ['src/features/standings/'],
  store: ['src/features/store/'],
  roster: ['src/features/roster/'],
  rbac: ['src/features/rbac/'],
};
// Phase II modules (spec 7.2). A module with no source files yet is reported as 0, never guessed.
const day2 = {
  streaming: ['src/features/day2/streaming/'],
  costream: ['src/features/day2/costream/'],
  qr_guest: ['src/features/day2/qr_guest/'],
  moderation_dlq: ['src/features/day2/moderation/'],
  observability: ['src/features/day2/observability/', 'src/core/metrics.ts', 'src/core/health.ts'],
};

function measure(areas) {
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
  return out;
}

const out1 = measure(day1);
writeFileSync(resolve(root, 'COVERAGE.json'), JSON.stringify(out1) + '\n');
console.log('COVERAGE.json', out1);
const out2 = measure(day2);
writeFileSync(resolve(root, 'COVERAGE_DAY2.json'), JSON.stringify(out2, null, 2) + '\n');
console.log('COVERAGE_DAY2.json', out2);
