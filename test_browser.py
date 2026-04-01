"""
LinkedIn session setup — run this once to log in.
After logging in and closing the window, JobBot will use that session for all campaigns.

Run: source venv/bin/activate && python test_browser.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

JOBBOT_PROFILE = Path.home() / ".jobbot-chrome"
JOBBOT_PROFILE.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir=str(JOBBOT_PROFILE),
        headless=False,
        channel="chrome",
        args=["--disable-blink-features=AutomationControlled"],
    )

    page = context.new_page()
    page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")

    print("\n─────────────────────────────────────────────────────")
    print("  JobBot Browser Setup")
    print("─────────────────────────────────────────────────────")
    print("  1. Log in to LinkedIn in the window that just opened")
    print("  2. Once you're on the LinkedIn feed/jobs page, close")
    print("     the Chrome window")
    print("  3. Your session is saved — JobBot will reuse it")
    print("─────────────────────────────────────────────────────\n")

    # Stay open until the user closes the browser window
    try:
        page.wait_for_event("close", timeout=600_000)
    except Exception:
        pass

    context.close()
    print("✓ Session saved to ~/.jobbot-chrome")
    print("  You can now start campaigns from the dashboard.")
