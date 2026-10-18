"""Spec 6.2.3: Guest Web Player on Selenium Grid 4, run in parallel (pytest -n 3 tests/selenium/)."""
import re
import time
import uuid

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import API_URL, BASE_URL

TESTIDS = [
    "guest-video-player", "live-score-banner", "pinned-merch-card", "add-to-guest-cart-btn", "guest-cart-count",
    "chat-message-list", "chat-input-field", "chat-send-btn", "progressive-auth-modal",
]


def tid(driver, name):
    return driver.find_element(By.CSS_SELECTOR, f'[data-testid="{name}"]')


def score_event(team="club-alpha-1"):
    r = requests.post(f"{API_URL}/audit/v1/events", json={
        "event_id": f"grid-{uuid.uuid4().hex}", "match_id": "match-m1", "type": "score", "payload": {"team_id": team, "event_type": "goal"},
    }, timeout=10)
    assert r.status_code == 201, r.text


def test_1_qr_resolution_and_zero_friction_load(driver):
    t0 = time.monotonic()
    driver.get(f"{BASE_URL}/q/m1-live")
    assert driver.current_url.endswith("/web/matches/match-m1/live")
    WebDriverWait(driver, 3).until(lambda d: tid(d, "guest-video-player").is_displayed())
    WebDriverWait(driver, 3).until(lambda d: re.fullmatch(r"\d+ - \d+", tid(d, "live-score-banner").text))
    assert time.monotonic() - t0 < 3.0
    assert not tid(driver, "progressive-auth-modal").is_displayed()


def test_2_guest_write_block_opens_progressive_modal(driver):
    driver.get(f"{BASE_URL}/web/matches/match-m1/live")
    text = f"guest says hi {uuid.uuid4().hex[:6]}"
    tid(driver, "chat-input-field").send_keys(text)
    tid(driver, "chat-send-btn").click()
    WebDriverWait(driver, 3).until(lambda d: tid(d, "progressive-auth-modal").is_displayed())
    assert text not in tid(driver, "chat-message-list").text
    # refused by the server, not just hidden by the UI
    msgs = requests.get(f"{API_URL}/api/v1/chat/chat-match-m1/messages", timeout=10).json()["messages"]
    assert all(m["text"] != text for m in msgs)


def test_3_guest_cart_staging_and_realtime_score_sync(driver):
    driver.get(f"{BASE_URL}/web/matches/match-m1/live")
    WebDriverWait(driver, 3).until(lambda d: tid(d, "guest-cart-count").text == "0")
    tid(driver, "add-to-guest-cart-btn").click()
    WebDriverWait(driver, 2).until(lambda d: tid(d, "guest-cart-count").text == "1")
    banner = tid(driver, "live-score-banner")
    WebDriverWait(driver, 3).until(lambda d: driver.execute_script("return !!window.WebSocket") and re.fullmatch(r"\d+ - \d+", banner.text))
    time.sleep(0.3)  # let the score socket finish its handshake
    before = banner.text
    score_event()
    WebDriverWait(driver, 0.5, poll_frequency=0.02).until(lambda d: banner.text != before)
    h0, h1 = int(before.split(" - ")[0]), int(banner.text.split(" - ")[0])
    assert h1 > h0


def test_costream_page_receives_chat_within_3s(driver, member_token):
    driver.get(f"{BASE_URL}/web/costream/cs-session-101")
    for name in TESTIDS:
        tid(driver, name)
    WebDriverWait(driver, 3).until(lambda d: "on air" in tid(d, "live-score-banner").text)
    time.sleep(0.3)
    text = f"cross-surface {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API_URL}/api/v1/chat", json={"chat_room_id": "chat-cs-session-101", "text": text},
                      headers={"Authorization": f"Bearer {member_token}"}, timeout=10)
    assert r.status_code == 201, r.text
    WebDriverWait(driver, 3).until(lambda d: text in tid(d, "chat-message-list").text)


def test_accessibility_contract(driver):
    driver.get(f"{BASE_URL}/web/matches/match-m1/live")
    for name in TESTIDS:
        assert len(driver.find_elements(By.CSS_SELECTOR, f'[data-testid="{name}"]')) == 1, name
    assert driver.find_element(By.TAG_NAME, "html").get_attribute("lang") == "en"
    assert driver.find_element(By.ID, "video").get_attribute("aria-label")
    small = driver.execute_script(
        "return Array.from(document.querySelectorAll('button,input,a')).filter(function(e){"
        "var r=e.getBoundingClientRect();return r.width>0&&(r.width<48||r.height<48)}).map(function(e){return e.outerHTML.slice(0,80)})")
    assert small == []
    # keyboard: the chat field is reachable and Escape closes the modal
    tid(driver, "chat-send-btn").click()
    WebDriverWait(driver, 3).until(lambda d: tid(d, "progressive-auth-modal").is_displayed())
    assert driver.switch_to.active_element.get_attribute("id") == "auth-email"
    driver.switch_to.active_element.send_keys("")  # Escape
    WebDriverWait(driver, 2).until(lambda d: not tid(d, "progressive-auth-modal").is_displayed())
