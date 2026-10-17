#!/usr/bin/env bash
# Runs unit + API integration tests with coverage and regenerates COVERAGE.json.
#
# The API tests (backend/tests/api) call the real Fastify app against a REAL throwaway Postgres.
# This script starts one with Docker (postgres:16-alpine, random host port, removed on exit).
# Without Docker the API tests are skipped and COVERAGE.json is regenerated from the unit tests only,
# so the declared figures always match what was actually measured.
#
#   ./run_tests.sh                 unit + API tests, coverage, COVERAGE.json
#   ./run_tests.sh --integration   plus the end-to-end smoke test against a running stack
#                                  (stack on http://localhost:8080, DAY1_SALT set to the stack's salt)
set -euo pipefail
cd "$(dirname "$0")/backend"
[ -d node_modules ] || npm ci --legacy-peer-deps

NAME="nascon-test-pg-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  trap cleanup EXIT
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
  until docker exec "$NAME" pg_isready -U t >/dev/null 2>&1; do sleep 1; done
  PORT="$(docker port "$NAME" 5432/tcp | head -n1 | sed 's/.*://')"
  export TEST_PG_URL="postgres://t:t@127.0.0.1:${PORT}/t"
  echo "API tests: throwaway Postgres on 127.0.0.1:${PORT}"
  npx vitest run --coverage
else
  echo "Docker not available: skipping API integration tests (coverage will be lower)."
  npx vitest run --coverage --exclude 'tests/api/**'
fi

node ../tools/gen-coverage.mjs

if [ "${1:-}" = "--integration" ]; then
  DAY1_SALT="${DAY1_SALT:?set DAY1_SALT to the salt the stack was started with}" python3 tests/integration/smoke.py
fi
