# Architecture Decision Records

**ADR-1 — Fastify + TypeScript + raw SQL (`pg`) instead of an ORM.** Fast to write, no code-generation step in the Docker build, full control of transactions and locks (needed for stock reservation and per-match event ordering).

**ADR-2 — PostgreSQL only; no Redis/MinIO.** No Part I feature needs a cache or object store. Fewer containers → faster build, lower RAM on the 8 GB grader, fewer failure modes. Rate limiting is an in-process sliding window (single API instance).

**ADR-3 — Event sourcing for matches.** The `events` table is append-only; status, score, outcome and compensation state are *derived* on every read by a pure `project()` function. Corrections are new signed `compensation` events; historical rows are never updated.

**ADR-4 — Sports are data.** Scoring templates (event / innings / round models) are JSON stored in `sports.config` and interpreted generically; there are no branches on sport or event names, so a mystery sport works without code changes.

**ADR-5 — Pure domain modules, thin services.** Fixture generators, standings, projection, roster rules, RBAC policy and PDF generation are pure functions with unit tests; services only load/store data and call them.

**ADR-6 — Checkout concurrency via conditional UPDATE.** `UPDATE variants SET stock = stock - q, reserved = reserved + q WHERE stock >= q` in a transaction (rows locked in id order) guarantees no overselling; the mock gateway runs after the reservation commits and either converts the reservation or restocks it. Order ids are idempotency keys.

**ADR-7 — Hand-rolled HS256 JWT with pinned algorithm.** ~30 lines of `crypto`, no dependency; `alg` is fixed to HS256 (so `alg: none` and tampered tokens fail), expiry enforced, secret derived from `DAY1_SALT`. RBAC decisions are a pure function evaluated before any existence check (403 before 404).

**ADR-8 — Offline-first mobile with a SQLite action queue.** Reads are network-first with SQLite fallback; mutations made offline are persisted in the exact `/offline-sync` action format and replayed in `queued_at` order. The server resolves conflicts (server wins, stale-but-valid actions are rebased, duplicates skipped) and reports per-action results shown in the UI.

## Phase II (Day 2)

**ADR-9 — Self-hosted MediaMTX with an HTTP auth callback and an on-demand placeholder.** `bluenviron/mediamtx:1.9.1-ffmpeg` takes RTMP / WHIP ingest and serves LL-HLS and WebRTC playback. Every publish or read is authorised by `POST /internal/media/auth` on the API (`authMethod: http`), which lives outside `/api/v1` so the rate limiter never applies. Paths with no publisher start an ffmpeg test pattern on demand (`runOnDemand`), so HLS probes for `live/{key}`, `costream/{id}` and `match/{id}` always return a real playlist instead of a mock. SeaweedFS replaces MinIO (the MinIO image could not be pulled) and is provisioned in compose; recording to it is not wired yet.

**ADR-10 — Stream keys as rows with a status, severed after commit.** `stream_keys` holds one row per key (`active` / `rotated` / `revoked`) under a per-player advisory lock, so generate / rotate / revoke never race. `stream_key_override` is an upsert, never a raw insert on the primary key, so a reused key cannot produce a 500. When a key stops being active, the API publishes `stream:{key}` and kicks the MediaMTX connections only after the transaction commits, so a rolled-back revoke never cuts a live stream.

**ADR-11 — In-process event bus and WebSocket / SSE hub instead of a broker.** One Node process serves the API, so fan-out is an in-memory bus: domain writes call `afterCommit` and publish `match:{id}`, `chat:{room}`, `costream:{id}` and `order:{id}`; the hub pushes them to WebSocket and SSE subscribers with 15 s heartbeats. Targeted notifications go to a live socket, else 3 bounded retries, else the DLQ. Push to phones uses self-hosted ntfy, not FCM, to stay clear of BaaS. Redis is in compose and checked by `/health`, ready for multi-instance pub/sub, but is not on the hot path today.

**ADR-12 — The guest read-only boundary is an `onRequest` hook.** Any bearer starting with `guest_` on a write method gets `403 GUEST_WRITE_FORBIDDEN` before body parsing, validation or routing. Enforcing it once, globally, means a new write route can never forget the check, and malformed or empty bodies still get the 403 the contract expects. Only token issuing and the cart-merge probe are exempt.

**ADR-13 — QR codes keyed by entity id with a DB-free hot path.** The short code is the entity id, and the mapping is created lazily on first lookup for any existing match, player, club or co-stream session, so newly created entities work without a separate create call. Inspect responses are cached in memory with single-flight loads and invalidated through the bus on every status-changing write, which keeps the k6 path off the database. Scan telemetry stores only device family and the UTC hour, never IP or user agent (NFR-9).

**ADR-14 — Cart merge reserves stock in the same transaction, exactly once.** The merge reuses the Day 1 conditional update (`stock >= q`), so guest carts cannot oversell, and stores its response under the guest token. An identical replay returns the stored body byte for byte; the same token with a different user or cart returns `409 GUEST_TOKEN_ALREADY_MERGED`. A per-token lock serialises concurrent duplicate merges.

**ADR-15 — Moderation as a pure normaliser plus a per-room DLQ with virtual backoff.** Leetspeak normalisation and flood detection are pure functions tested against the spec vectors; flood is checked before profanity. Failed notification deliveries retry 3 times with computed (virtual) backoff instead of sleeping, so the probe answers in milliseconds and stays deterministic. The DLQ is scoped per chat room; `/metrics` reports the global depth.

**ADR-16 — Follow graph as one row per pair, counted on read.** `follows` has primary key `(follower_id, athlete_id)`; follow is `INSERT ... ON CONFLICT DO NOTHING` and unfollow is `DELETE`, both idempotent. `follower_count` is always `count(*)`, never a stored counter, so simultaneous toggle bursts cannot drift it; `day2-follow.test.ts` checks this with concurrent bursts. Privacy erasure deletes the erased user's follow rows.
