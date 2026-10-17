# Requirements digest — NaSCon '26 Part I

Source of truth: *NaSCon 26 App Dev Part 1* spec (binding API contract). Rules booklet for process rules.

## Conflicts / ambiguities between the two documents
1. **Repository visibility** — booklet says *private* repo, spec §1.3 says the grader clones *without credentials* so the repo must be **public** and registered with the venue desk before 11:15. Spec treated as authoritative.
2. **Grading machine** — booklet: GitHub Actions `ubuntu-latest`, 16 GB. Spec §5.2: organizer machine, Ubuntu 22.04, 4 vCPU, **8 GB**. Stack sized for 8 GB (Postgres + one Node process).
3. **Venues / checkpoints** — spec lists A-01..A-102 for Day 1; booklet A01–A03, A103, A104. Not blocking.
4. **Phase I docker images** — only Postgres 16 and (optionally) Redis/MinIO are approved for Part I; Redis/MinIO are not required by any feature and are not used.
5. **MinIO** — bundle's pinned tag is not pullable; organizers approved a replacement. Not used by the backend.

## Hard constraints
* `DAY1_SALT=<salt> docker compose up -d --build` clean-clone start in ≤10 min; `/health` 200 within 120 s; no manual steps.
* Push at least once in each window 10:45–11:45, 11:45–12:45, 12:45–13:45, 13:45–14:45 (-2 each missed); last push before 15:05:00 PKT.
* No BaaS, no third-party fixture-generation libraries, no hard-coded sport logic.
* Required root files: docker-compose.yml, .env.example, README.md, TRACEABILITY.md, tests/ (see `backend/tests`), run_tests.sh, COVERAGE.json, mobile/ (+ app artifact).

## Scoring (50)
Backend 36 (fixtures ×4, event scoring, standings, store concurrency, roster rules, RBAC/security) · offline sync 4 · mobile UI/HCI 10 · 0.9·P·(n/|V|) + 0.1·P·[coverage ≥ 85 %] per area.
