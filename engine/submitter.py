from pathlib import Path
from playwright.sync_api import Page
from engine.scraper import get_browser_context
from playwright.sync_api import sync_playwright


def fill_easy_apply(page: Page, name: str, email: str, phone: str, pdf_path: str) -> bool:
    """
    Complete the LinkedIn Easy Apply modal for the current job.
    Returns True on success, False on failure.
    Handles multi-step modals by clicking Next until Submit is available.
    """
    try:
        page.wait_for_selector(".jobs-easy-apply-modal", timeout=10000)
    except Exception:
        return False

    max_steps = 10
    for _ in range(max_steps):
        _fill_visible_fields(page, phone, pdf_path)

        submit = page.locator("button[aria-label='Submit application']")
        next_btn = page.locator("button[aria-label='Continue to next step']")

        if submit.count() > 0:
            submit.click()
            page.wait_for_timeout(2000)
            return True
        elif next_btn.count() > 0:
            next_btn.click()
            page.wait_for_timeout(1500)
        else:
            break

    return False


def _fill_visible_fields(page: Page, phone: str, pdf_path: str):
    """Fill any visible form fields in the current modal step."""
    for field_label in ["Phone", "Mobile phone number"]:
        try:
            # exact=True avoids matching "Phone country code"
            field = page.get_by_label(field_label, exact=True)
            if field.count() > 0 and field.first.is_visible():
                field.first.fill(phone)
        except Exception:
            pass

    upload = page.locator("input[type='file']")
    if pdf_path and upload.count() > 0 and Path(pdf_path).exists():
        try:
            upload.first.set_input_files(pdf_path)
        except Exception:
            pass


def submit_application(job_url: str, pdf_path: str, name: str, email: str, phone: str) -> bool:
    """
    Navigate to a LinkedIn job URL and complete Easy Apply.
    Returns True if application was submitted successfully.
    """
    with sync_playwright() as p:
        context = get_browser_context(p)
        try:
            page = context.new_page()
            page.goto(job_url, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)

            # Dismiss interstitial popup if present
            not_now = page.locator("button[aria-label='Not now']")
            if not_now.count() > 0:
                not_now.click()
                page.wait_for_timeout(1000)

            # LinkedIn uses <a> or <button> for Easy Apply depending on page version
            apply_btn = page.locator("[aria-label*='Easy Apply']")
            if apply_btn.count() == 0:
                return False

            apply_btn.first.click()
            page.wait_for_timeout(2000)

            return fill_easy_apply(page, name, email, phone, pdf_path)
        finally:
            context.close()
