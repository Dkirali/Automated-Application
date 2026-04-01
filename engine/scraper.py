import random
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, Page

CHROME_USER_DATA = Path.home() / "Library/Application Support/Google/Chrome"
LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/"


def get_browser_context(playwright):
    """
    Launch Chrome with a copy of the Default profile so the bot can run
    while your regular Chrome is open (avoids SingletonLock conflict).
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="jobbot-chrome-"))
    shutil.copytree(CHROME_USER_DATA / "Default", tmp_dir / "Default")
    return playwright.chromium.launch_persistent_context(
        user_data_dir=str(tmp_dir),
        headless=False,
        channel="chrome",
        args=["--disable-blink-features=AutomationControlled"],
    )


def is_easy_apply(page: Page) -> bool:
    """Return True if the job detail page has an Easy Apply button."""
    return page.locator("button.jobs-apply-button:has-text('Easy Apply')").count() > 0


def parse_job_card(card) -> dict:
    """Extract job metadata from a LinkedIn job card element."""
    return {
        "title": card.locator("h3").inner_text().strip(),
        "company": card.locator(".job-card-container__primary-description").inner_text().strip(),
        "location": card.locator(".job-card-container__metadata-item").first.inner_text().strip(),
        "url": card.locator("a").first.get_attribute("href"),
    }


def build_search_url(titles: list[str], locations: list[str]) -> str:
    """Build a LinkedIn job search URL from title and location lists."""
    title_query = " OR ".join(titles)
    location_query = locations[0] if locations else ""
    params = urlencode({"keywords": title_query, "location": location_query})
    return f"{LINKEDIN_JOBS_URL}?{params}"


def scrape_jobs(titles: list[str], locations: list[str], seen_urls: set, stop_event) -> list[dict]:
    """
    Scrape LinkedIn for jobs matching titles/locations.
    Returns list of dicts: title, company, location, url, easy_apply, job_description.
    stop_event: threading.Event — checked between jobs to allow early exit.
    """
    results = []

    with sync_playwright() as p:
        context = get_browser_context(p)
        try:
            page = context.new_page()

            search_url = build_search_url(titles, locations)
            page.goto(search_url, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)

            cards = page.locator(".job-card-container").all()

            for card in cards:
                if stop_event.is_set():
                    break

                try:
                    job = parse_job_card(card)
                except Exception:
                    continue

                if not job["url"] or job["url"] in seen_urls:
                    continue

                card.click()
                page.wait_for_timeout(2000)

                job["easy_apply"] = is_easy_apply(page)

                try:
                    job["job_description"] = page.locator(".jobs-description__content").inner_text()
                except Exception:
                    job["job_description"] = ""

                results.append(job)
                seen_urls.add(job["url"])

                # Randomized delay: 90–120 seconds between jobs
                delay = random.uniform(90, 120)
                page.wait_for_timeout(delay * 1000)
        finally:
            context.close()

    return results
