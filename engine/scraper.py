import random
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright, Page

# Dedicated Chrome profile for JobBot — persists between runs
JOBBOT_PROFILE = Path.home() / ".jobbot-chrome"
LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/"


def get_browser_context(playwright):
    JOBBOT_PROFILE.mkdir(parents=True, exist_ok=True)
    return playwright.chromium.launch_persistent_context(
        user_data_dir=str(JOBBOT_PROFILE),
        headless=False,
        channel="chrome",
        args=["--disable-blink-features=AutomationControlled"],
    )


def is_easy_apply(page: Page) -> bool:
    """Return True if the job detail panel has an Easy Apply button."""
    selectors = [
        "button.jobs-apply-button:has-text('Easy Apply')",
        "button:has-text('Easy Apply')",
        "[data-job-id] button:has-text('Easy Apply')",
    ]
    for sel in selectors:
        try:
            if page.locator(sel).count() > 0:
                return True
        except Exception:
            pass
    return False


def parse_job_card(card) -> dict:
    """Extract job metadata from a LinkedIn job card. Tries multiple selector patterns."""
    def try_text(*selectors, default=""):
        for sel in selectors:
            try:
                el = card.locator(sel)
                if el.count() > 0:
                    text = el.first.inner_text().strip()
                    # LinkedIn often repeats the title (visible + aria); take the first line only
                    return text.split("\n")[0].strip()
            except Exception:
                pass
        return default

    def try_href(*selectors):
        for sel in selectors:
            try:
                el = card.locator(sel)
                if el.count() > 0:
                    href = el.first.get_attribute("href") or ""
                    if "/jobs/view/" in href:
                        path = href.split("?")[0]  # strip query params
                        # Ensure absolute URL
                        if path.startswith("/"):
                            path = "https://www.linkedin.com" + path
                        return path
            except Exception:
                pass
        return None

    title = try_text(
        "h3.base-search-card__title",
        "a.job-card-list__title--link",
        ".job-card-list__title",
        "h3",
    )
    company = try_text(
        "h4.base-search-card__subtitle",
        ".job-card-container__primary-description",
        ".artdeco-entity-lockup__subtitle",
        "h4",
    )
    location = try_text(
        ".job-card-container__metadata-item",
        ".job-search-card__location",
        ".artdeco-entity-lockup__caption",
    )
    url = try_href(
        "a.job-card-list__title--link",
        "a.base-card__full-link",
        "a[href*='/jobs/view/']",
        "a",
    )

    return {"title": title, "company": company, "location": location, "url": url}


def build_search_url(titles: list[str], filters: dict) -> str:
    params = {
        "keywords": " OR ".join(titles),
        "location": filters.get("location_text", ""),
    }
    work_types = filters.get("work_types", [])
    if work_types:
        params["f_WT"] = ",".join(work_types)
    exp_levels = filters.get("experience_levels", [])
    if exp_levels:
        params["f_E"] = ",".join(exp_levels)
    date_posted = filters.get("date_posted", "")
    if date_posted:
        params["f_TPR"] = date_posted
    return f"{LINKEDIN_JOBS_URL}?{urlencode(params)}"


def get_job_description(page: Page) -> str:
    """Extract job description text from the detail panel."""
    selectors = [
        ".jobs-description__content",
        ".jobs-description-content__text",
        "#job-details",
        ".job-view-layout",
    ]
    for sel in selectors:
        try:
            el = page.locator(sel)
            if el.count() > 0:
                return el.first.inner_text().strip()
        except Exception:
            pass
    return ""


def scrape_jobs(titles: list[str], filters: dict, seen_urls: set, stop_event,
                status_callback=None) -> list[dict]:
    """
    Scrape LinkedIn for jobs matching titles/filters.
    Returns list of pending job dicts. No submission happens here.
    Delay is 3–5s between cards (scraping only, not submitting).
    """
    def update(msg):
        if status_callback:
            status_callback(msg)

    results = []

    with sync_playwright() as p:
        context = get_browser_context(p)
        try:
            page = context.new_page()
            search_url = build_search_url(titles, filters)
            update(f"Opening LinkedIn: {search_url[:80]}…")
            page.goto(search_url, wait_until="domcontentloaded")
            page.wait_for_timeout(4000)

            # Scroll the job list panel to trigger lazy-loading of all cards.
            # LinkedIn only renders visible cards; we scroll the scrollable ancestor
            # of the first card until no new cards appear.
            update("Loading all job cards…")
            for _ in range(8):
                if stop_event.is_set():
                    break
                count_before = page.locator(".job-card-container").count()
                page.evaluate("""() => {
                    const card = document.querySelector('.job-card-container');
                    if (!card) return;
                    let el = card.parentElement;
                    while (el) {
                        if (el.scrollHeight > el.clientHeight + 50) {
                            el.scrollBy(0, 1200);
                            return;
                        }
                        el = el.parentElement;
                    }
                }""")
                page.wait_for_timeout(1500)
                if page.locator(".job-card-container").count() == count_before:
                    break  # no new cards loaded

            # Try multiple card container selectors
            card_selectors = [
                ".job-card-container",
                "li.jobs-search-results__list-item",
                ".base-search-card",
                "li.scaffold-layout__list-item",
            ]
            cards = []
            for sel in card_selectors:
                found = page.locator(sel).all()
                if found:
                    cards = found
                    update(f"Found {len(cards)} job cards using '{sel}'")
                    break

            if not cards:
                # Save a debug screenshot so we can see what LinkedIn is showing
                Path("debug_screenshot.png").unlink(missing_ok=True)
                page.screenshot(path="debug_screenshot.png")
                update("No job cards found — screenshot saved as debug_screenshot.png")
                return []

            update(f"Scanning {len(cards)} jobs…")

            for i, card in enumerate(cards):
                if stop_event.is_set():
                    break

                try:
                    job = parse_job_card(card)
                except Exception:
                    continue

                if not job["url"] or job["url"] in seen_urls:
                    continue

                update(f"Reading job {i+1}/{len(cards)}: {job.get('title','?')} at {job.get('company','?')}")

                try:
                    card.scroll_into_view_if_needed()
                    card.click()
                    page.wait_for_timeout(2000)
                except Exception:
                    continue

                job["easy_apply"] = is_easy_apply(page)
                job["job_description"] = get_job_description(page)

                results.append(job)
                seen_urls.add(job["url"])

                # Short polite delay — scraping only, no submission happening
                page.wait_for_timeout(random.randint(3000, 5000))

        finally:
            context.close()

    return results
