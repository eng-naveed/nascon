"""Grid session fixtures for the Guest Web Player suite (spec 6.2.3). Every test gets a fresh browser profile."""
import os

import pytest
import requests
from selenium import webdriver

GRID_URL = os.environ.get("GRID_URL", "http://localhost:4444")
# what the browsers open: inside a Grid node localhost:8080 is relayed to the API (infra/selenium/localhost_forward.py)
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
# what this test process calls directly (reset, score events, member chat)
API_URL = os.environ.get("API_URL", "http://localhost:8080")
BROWSERS = [b.strip() for b in os.environ.get("BROWSERS", "chrome,firefox").split(",") if b.strip()]

COSTREAM = {
    "session_id": "cs-session-101",
    "host_player_id": "player-alpha-1",
    "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"],
    "layout": "grid_4",
}


def pytest_configure(config):
    # baseline once, from the xdist controller (or a plain run), never from a worker mid-suite
    if not hasattr(config, "workerinput"):
        requests.post(f"{API_URL}/audit/v1/reset", json={}, timeout=30).raise_for_status()
        requests.post(f"{API_URL}/audit/v1/costream/session", json=COSTREAM, timeout=30).raise_for_status()


def pytest_generate_tests(metafunc):
    if "browser" in metafunc.fixturenames:
        metafunc.parametrize("browser", BROWSERS)


@pytest.fixture
def driver(browser):
    if browser == "firefox":
        opts = webdriver.FirefoxOptions()
        opts.add_argument("-headless")
    else:
        opts = webdriver.ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--autoplay-policy=no-user-gesture-required")
    opts.set_capability("se:name", os.environ.get("PYTEST_CURRENT_TEST", "guest-grid"))
    d = webdriver.Remote(command_executor=GRID_URL, options=opts)
    d.set_page_load_timeout(20)
    d.set_window_size(1280, 900)
    yield d
    d.quit()


@pytest.fixture(scope="session")
def member_token():
    r = requests.post(f"{API_URL}/api/v1/auth/login", json={"email": "viewer@nascon.test", "password": "Nascon@26"}, timeout=10)
    r.raise_for_status()
    return r.json()["token"]
