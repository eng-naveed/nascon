# Architecture Decision Records

**ADR-1 — Fastify + TypeScript + raw SQL (`pg`) instead of an ORM.** Fast to write, no code-generation step in the Docker build, full control of transactions and locks (needed for stock reservation and per-match event ordering).

**ADR-2 — PostgreSQL only; no Redis/MinIO.** No Part I feature needs a cache or object store. Fewer containers → faster build, lower RAM on the 8 GB grader, fewer failure modes. Rate limiting is an in-process sliding window (single API instance).

**ADR-3 — Event sourcing for matches.** The `events` table is append-only; status, score, outcome and compensation state are *derived* on every read by a pure `project()` function. Corrections are new signed `compensation` events; historical rows are never updated.

**ADR-4 — Sports are data.** Scoring templates (event / innings / round models) are JSON stored in `sports.config` and interpreted generically; there are no branches on sport or event names, so a mystery sport works without code changes.

**ADR-5 — Pure domain modules, thin services.** Fixture generators, standings, projection, roster rules, RBAC policy and PDF generation are pure functions with unit tests; services only load/store data and call them.

**ADR-6 — Checkout concurrency via conditional UPDATE.** `UPDATE variants SET stock = stock - q, reserved = reserved + q WHERE stock >= q` in a transaction (rows locked in id order) guarantees no overselling; the mock gateway runs after the reservation commits and either converts the reservation or restocks it. Order ids are idempotency keys.

**ADR-7 — Hand-rolled HS256 JWT with pinned algorithm.** ~30 lines of `crypto`, no dependency; `alg` is fixed to HS256 (so `alg: none` and tampered tokens fail), expiry enforced, secret derived from `DAY1_SALT`. RBAC decisions are a pure function evaluated before any existence check (403 before 404).

**ADR-8 — Offline-first mobile with a SQLite action queue.** Reads are network-first with SQLite fallback; mutations made offline are persisted in the exact `/offline-sync` action format and replayed in `queued_at` order. The server resolves conflicts (server wins, stale-but-valid actions are rebased, duplicates skipped) and reports per-action results shown in the UI.
