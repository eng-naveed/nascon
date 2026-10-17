#!/usr/bin/env bash
# Runs the unit tests with coverage (regenerating COVERAGE.json). Pass --integration to also
# run the API smoke test against a stack that is already up on http://localhost:8080.
set -euo pipefail
cd "$(dirname "$0")/backend"
[ -d node_modules ] || npm ci --legacy-peer-deps
npx vitest run --coverage
node ../tools/gen-coverage.mjs
if [ "${1:-}" = "--integration" ]; then
  DAY1_SALT="${DAY1_SALT:?set DAY1_SALT to the salt the stack was started with}" python3 tests/integration/smoke.py
fi
