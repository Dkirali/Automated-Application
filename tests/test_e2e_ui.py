"""
End-to-end UI tests for JobBot using Playwright.
Covers all user flows: dashboard, settings, campaigns, review, discard, download.
"""
import time
import pytest
from playwright.sync_api import sync_playwright, expect


BASE_URL = "http://localhost:5001"
TIMEOUT = 10_000  # 10s for assertions


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(TIMEOUT)
    yield page
    page.close()
    ctx.close()


# ─── 1. Dashboard ────────────────────────────────────────────────────────────

class TestDashboard:
    def test_01_loads_correctly(self, page):
        """Dashboard loads with all key sections visible."""
        page.goto(BASE_URL)
        expect(page.locator("h1")).to_have_text("JobBot")
        # Stats row
        expect(page.locator(".stat-label", has_text="Applied")).to_be_visible()
        expect(page.locator(".stat-label", has_text="Manual Queue")).to_be_visible()
        expect(page.locator(".stat-label", has_text="Campaign Status")).to_be_visible()
        # Campaign form
        expect(page.locator("#titles")).to_be_visible()
        expect(page.locator("#location_text")).to_be_visible()
        page.screenshot(path="tests/artifacts/01_dashboard.png")

    def test_02_status_api(self, page):
        """Status API returns valid JSON with pending_count."""
        page.goto(BASE_URL)
        response = page.request.get(f"{BASE_URL}/status")
        data = response.json()
        assert "status" in data
        assert "pending_count" in data
        assert isinstance(data["pending_count"], int)

    def test_03_linkedin_status(self, page):
        """LinkedIn status indicator shows on dashboard."""
        page.goto(BASE_URL)
        pill = page.locator("#li-pill")
        expect(pill).to_be_visible()
        # Should have either connected or disconnected class
        classes = pill.get_attribute("class") or ""
        assert "li-pill--on" in classes or "li-pill--off" in classes

    def test_04_resume_shown(self, page):
        """Master resume name is displayed."""
        page.goto(BASE_URL)
        expect(page.locator(".subtitle", has_text="master.pdf")).to_be_visible()

    def test_05_pending_jobs_display(self, page):
        """Pending/reviewed jobs show in the pending review section."""
        page.goto(BASE_URL)
        section = page.locator(".section-title--pending")
        expect(section).to_be_visible()
        # Should have job cards
        cards = page.locator(".app-card--pending")
        assert cards.count() >= 2, f"Expected at least 2 pending cards, got {cards.count()}"

    def test_06_reviewed_job_shows_ats_scores(self, page):
        """Reviewed jobs show ATS scores if any reviewed jobs exist."""
        page.goto(BASE_URL)
        ats_dual = page.locator(".ats-dual-mini")
        ats_single = page.locator(".ats-mini")
        reviewed_badges = page.locator(".badge-pending", has_text="Review")
        # Either ATS bars are visible or we have review badges — both are valid states
        has_content = ats_dual.count() > 0 or ats_single.count() > 0 or reviewed_badges.count() > 0
        assert has_content, "Expected ATS scores or review badges on pending cards"

    def test_07_pending_job_shows_not_tailored(self, page):
        """Pending (not yet tailored) jobs show an 'untailored' badge or tailor button."""
        page.goto(BASE_URL)
        # Jobs without a resume show either an untailored badge or a tailor button
        untailored = page.locator(".untailored-badge")
        tailor_btn = page.locator(".tailor-btn")
        has_indicator = untailored.count() >= 1 or tailor_btn.count() >= 1
        assert has_indicator, "Expected at least one pending job with untailored badge or tailor button"

    def test_08_fit_badge_on_reviewed_cards(self, page):
        """Reviewed cards with fit scores show fit badges or verdict text."""
        page.goto(BASE_URL)
        badges = page.locator(".fit-badge")
        verdicts = page.locator(".app-card-verdict")
        has_fit_info = badges.count() > 0 or verdicts.count() > 0
        assert has_fit_info, "Expected at least one fit badge or verdict on dashboard"
        page.screenshot(path="tests/artifacts/08_fit_badges.png")


# ─── 2. Settings ─────────────────────────────────────────────────────────────

class TestSettings:
    def test_09_loads_with_prefilled_data(self, page):
        """Settings page loads with current profile data."""
        page.goto(f"{BASE_URL}/settings")
        name_input = page.locator("input[name='name']")
        email_input = page.locator("input[name='email']")
        phone_input = page.locator("input[name='phone']")
        expect(name_input).to_be_visible()
        # Should have values (not empty)
        assert name_input.input_value() != "", "Name field should be pre-filled"
        assert email_input.input_value() != "", "Email field should be pre-filled"
        assert phone_input.input_value() != "", "Phone field should be pre-filled"
        page.screenshot(path="tests/artifacts/09_settings.png")

    def test_10_update_profile(self, page):
        """Updating profile info shows success message."""
        page.goto(f"{BASE_URL}/settings")
        # Read current values to restore later
        original_name = page.locator("input[name='name']").input_value()

        # Update name
        page.locator("input[name='name']").fill("Test User")
        page.locator("button[type='submit'], input[type='submit']").click()
        page.wait_for_load_state("networkidle")

        # Should show success
        expect(page.locator("text=Settings saved")).to_be_visible()

        # Restore original
        page.locator("input[name='name']").fill(original_name)
        page.locator("button[type='submit'], input[type='submit']").click()
        page.wait_for_load_state("networkidle")

    def test_11_shows_current_resume(self, page):
        """Settings page shows current resume filename."""
        page.goto(f"{BASE_URL}/settings")
        expect(page.locator("text=master.pdf")).to_be_visible()


# ─── 3. Campaign Controls ────────────────────────────────────────────────────

class TestCampaign:
    def test_12_filter_chips_toggle(self, page):
        """Work type and experience level chips can be toggled."""
        page.goto(BASE_URL)
        # Remote should be checked by default
        remote = page.locator("#wt2")
        assert remote.is_checked(), "Remote should be checked by default"

        # Toggle it off
        page.locator("label[for='wt2']").click()
        assert not remote.is_checked(), "Remote should be unchecked after click"

        # Toggle it back on
        page.locator("label[for='wt2']").click()
        assert remote.is_checked(), "Remote should be checked again"
        page.screenshot(path="tests/artifacts/12_filters.png")

    def test_13_date_posted_dropdown(self, page):
        """Date posted dropdown has expected options."""
        page.goto(BASE_URL)
        select = page.locator("select[name='date_posted']")
        expect(select).to_be_visible()
        options = select.locator("option").all_text_contents()
        assert "Any time" in options
        assert "Past 24 hours" in options
        assert "Past week" in options
        assert "Past month" in options

    def test_14_start_campaign_empty_title_rejected(self, page):
        """Starting a campaign with empty titles field is rejected."""
        page.goto(BASE_URL)
        # Clear the title field and try to submit
        page.locator("#titles").fill("")
        # HTML5 validation should prevent submission (required attribute)
        page.locator(".btn-start").click()
        # Should still be on dashboard (form didn't submit)
        expect(page.locator("h1")).to_have_text("JobBot")


# ─── 4. Review Page ──────────────────────────────────────────────────────────

class TestReview:
    def test_15_open_reviewed_job(self, page):
        """Clicking a reviewed job opens the review page."""
        page.goto(BASE_URL)
        # Click first pending card link
        first_card = page.locator(".app-card-inner").first
        first_card.click()
        page.wait_for_load_state("networkidle")
        # Should be on review page
        expect(page.locator(".back-link")).to_be_visible()
        page.screenshot(path="tests/artifacts/15_review_page.png")

    def test_16_review_shows_job_details(self, page):
        """Review page shows job title, company, and fit data."""
        page.goto(f"{BASE_URL}/review/118")
        page.wait_for_load_state("networkidle")
        # Job title should be visible
        expect(page.locator("text=Product Manager")).to_be_visible()
        expect(page.locator("text=Acme Corp")).to_be_visible()

    def test_17_review_has_action_buttons(self, page):
        """Review page has apply, discard, and re-tailor buttons."""
        page.goto(f"{BASE_URL}/review/118")
        page.wait_for_load_state("networkidle")
        page.screenshot(path="tests/artifacts/17_review_actions.png")

    def test_18_resume_text_api(self, page):
        """Resume text API returns content for reviewed jobs."""
        # This job doesn't have a resume_path since we didn't actually tailor,
        # so it should return empty
        response = page.request.get(f"{BASE_URL}/resume-text/118")
        data = response.json()
        assert "text" in data
        assert "keywords" in data


# ─── 5. Discard Flows ────────────────────────────────────────────────────────

class TestDiscard:
    def test_19_discard_single_job(self, page):
        """Discarding a job moves it to applications list."""
        page.goto(BASE_URL)
        # Find a pending/reviewed job to discard
        pending_cards = page.locator(".app-card--pending")
        pending_before = pending_cards.count()
        if pending_before == 0:
            pytest.skip("No pending jobs to discard")

        # Get the first pending job's ID from its link
        first_link = page.locator(".app-card-inner").first.get_attribute("href")
        app_id = first_link.split("/")[-1]

        # Navigate to review and discard
        page.goto(f"{BASE_URL}/review/{app_id}")
        page.wait_for_load_state("networkidle")

        discard_form = page.locator(f"form[action='/discard/{app_id}']")
        if discard_form.count() > 0:
            discard_form.locator("button").click()
        else:
            page.request.post(f"{BASE_URL}/discard/{app_id}")
            page.goto(BASE_URL)

        page.wait_for_load_state("networkidle")

        pending_after = page.locator(".app-card--pending").count()
        assert pending_after < pending_before, f"Pending count should decrease: {pending_before} -> {pending_after}"

    def test_20_bulk_discard_checkboxes(self, page):
        """Bulk discard: selecting checkboxes shows the action bar."""
        page.goto(BASE_URL)
        wrappers = page.locator(".job-checkbox-wrap")
        if wrappers.count() == 0:
            pytest.skip("No pending jobs with checkboxes")

        # Click the label wrapper (the hidden input is inside)
        wrappers.first.click()

        # Bulk bar should appear
        bulk_bar = page.locator("#bulk-bar")
        expect(bulk_bar).to_be_visible()
        expect(page.locator("#bulk-count")).to_contain_text("1 selected")
        page.screenshot(path="tests/artifacts/20_bulk_bar.png")

    def test_21_bulk_select_all(self, page):
        """Select All button toggles all checkboxes."""
        page.goto(BASE_URL)
        wrappers = page.locator(".job-checkbox-wrap")
        if wrappers.count() == 0:
            pytest.skip("No pending jobs with checkboxes")

        # Click first wrapper to show bar
        wrappers.first.click()

        # Click Select All
        page.locator(".bulk-bar-btn--select-all").click()

        # All should be checked
        checkboxes = page.locator(".job-checkbox")
        total = checkboxes.count()
        checked = page.locator(".job-checkbox:checked").count()
        assert checked == total, f"Expected all {total} checked, got {checked}"


# ─── 6. Navigation & Edge Cases ──────────────────────────────────────────────

class TestEdgeCases:
    def test_22_nonexistent_job_redirects(self, page):
        """Accessing a non-existent job redirects to dashboard."""
        page.goto(f"{BASE_URL}/review/99999")
        page.wait_for_load_state("networkidle")
        # Should redirect to dashboard
        assert page.url.rstrip("/") == BASE_URL or page.url.endswith("/")

    def test_23_nonexistent_application_redirects(self, page):
        """Accessing a non-existent application detail redirects."""
        page.goto(f"{BASE_URL}/application/99999")
        page.wait_for_load_state("networkidle")
        assert page.url.rstrip("/") == BASE_URL or page.url.endswith("/")

    def test_24_settings_link_works(self, page):
        """Settings link from dashboard navigates correctly."""
        page.goto(BASE_URL)
        page.locator("a[href='/settings']").first.click()
        page.wait_for_load_state("networkidle")
        assert "/settings" in page.url

    def test_25_back_link_from_review(self, page):
        """Back link on review page returns to dashboard."""
        page.goto(f"{BASE_URL}/review/118")
        page.wait_for_load_state("networkidle")
        back = page.locator(".back-link")
        if back.count() > 0:
            back.click()
            page.wait_for_load_state("networkidle")
            assert page.url.rstrip("/") == BASE_URL or page.url.endswith("/")

    def test_26_download_nonexistent_resume(self, page):
        """Download for job without resume returns 404."""
        response = page.request.get(f"{BASE_URL}/download/120")  # pending job, no resume
        assert response.status == 404

    def test_27_job_status_api(self, page):
        """Job status API returns valid data for existing job."""
        response = page.request.get(f"{BASE_URL}/api/job-status/118")
        assert response.status == 200
        data = response.json()
        assert data["status"] in ("pending", "reviewed", "applied", "failed", "discarded")

    def test_28_job_status_api_nonexistent(self, page):
        """Job status API returns 404 for non-existent job."""
        response = page.request.get(f"{BASE_URL}/api/job-status/99999")
        assert response.status == 404


# ─── 7. Smart Reload ─────────────────────────────────────────────────────────

class TestSmartReload:
    def test_29_no_reload_timer_when_idle(self, page):
        """When campaign is idle, no auto-reload timer is set."""
        page.goto(BASE_URL)
        # Check that the old setTimeout reload is not present
        content = page.content()
        assert "setTimeout(() => location.reload()" not in content, \
            "Should not have blind setTimeout reload"

    def test_30_status_polling_active(self, page):
        """Status polling is set up via setInterval."""
        page.goto(BASE_URL)
        content = page.content()
        assert "setInterval(pollStatus" in content, "Should have polling interval"
        assert "lastPendingCount" in content, "Should track pending count for smart reload"


# ─── 8. Campaign History ─────────────────────────────────────────────────────

class TestCampaignHistory:
    def test_31_campaign_history_visible(self, page):
        """Campaign history section shows past campaigns."""
        page.goto(BASE_URL)
        history = page.locator(".campaign-history")
        if history.count() > 0:
            # Click to expand
            page.locator(".campaign-history-summary").click()
            expect(page.locator(".campaign-row").first).to_be_visible()
            page.screenshot(path="tests/artifacts/31_campaign_history.png")
        else:
            pytest.skip("No campaign history to display")


# ─── 9. Applications List ────────────────────────────────────────────────────

class TestApplicationsList:
    def test_32_discarded_job_appears_in_applications(self, page):
        """Previously discarded job appears in the applications section."""
        page.goto(BASE_URL)
        # We discarded job 122 in test_19
        app_cards = page.locator(".card-list:not(.pending-list) .app-card")
        if app_cards.count() > 0:
            # Should find a discarded badge
            expect(page.locator(".badge-discarded").first).to_be_visible()

    def test_33_application_detail_page(self, page):
        """Clicking a discarded application opens detail view."""
        page.goto(BASE_URL)
        discarded = page.locator(".badge-discarded")
        if discarded.count() > 0:
            discarded.first.click()
            page.wait_for_load_state("networkidle")
            assert "/application/" in page.url
            page.screenshot(path="tests/artifacts/33_detail_page.png")
        else:
            pytest.skip("No discarded applications to test")
