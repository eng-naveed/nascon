# NaSCon '26 — Multi-Sport League & Club Operations Platform (Part I)

Backend (Fastify + TypeScript + PostgreSQL) and an Expo React Native mobile app.

## Run the backend

```bash
cp .env.example .env            # optional; the salt can also be passed inline
DAY1_SALT=<your-team-salt> docker compose up -d --build
curl localhost:8080/health      # {"status":"ok"} once Postgres is up and baseline data is seeded
```

* API: `http://localhost:8080` — autograder contract under `/audit/v1/*`, app routes under `/api/v1/*`.
* `DAY1_SALT` is read only from the environment. It is never committed.
* `POST /audit/v1/reset` wipes and re-seeds the baseline (tenants, sports, store, RBAC scenario, demo accounts, demo league).
* Only Docker is required on the host. Services: `db` (postgres:16-alpine) and `api` (Node 20).

## Demo accounts (section 8.3, re-created on every start and `/reset`)

| Role | Email | Password |
|---|---|---|
| Platform Super-Admin | admin@nascon.test | Nascon@26 |
| League Organizer (league-alpha-1) | organizer@nascon.test | Nascon@26 |
| Club Manager (club-alpha-1) | manager@nascon.test | Nascon@26 |
| Player (player-alpha-1) | player@nascon.test | Nascon@26 |
| General Viewer | viewer@nascon.test | Nascon@26 |

The seed also contains demo league `league-alpha-1` ("Alpha Premier League", 4 clubs, 6 fixtures, two completed matches and one live match) and squads `sq-alpha-1` / `sq-alpha-2` so the mobile screens show real data.

## The five demo flows (judges)

1. **Standings and a match** — log in as any user, *Standings* tab, pick the league, tap a team; *Fixtures* tab, open the live match (score refreshes every 3 s).
2. **Merchandise purchase** — *Store*, choose a size, add to cart, pay with token `tok_success`, open the receipt (PDF share). Try `tok_declined` and `tok_capture_fail` for error handling.
3. **Roster action** — log in as `manager@nascon.test`, *Roster*, transfer or loan a player (confirmation shown).
4. **Scoring** — log in as `organizer@nascon.test`, *Scoring*, start/score/end a match, then compensate an event.
5. **Offline** — with data loaded, enable airplane mode: cached screens still open and the sync bar shows *Offline*. Queue one scoring action (organizer) and one roster action (manager); force-close and reopen — they remain *Pending*. Turn the network back on: they sync automatically (or press *Sync now*) and per-action results are shown.

## Mobile (iOS / Android)

`mobile/multi-sport` — Expo SDK 58, Expo Router, expo-sqlite (cache + persistent action queue), expo-secure-store (JWT).

* The server address is editable in-app (*Settings*). Defaults: iOS simulator `http://localhost:8080`, Android emulator `http://10.0.2.2:8080`; a physical phone uses the laptop's LAN IP.
* iOS: `cd mobile/multi-sport && npx expo run:ios --configuration Release` installs the app on the simulator / device.
* Android: `cd mobile/multi-sport && npx expo prebuild -p android && cd android && ./gradlew assembleRelease`, then copy the APK to `mobile/release/app-release.apk`.

## Tests

```bash
./run_tests.sh                 # unit tests + coverage, regenerates COVERAGE.json
./run_tests.sh --integration   # plus the API smoke test (needs the stack up, DAY1_SALT set)
```

`COVERAGE.json` reports line coverage of the pure domain-logic modules per area (fixtures, scoring + signatures, standings, store receipt/PDF, roster rules, RBAC policy). SQL service layers and route handlers are exercised by `backend/tests/integration/smoke.py` (end-to-end against the live stack: signatures, idempotency, compensation, standings, roster, 20-way checkout race, RBAC matrix, rate limit, body-size limit, offline sync), not by line coverage.

## Layout

```
docker-compose.yml  .env.example  run_tests.sh  COVERAGE.json  TRACEABILITY.md  REQUIREMENTS.md
backend/            Fastify API (src/app.ts routes, src/features/* domain modules, src/core/* infra)
mobile/multi-sport  Expo app
tools/              coverage generator
```
