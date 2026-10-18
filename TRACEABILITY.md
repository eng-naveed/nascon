# Traceability matrix

Paths are relative to the repo root. "Unit" = `backend/tests/*.test.ts` (vitest), "API" = `backend/tests/api/*.test.ts` (Fastify inject against a real Postgres), "Smoke" = `backend/tests/integration/smoke.py` (live stack).

| ID | Requirement | Source | Tests |
|---|---|---|---|
| FR-1.1 | Multi-sport taxonomy as data, mystery sport via `POST /audit/v1/sports`; event / innings / round models | `backend/src/features/sports/service.ts`, `backend/src/features/events/projection.ts` | Unit `projection.test.ts`; Smoke "mystery sport", "sport exists", "sql injection 400" |
| FR-1.1 | Append-only event log, compensating events, HMAC signatures | `backend/src/features/events/service.ts`, `backend/src/core/crypto.ts` | Unit `crypto.test.ts` (Appendix A vectors), `projection.test.ts`; Smoke "score", "idempotent", "dup id", "comp", "comp twice", "projection" |
| FR-1.2 | League setup with points / tie-break / qualification config | `backend/src/features/standings/service.ts` | Smoke "league" |
| FR-1.3 | Round-robin (circle method, byes, withdrawals) | `backend/src/features/fixtures/roundRobin.ts` | Unit `fixtures.test.ts` (n = 2..40, 1–2 legs) ; Smoke "rr" |
| FR-1.3 | Swiss (backtracking pairing, Buchholz, byes) | `backend/src/features/fixtures/swiss.ts` | Unit `fixtures.test.ts` (swiss) ; Smoke "swiss limit" |
| FR-1.3 | Single / double elimination, byes, third place, bracket reset | `backend/src/features/fixtures/elimination.ts` | Unit `fixtures.test.ts` ; Smoke "de" |
| FR-1.3 | Match status state machine (illegal transitions rejected) | `backend/src/features/events/service.ts` | Smoke "start", "end draw", "404 match" |
| FR-1.4 | Standings, tie-break recursion (H2H mini-league), clinched / eliminated, lots | `backend/src/features/standings/compute.ts` | Unit `standings.test.ts` ; Smoke "standings" |
| FR-2.1 | Club profiles, tenant isolation | `backend/src/app.ts` (`/api/v1/clubs`), `backend/src/core/seed.ts` | Smoke RBAC rows; mobile Club screen |
| FR-2.2 | Roster: transfer / loan / release, window, squad size, positions, audit trail, auto-return, deferred transfer | `backend/src/features/roster/service.ts`, `rules.ts` | Unit `rules.test.ts` ; Smoke "roster setup" … "loan return once" |
| FR-2.3 | Merchandise store, concurrency-safe stock, mock gateway, PDF receipt | `backend/src/features/store/service.ts`, `pdf.ts` | Unit `store.test.ts` ; Smoke "20 buyers", "inventory", "receipt sig", "pdf", "declined", "restock", "discount" |
| FR-5.1 | 5-tier RBAC, tenant isolation, probe routes | `backend/src/features/rbac/policy.ts`, `service.ts` | Unit `rules.test.ts` ; Smoke "P1".."P7", 401 cases |
| NFR-3 | 20 buyers / last unit → 1 × 201, 19 × 409, stock 0, reserved 0 | `backend/src/features/store/service.ts` | Smoke "20 buyers", "inventory" |
| NFR-4 | Offline tolerance: SQLite cache, persistent queue, sync with conflict handling | `mobile/multi-sport/src/db`, `mobile/multi-sport/src/state/app.tsx`, `mobile/multi-sport/src/app/sync.tsx`; server `backend/src/features/offline/service.ts` | Smoke "sync", "sync replay"; on-device desk check |
| NFR-5 | Security: JWT (alg pinned, expiry), rate limit, validation, 1 MB limit, secure token storage | `backend/src/core/crypto.ts`, `backend/src/app.ts`, mobile `expo-secure-store` | Unit `crypto.test.ts` ; Smoke "rate limit", "413", "401 tampered", "401 alg none" |
| NFR-7 | One-command reproducible start, baseline seed, repeatable `/reset` | `docker-compose.yml`, `backend/Dockerfile`, `backend/src/core/seed.ts` | Smoke "health", "reset", "reset2" |
| §5.14 | Offline sync endpoint (ordering, rebase, duplicates, INVALID_BASE_VERSION) | `backend/src/features/offline/service.ts` | Smoke "sync", "sync replay" |
| §8 | Mobile screens, roles, sync indicator, HCI | `mobile/multi-sport/src/app`, `src/components`, `src/features` | Manual desk check |
| FR-2.3 | Order states Pending..Refunded, each transition emits a domain event to the internal queue; queue consumer; ops metrics | `backend/src/features/orders/service.ts`, `backend/src/core/metrics.ts`, `backend/src/index.ts` (worker) | API `backend/tests/api/extras.test.ts` |

## Day 2 (Part II)

Backend modules live under `backend/src/features/day2/`; API tests under `backend/tests/api/day2-*.test.ts`; QA suites under `tests/`.

| ID | Requirement | Source | Tests |
|---|---|---|---|
| FR-3.1 | Public athlete identity: `GET /api/v1/players/{id}/profile` (club, career record from the event log, upcoming fixtures, VOD archive, past streams); concurrency-safe follow / unfollow (`POST`/`DELETE /api/v1/players/{id}/follow`, one row per pair, `ON CONFLICT DO NOTHING`, follower_count = count(*)) | `backend/src/features/day2/athletes/service.ts`, `day2/web/pages.ts` (`/web/players/:id`); mobile `src/app/entity/[id].tsx` | API `day2-athletes.test.ts` (idempotency, 40-request toggle burst with zero drift, 401/403/404), `day2-web.test.ts` |
| FR-3.2 | Solo streaming: stream keys generate / rotate / revoke, MediaMTX HTTP auth, kick on revoke, dynamic overlay via score WS | `day2/streaming/service.ts`, `streaming/media.ts`, `infra/mediamtx/mediamtx.yml`; mobile `src/app/golive.tsx` | API `day2-streaming.test.ts`; CI HLS + RTMP probes (`.github/workflows/autograde.yml`) |
| FR-3.3 | 4-way co-streaming, layouts, host handoff, invites, host controls | `day2/costream/service.ts`, `costream/live.ts`; mobile `src/app/stream/[id].tsx` | API `day2-streaming.test.ts`, `day2-realtime.test.ts`; Selenium co-stream chat; Appium cross-surface chat |
| FR-4.1 | Dynamic QR deep links, `/q/{code}` 302, scan telemetry, SVG / PNG / PDF export | `day2/qr_guest/qr.ts`, `qr_guest/render.ts`; mobile `src/app/scan.tsx` | API `day2-qr-guest.test.ts`; Selenium Test 1; Appium deep links |
| FR-4.2 | Zero-account guest experience (guest session, guest web player) | `day2/qr_guest/guest.ts`, `day2/web/pages.ts`, `web/client.ts` | API `day2-web.test.ts`; Selenium Tests 1 and 3 |
| FR-4.3 | Server-enforced read-only boundary (403 GUEST_WRITE_FORBIDDEN before parsing) | `backend/src/app.ts` (guest guard), `day2/qr_guest/guest.ts` | API `day2-foundations.test.ts`; Selenium Test 2 |
| FR-4.4 | Progressive registration and atomic cart merge (reserve once, replay, 409 merged) | `day2/qr_guest/cart.ts`, `web/client.ts` (modal, resume) | API `day2-qr-guest.test.ts` |
| FR-5.2 | Notification bus, bounded retries, per-room DLQ, ntfy push | `day2/observability/bus.ts`, `observability/hub.ts`, `observability/ntfy.ts`, `day2/moderation/service.ts` | API `day2-moderation.test.ts`, `day2-realtime.test.ts` |
| FR-5.3 | Chat moderation: leetspeak normaliser, flood / rate limit, kick / mute | `day2/moderation/normalize.ts`, `moderation/service.ts`, `moderation/chat.ts` | API `day2-moderation.test.ts`, `day2-chat.test.ts` |
| NFR-1 | WebSocket broadcast latency | `day2/observability/hub.ts`, `observability/realtime.ts` | API `day2-realtime.test.ts`; Selenium Test 3 (banner within 0.5 s) |
| NFR-2 | Scale: 500 guest + 50 chat VUs, zero failures, p95 < 800 ms | DB-free QR cache in `qr_guest/qr.ts`, in-memory DLQ snapshot | k6 `tests/k6_load.js` -> `tests/reports/k6-summary.json` |
| NFR-6 | Observability: `/metrics` (text/plain; version=0.0.4), health checks | `backend/src/core/metrics.ts`, `core/health.ts` | API `day2-foundations.test.ts` |
| NFR-8 | Accessibility (keyboard, ARIA, 48 px targets, modal focus) | `day2/web/pages.ts`, `web/styles.ts` | Selenium a11y contract test |
| NFR-9 | Data minimisation, `DELETE /audit/v1/privacy/user/{id}`, no IP / UA stored | `day2/qr_guest/privacy.ts`, `qr_guest/qr.ts` | API `day2-qr-guest.test.ts` |
