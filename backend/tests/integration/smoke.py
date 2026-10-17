"""Integration smoke test against a running stack (default http://localhost:8080).
Usage: DAY1_SALT=demo-salt python3 tests/integration/smoke.py"""
import base64, concurrent.futures as cf, hashlib, hmac, json, os, sys, threading, time, urllib.request, urllib.error

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
SALT = os.environ.get("DAY1_SALT", "demo-salt")
fails = []

def call(method, path, body=None, token=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}"), dict(r.headers)
    except urllib.error.HTTPError as e:
        txt = e.read()
        try: return e.code, json.loads(txt), dict(e.headers)
        except Exception: return e.code, {"raw": txt.decode()[:200]}, dict(e.headers)

def check(name, cond, info=""):
    if not cond:
        fails.append(name); print("FAIL", name, info)
    else: print("ok  ", name)

def canon(o): return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sig(i, p): return hmac.new(SALT.encode(), (i + "|" + canon(p)).encode(), hashlib.sha256).hexdigest()

s, b, _ = call("GET", "/health"); check("health", s == 200 and b["status"] == "ok")
s, b, _ = call("POST", "/audit/v1/reset", {}); check("reset", s == 200 and b["status"] == "reset_complete" and b["stock"]["var-jersey-001-M"] == 1, b)
s, b2, _ = call("POST", "/audit/v1/reset", {"seed": 7, "stock": {"var-jersey-001-M": 1}}); check("reset2", s == 200 and b2["seed"] == 7)

# --- events / score / signature
call("POST", "/audit/v1/reset", {})
ev = lambda i, m, t, p=None: call("POST", "/audit/v1/events", {"event_id": i, "match_id": m, "type": t, "payload": p or {}})
s, b, _ = ev("e1", "m1", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"}); check("init", s == 201, b)
s, b, _ = ev("e2", "m1", "match_start"); check("start", s == 201)
s, b, _ = ev("e3", "m1", "score", {"team_id": "t1", "event_type": "goal"}); check("score", s == 201 and b["signature"] == sig("e3", {"team_id": "t1", "event_type": "goal"}), b)
s, b, _ = ev("e3", "m1", "score", {"team_id": "t1", "event_type": "goal"}); check("idempotent", s == 200)
s, b, _ = ev("e3", "m1", "score", {"team_id": "t2", "event_type": "goal"}); check("dup id", s == 409 and b["error"]["code"] == "DUPLICATE_EVENT_ID")
s, b, _ = ev("e4", "m1", "score", {"team_id": "t1", "event_type": "nope"}); check("unknown event type", s == 400 and b["error"]["code"] == "UNKNOWN_EVENT_TYPE")
s, b, _ = ev("e5", "m1", "compensation", {"compensates": "e3", "reason": "var"}); check("comp", s == 201)
s, b, _ = ev("e6", "m1", "compensation", {"compensates": "e3", "reason": "var"}); check("comp twice", s == 409 and b["error"]["code"] == "INVALID_COMPENSATION")
s, b, _ = call("GET", "/audit/v1/score/m1"); check("projection", s == 200 and b["home"]["score"] == 0 and b["version"] == 4 and b["events"][2]["compensated"], b)
s, b, _ = ev("e7", "m1", "match_end"); check("end draw", s == 201)
s, b, _ = call("GET", "/audit/v1/score/m1"); check("draw outcome", b["outcome"] == "draw")
s, b, _ = ev("e8", "mX", "score", {"team_id": "t1", "event_type": "goal"}); check("404 match", s == 404 and b["error"]["code"] == "MATCH_NOT_FOUND")

# --- sports
mystery = {"sport_id": "kabaddi", "name": "Kabaddi", "scoring_model": "event", "periods": {"count": 2, "duration_minutes": 20},
           "scoring_events": {"raid_point": {"points": 1}, "all_out": {"points": 2}}, "draw_allowed": False, "overtime": {"policy": "golden_score", "duration_minutes": 5},
           "roster": {"min_squad_size": 7, "max_squad_size": 12, "required_positions": {"raider": 2}}}
s, b, _ = call("POST", "/audit/v1/sports", mystery); check("mystery sport", s == 201 and b["config"]["scoring_events"]["all_out"]["points"] == 2, b)
s, b, _ = call("POST", "/audit/v1/sports", mystery); check("sport exists", s == 409 and b["error"]["code"] == "SPORT_EXISTS")
s, b, _ = call("POST", "/audit/v1/sports", {"sport_id": "x'; DROP TABLE sports;--", "name": "x"}); check("sql injection 400", s == 400 and b["error"]["code"] == "VALIDATION_ERROR")

# --- league + standings
lg = {"league_id": "lg-1", "sport_id": "kabaddi", "teams": ["t1", "t2", "t3"], "fixtures": [{"match_id": "k1", "home": "t1", "away": "t2"}, {"match_id": "k2", "home": "t2", "away": "t3"}, {"match_id": "k3", "home": "t1", "away": "t3"}],
      "qualification": {"spots": 1}}
s, b, _ = call("POST", "/audit/v1/leagues", lg); check("league", s == 201 and b["fixture_count"] == 3, b)
for m, scores in [("k1", {"t1": 2, "t2": 1}), ("k2", {"t2": 1, "t3": 1}), ("k3", {"t3": 2, "t1": 1})]:
    ev("s-" + m, m, "match_start")
    i = 0
    for team, n in scores.items():
        for _ in range(n):
            i += 1; ev(f"s-{m}-{i}", m, "score", {"team_id": team, "event_type": "raid_point"})
    ev("s-end-" + m, m, "match_end")
s, b, _ = call("GET", "/audit/v1/standings/lg-1"); check("standings", s == 200 and len(b["table"]) == 3 and b["table"][0]["points"] >= b["table"][1]["points"], b)
print("   table:", [(r["team_id"], r["points"], r["status"], r["resolved_by"]) for r in b["table"]])

# --- fixtures
s, b, _ = call("POST", "/audit/v1/fixtures", {"format": "round_robin", "teams": ["a", "b", "c", "d", "e"]}); check("rr", s == 200 and b["summary"]["total"] == 10)
s, b, _ = call("POST", "/audit/v1/fixtures", {"format": "swiss", "teams": ["a"]}); check("swiss limit", s == 400)
s, b, _ = call("POST", "/audit/v1/fixtures", {"format": "double_elim", "teams": list("abcdefgh")}); check("de", s == 200 and len(b["grand_final"]) == 1)

# --- roster
setup = {"league": {"league_id": "lg-r1", "tenant_id": "tenant-alpha", "sport_id": "football", "transfer_window": {"open": "2026-09-01", "close": "2026-09-30"}, "max_squad_size": 3, "required_positions": {"gk": 1}},
         "squads": [{"squad_id": "sq-a", "club_id": "club-a", "tenant_id": "tenant-alpha", "name": "A"}, {"squad_id": "sq-b", "club_id": "club-b", "tenant_id": "tenant-alpha", "name": "B"}],
         "players": [{"player_id": "p1", "name": "Ali", "position": "gk", "squad_id": "sq-a", "role": "captain"}, {"player_id": "p2", "name": "Bilal", "position": "df", "squad_id": "sq-a", "role": "starter"}],
         "matches_in_progress": [{"match_id": "m-live", "home_squad_id": "sq-a", "away_squad_id": "sq-b"}]}
s, b, _ = call("POST", "/audit/v1/roster/setup", setup); check("roster setup", s == 201 and b["squad_counts"]["sq-a"] == 2, b)
tr = {"request_id": "tr-1", "league_id": "lg-r1", "player_id": "p2", "type": "transfer", "from_squad_id": "sq-a", "to_squad_id": "sq-b", "effective_date": "2026-09-30", "loan_end_date": None, "reason": "x", "requested_by": "user-77"}
s, b, _ = call("POST", "/audit/v1/roster/transfer", tr); check("transfer deferred", s == 201 and b["state"] == "deferred_until_match_end" and b["blocking_match_id"] == "m-live", b)
s, b, _ = call("POST", "/audit/v1/roster/transfer", tr); check("transfer replay", s == 200)
s, b, _ = call("POST", "/audit/v1/roster/transfer", {**tr, "request_id": "tr-2", "player_id": "p1", "from_squad_id": "sq-a"}); check("min position", s == 409 and b["error"]["code"] == "MIN_POSITION_VIOLATION", b)
s, b, _ = call("POST", "/audit/v1/roster/transfer", {**tr, "request_id": "tr-3", "effective_date": "2026-10-05", "player_id": "p2", "from_squad_id": "sq-b"}); check("window closed", s == 409 and b["error"]["code"] == "TRANSFER_WINDOW_CLOSED", b)
s, b, _ = call("POST", "/audit/v1/roster/setup", setup)
loan = {**tr, "request_id": "tr-4", "type": "loan", "effective_date": "2026-09-10", "loan_end_date": "2026-09-20"}
s, b, _ = call("POST", "/audit/v1/roster/transfer", loan); check("loan", s == 201 and b["registration"]["parent_squad_id"] == "sq-a", b)
s, b, _ = call("GET", "/audit/v1/roster/history/p2?as_of=2027-01-05"); check("loan return", s == 200 and b["current_squad_id"] == "sq-a" and [h["action"] for h in b["history"]] == ["loan", "loan_return"], b)
s, b, _ = call("GET", "/audit/v1/roster/history/p2?as_of=2027-01-05"); check("loan return once", len(b["history"]) == 2)

# --- checkout concurrency
call("POST", "/audit/v1/reset", {"stock": {"var-jersey-001-M": 1}})
barrier = threading.Barrier(20)
def buy(i):
    barrier.wait()
    return call("POST", "/audit/v1/checkout", {"order_id": f"ord-{i}", "customer_id": "c", "items": [{"variant_id": "var-jersey-001-M", "quantity": 1}], "discount_code": None, "payment": {"token": "tok_success"}})
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(buy, range(20)))
codes = sorted(r[0] for r in res); check("20 buyers", codes.count(201) == 1 and codes.count(409) == 19, codes)
s, b, _ = call("GET", "/audit/v1/inventory/var-jersey-001-M"); check("inventory", b == {"variant_id": "var-jersey-001-M", "stock": 0, "reserved": 0}, b)
ok = [r for r in res if r[0] == 201][0][1]
check("receipt sig", ok["receipt"]["signature"] == sig(ok["order_id"], ok["receipt"]["payload"]))
pdf = base64.b64decode(ok["receipt"]["pdf_base64"]); check("pdf", pdf.startswith(b"%PDF") and ok["order_id"].encode() in pdf and b"PKR 4500.00" in pdf)
s, b, _ = call("POST", "/audit/v1/checkout", {"order_id": "o9", "customer_id": "c", "items": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "payment": {"token": "tok_declined"}}); check("declined", s == 402 and b["error"]["code"] == "PAYMENT_DECLINED")
s, b, _ = call("GET", "/audit/v1/inventory/var-jersey-001-L"); check("restock", b["stock"] == 5 and b["reserved"] == 0, b)
s, b, _ = call("POST", "/audit/v1/checkout", {"order_id": "o10", "customer_id": "c", "items": [{"variant_id": "var-jersey-001-L", "quantity": 2}], "discount_code": "WELCOME10", "payment": {"token": "tok_success"}}); check("discount", s == 201 and b["discount_minor"] == 90000 and b["total_minor"] == 810000, b)

# --- rbac
s, m, _ = call("POST", "/audit/v1/rbac-matrix"); check("rbac matrix", s == 200 and set(m["tokens"]) == {"super_admin", "league_organizer", "club_manager", "player", "viewer"})
T, C = m["tokens"], m["context"]
def p(method, path, role): return call(method, "/audit/v1/rbac" + path, {}, T[role])[0]
exp = [("post", "/tenants", "AUUUU".replace("A", "A")), ]
check("P1", [p("POST", "/tenants", r) for r in T] == [200, 403, 403, 403, 403])
check("P2 own", [p("POST", f"/leagues/{C['own_league_id']}/fixtures", r) for r in T] == [200, 200, 403, 403, 403])
check("P2 foreign", [p("POST", f"/leagues/{C['foreign_league_id']}/fixtures", r) for r in T] == [200, 403, 403, 403, 403])
check("P3 own", [p("POST", f"/clubs/{C['own_club_id']}/roster", r) for r in T] == [200, 403, 200, 403, 403])
check("P3 other", [p("POST", f"/clubs/{C['other_club_id']}/products", r) for r in T] == [200, 403, 403, 403, 403])
check("P5 own", [p("PATCH", f"/players/{C['own_player_id']}", r) for r in T] == [200, 403, 200, 200, 403])
check("P5 other", [p("PATCH", f"/players/{C['other_player_id']}", r) for r in T] == [200, 403, 403, 403, 403])
check("P6 own", [p("GET", f"/clubs/{C['own_club_id']}", r) for r in T] == [200] * 5)
check("P6 foreign", [p("GET", f"/clubs/{C['foreign_club_id']}", r) for r in T] == [200, 403, 403, 403, 403])
check("P7", [p("GET", "/platform/config", r) for r in T] == [200, 403, 403, 403, 403])
s, b, _ = call("GET", "/audit/v1/rbac/platform/config"); check("401 no token", s == 401 and b["error"]["code"] == "UNAUTHENTICATED")
bad = T["super_admin"][:-3] + ("AAA" if not T["super_admin"].endswith("AAA") else "BBB")
check("401 tampered", call("GET", "/audit/v1/rbac/platform/config", None, bad)[0] == 401)
h = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode(); pl = T["super_admin"].split(".")[1]
check("401 alg none", call("GET", "/audit/v1/rbac/platform/config", None, f"{h}.{pl}.")[0] == 401)

# --- rate limit / body size
time.sleep(10.5)
codes = [call("GET", "/api/v1/ping")[0] for _ in range(150)]
check("rate limit", codes[0] == 200 and codes.count(429) >= 40, codes.count(429))
s, b, hd = call("GET", "/api/v1/ping"); check("retry-after", s == 429 and "retry-after" in {k.lower() for k in hd})
time.sleep(11); check("recovers", call("GET", "/api/v1/ping")[0] == 200)
s, b, _ = call("POST", "/audit/v1/events", raw=b"{" + b'"a":"' + b"x" * 1_100_000 + b'"}'); check("413", s == 413 and b["error"]["code"] == "PAYLOAD_TOO_LARGE", s)

# --- offline sync
call("POST", "/audit/v1/reset", {})
call("POST", "/audit/v1/leagues", {**lg, "sport_id": "football", "fixtures": [{"match_id": "m1", "home": "t1", "away": "t2"}], "league_id": "lg-o", "teams": ["t1", "t2"]})
ev("o1", "m1", "match_start")
acts = [{"action_id": "a1", "type": "score_event", "queued_at": "2026-10-17T11:00:00Z", "base_version": 1, "payload": {"event_id": "o2", "match_id": "m1", "type": "score", "payload": {"team_id": "t1", "event_type": "goal"}}},
        {"action_id": "a2", "type": "score_event", "queued_at": "2026-10-17T11:01:00Z", "base_version": 0, "payload": {"event_id": "o3", "match_id": "m1", "type": "score", "payload": {"team_id": "t2", "event_type": "goal"}}},
        {"action_id": "a3", "type": "score_event", "queued_at": "2026-10-17T11:02:00Z", "base_version": 99, "payload": {"event_id": "o4", "match_id": "m1", "type": "score", "payload": {"team_id": "t2", "event_type": "goal"}}}]
s, b, _ = call("POST", "/audit/v1/offline-sync", {"device_id": "dev-1", "actions": acts})
r = b["results"]; check("sync", s == 200 and [x["resolution"] for x in r] == ["appended", "rebased_append", "server_wins"] and r[2]["error_code"] == "INVALID_BASE_VERSION", b)
s, b, _ = call("POST", "/audit/v1/offline-sync", {"device_id": "dev-1", "actions": acts}); check("sync replay", all(x["status"] == "duplicate" for x in b["results"]), b)

print("\nFAILED:" if fails else "\nALL OK", fails)
sys.exit(1 if fails else 0)
