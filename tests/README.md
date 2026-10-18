# tests/

Phase II QA harness (spec 6.2–6.4). Backend unit + API tests (Day 1 and Day 2) live in
[`backend/tests`](../backend/tests) and run with `./run_tests.sh` from the repo root.

| Path | What | Run |
|---|---|---|
| `selenium/test_guest_grid.py` | Guest Web Player on the Selenium Grid 4 (spec 6.2.3 Tests 1–3 + co-stream chat) | `pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml` |
| `appium/test_mobile_deeplink.py` | Android deep links + cross-surface chat (spec 6.3) | `pytest tests/appium/ --junitxml=tests/reports/appium-report.xml` |
| `k6_load.js` | The exact spec 6.4 load profile | `k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js` |
| `reports/` | Real outputs of the runs above (never hand-written) | |

Setup: `python3 -m pip install -r tests/requirements.txt`, then `DAY1_SALT=... DAY2_SALT=... docker compose up -d --build`
(Apple Silicon: add `-f docker-compose.arm64.yml`). Environment overrides: `GRID_URL` (default `http://localhost:4444`),
`BASE_URL` (what the browsers open, default `http://localhost:8080`), `API_URL` (what the test process calls,
default `http://localhost:8080`), `BROWSERS` (default `chrome,firefox`), `APPIUM_URL` (default `http://localhost:4723`).
