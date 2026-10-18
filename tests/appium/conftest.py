"""Appium 2 (UiAutomator2) fixtures for the native deep-link suite (spec 6.3). Skips honestly when no server/device."""
import os
from typing import Optional

import pytest
import requests

APPIUM_URL = os.environ.get("APPIUM_URL", "http://localhost:4723")
API_URL = os.environ.get("API_URL", "http://localhost:8080")
GRID_URL = os.environ.get("GRID_URL", "http://localhost:4444")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
APP_PACKAGE = os.environ.get("APP_PACKAGE", "io.nascon.multisport")
APP_APK = os.environ.get("APP_APK", "")  # optional: install this build first (e.g. mobile/release/app-release.apk)


def appium_ready() -> Optional[str]:
    try:
        r = requests.get(f"{APPIUM_URL}/status", timeout=3)
        return None if r.ok and r.json().get("value", {}).get("ready") else f"Appium at {APPIUM_URL} is not ready"
    except requests.RequestException as e:
        return f"Appium not reachable at {APPIUM_URL}: {e.__class__.__name__}"


def pytest_configure(config):
    if not hasattr(config, "workerinput") and appium_ready() is None:
        requests.post(f"{API_URL}/audit/v1/reset", json={}, timeout=30).raise_for_status()
        requests.post(f"{API_URL}/audit/v1/costream/session", json={
            "session_id": "cs-session-101", "host_player_id": "player-alpha-1",
            "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"],
        }, timeout=30).raise_for_status()


@pytest.fixture
def mobile():
    reason = appium_ready()
    if reason:
        pytest.skip(reason)
    from appium import webdriver
    from appium.options.android import UiAutomator2Options

    opts = UiAutomator2Options()
    opts.app_package = APP_PACKAGE
    opts.app_activity = ".MainActivity"
    opts.no_reset = True
    opts.new_command_timeout = 120
    opts.auto_grant_permissions = True
    if APP_APK:
        opts.app = os.path.abspath(APP_APK)
    d = webdriver.Remote(APPIUM_URL, options=opts)
    yield d
    d.quit()
