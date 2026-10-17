API integration tests (vitest + Fastify inject + real Postgres)
================================================================

These tests call buildApp().inject(...) against a REAL Postgres. Each test file creates its own
database (t_<file>_<pid>) on the server given by TEST_PG_URL (default postgres://t:t@localhost:55432/t),
runs migrate() + resetAndSeed, and drops the database afterwards, so files run in parallel safely.
DAY1_SALT is forced to 'test-salt' and DATABASE_URL is set before any src module is imported
(see setup.ts: all src imports there are dynamic).

1. Start the throwaway Postgres:

   docker run -d --rm --name nascon-test-pg -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t -e POSTGRES_DB=t -p 55432:5432 postgres:16-alpine
   until docker exec nascon-test-pg pg_isready -U t >/dev/null 2>&1; do sleep 1; done

2. Run (from backend/):

   npx vitest run tests/api --coverage

   Invocation actually used for the measured numbers (identical, but the report is written to a
   separate folder so it does not overwrite backend/coverage/coverage-summary.json from the unit run):

   npx vitest run tests/api --coverage --coverage.reportsDirectory=<dir>

   Unit + API together (what `npx vitest run --coverage` / run_tests.sh now picks up, because the
   default include is tests/**/*.test.ts):

   npx vitest run --coverage

3. Stop it:

   docker rm -f nascon-test-pg

NOTE: without the Postgres container the API test files fail fast with a message explaining how to
start it. run_tests.sh therefore has to start the container first (or exclude tests/api).
