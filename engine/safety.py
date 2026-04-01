from enum import Enum
from playwright.sync_api import Page


class StopSignal(Enum):
    CAPTCHA = "CAPTCHA detected — automation paused"
    SESSION_EXPIRED = "Session expired — please log into LinkedIn again"
    RATE_LIMITED = "LinkedIn is rate limiting — paused for 30 minutes"
    REPEATED_FAILURES = "Too many submission failures in a row"
    ACCOUNT_RESTRICTED = "Account may be restricted — check LinkedIn"


def classify_stop_signal(signal: str) -> StopSignal | None:
    return {
        "captcha": StopSignal.CAPTCHA,
        "login_redirect": StopSignal.SESSION_EXPIRED,
        "rate_limit": StopSignal.RATE_LIMITED,
        "repeated_failures": StopSignal.REPEATED_FAILURES,
        "account_restricted": StopSignal.ACCOUNT_RESTRICTED,
    }.get(signal)


def check_page_for_stop_signal(page: Page) -> StopSignal | None:
    """
    Inspect the current Playwright page for LinkedIn detection signals.
    Returns a StopSignal if one is found, None if safe to continue.
    """
    url = page.url.lower()

    if "checkpoint" in url or "challenge" in url:
        return StopSignal.CAPTCHA

    if "linkedin.com/login" in url:
        return StopSignal.SESSION_EXPIRED

    if page.locator("text=too many requests").count() > 0:
        return StopSignal.RATE_LIMITED

    if page.locator("text=Your account has been restricted").count() > 0:
        return StopSignal.ACCOUNT_RESTRICTED

    return None
