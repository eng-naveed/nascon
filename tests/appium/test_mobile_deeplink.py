"""Spec 6.3: nascon:// deep links bring the native app to the foreground within 2 s on the right screen,
and a cross-surface co-stream chat reaches a Selenium Grid browser within 3 s."""
import time
import uuid

import pytest
from appium.webdriver.common.appiumby import AppiumBy
from selenium import webdriver as selenium_webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import APP_PACKAGE, BASE_URL, GRID_URL

FOREGROUND = 4  # ApplicationState.RUNNING_IN_FOREGROUND


def by_id(d, name):
    """React Native exposes testID as the Android resource-id (and some views as content-desc): match either."""
    return d.find_elements(AppiumBy.XPATH, f'//*[@resource-id="{name}" or @content-desc="{name}"]')


def deep_link(d, url):
    """Same intent as the spec's `adb shell am start -W -a android.intent.action.VIEW -d <url>`."""
    d.terminate_app(APP_PACKAGE)
    t0 = time.monotonic()
    d.execute_script("mobile: deepLink", {"url": url, "package": APP_PACKAGE})
    WebDriverWait(d, 2, poll_frequency=0.1).until(lambda x: x.query_app_state(APP_PACKAGE) == FOREGROUND)
    return time.monotonic() - t0


@pytest.mark.parametrize("url, screen", [
    ("nascon://entity/match-m1", "match-scoreboard"),
    ("nascon://stream/cs-session-101", "costream-screen"),
])
def test_deep_link_opens_screen_in_foreground(mobile, url, screen):
    elapsed = deep_link(mobile, url)
    assert elapsed < 2.0
    WebDriverWait(mobile, 8).until(lambda d: by_id(d, screen))
    assert not by_id(mobile, "login-email"), "deep link stopped on the login screen"


def test_cross_surface_costream_chat(mobile):
    """Mobile joins cs-session-101 and chats; a simultaneous Grid browser on /web/costream/cs-session-101 sees it within 3 s."""
    browser = selenium_webdriver.Remote(command_executor=GRID_URL, options=selenium_webdriver.ChromeOptions())
    try:
        browser.get(f"{BASE_URL}/web/costream/cs-session-101")
        deep_link(mobile, "nascon://stream/cs-session-101")
        WebDriverWait(mobile, 8).until(lambda d: by_id(d, "costream-screen"))
        if by_id(mobile, "costream-login"):  # chat needs a member session; log in once inside the app
            by_id(mobile, "costream-login")[0].click()
            WebDriverWait(mobile, 5).until(lambda d: by_id(d, "login-email"))
            by_id(mobile, "login-email")[0].send_keys("player@nascon.test")
            by_id(mobile, "login-password")[0].send_keys("Nascon@26")
            by_id(mobile, "login-submit")[0].click()
            WebDriverWait(mobile, 8).until(lambda d: by_id(d, "costream-chat-input"))
        text = f"from the phone {uuid.uuid4().hex[:6]}"
        by_id(mobile, "costream-chat-input")[0].send_keys(text)
        by_id(mobile, "costream-chat-send")[0].click()
        WebDriverWait(browser, 3).until(lambda b: text in b.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]').text)
    finally:
        browser.quit()
