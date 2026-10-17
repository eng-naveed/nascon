# Traceability matrix

Paths are relative to the repo root. "Unit" = `backend/tests/*.test.ts` (vitest), "Smoke" = `backend/tests/integration/smoke.py` (live stack).

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
| NFR-4 | Offline tolerance: SQLite cache, persistent queue, sync with conflict handling | `mobile/multi-sport/src/db`, `mobile/multi-sport/src/features/sync`; server `backend/src/features/offline/service.ts` | Smoke "sync", "sync replay"; on-device desk check |
| NFR-5 | Security: JWT (alg pinned, expiry), rate limit, validation, 1 MB limit, secure token storage | `backend/src/core/crypto.ts`, `backend/src/app.ts`, mobile `expo-secure-store` | Unit `crypto.test.ts` ; Smoke "rate limit", "413", "401 tampered", "401 alg none" |
| NFR-7 | One-command reproducible start, baseline seed, repeatable `/reset` | `docker-compose.yml`, `backend/Dockerfile`, `backend/src/core/seed.ts` | Smoke "health", "reset", "reset2" |
| §5.14 | Offline sync endpoint (ordering, rebase, duplicates, INVALID_BASE_VERSION) | `backend/src/features/offline/service.ts` | Smoke "sync", "sync replay" |
| §8 | Mobile screens, roles, sync indicator, HCI | `mobile/multi-sport/src/app`, `src/components`, `src/features` | Manual desk check |
