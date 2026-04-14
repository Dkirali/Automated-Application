"""
Tests verifying that auto-tailoring is removed from the campaign flow.

Feature 6: When jobs are found during a campaign, tailor_resume() must NOT
be called automatically. Only generate_fit_summary() should run automatically.

RED phase: tests may fail before implementation, and pass after.
"""
import pytest
import threading
from unittest.mock import patch, MagicMock, call
import os


@pytest.fixture(autouse=True)
def isolated_env(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setenv("JOBBOT_DB", db_path)
    import db.database as dbmod
    dbmod._conn = None
    dbmod.init_db()
    dbmod.set_config("name", "Test User")
    dbmod.set_config("email", "test@test.com")
    dbmod.set_config("phone", "1234567890")
    dbmod.set_config("master_resume_path", "/fake/resume.docx")
    yield
    dbmod._conn = None


def _make_campaign():
    from db.database import create_campaign
    return create_campaign("Test Campaign", "Engineer", "Remote")


def _make_job(**overrides):
    job = {
        "title": "Software Engineer",
        "company": "Acme Corp",
        "location": "Remote",
        "url": "https://linkedin.com/jobs/test-1",
        "job_description": "We need a great engineer with Python skills.",
        "easy_apply": True,
    }
    job.update(overrides)
    return job


def _invoke_on_job_found(job, campaign_id):
    """
    Extract and invoke the on_job_found closure from run_campaign without
    actually starting the scraper. Returns True if the callback was captured.
    """
    import app as app_module

    captured = {}
    stop = threading.Event()

    def fake_scrape_jobs(titles, filters, seen_urls, stop_ev, status_callback, on_job):
        captured["on_job"] = on_job
        # Signal stop so the while loop exits after this single scrape call
        stop.set()

    with patch("engine.scraper.scrape_jobs", side_effect=fake_scrape_jobs):
        t = threading.Thread(
            target=app_module.run_campaign,
            args=(campaign_id, ["Engineer"], {}, stop),
            daemon=True,
        )
        t.start()
        t.join(timeout=5)

    on_job = captured.get("on_job")
    if on_job:
        on_job(job)
    return on_job is not None


# ── Tests ──

def test_auto_tailor_not_called_on_job_found():
    """tailor_resume must NOT be called when a job is found during campaign."""
    campaign_id = _make_campaign()
    job = _make_job()

    with patch("app.tailor_resume") as mock_tailor, \
         patch("app.generate_fit_summary", return_value={"raw": "", "jd_summary": ""}), \
         patch("app.update_application"):
        invoked = _invoke_on_job_found(job, campaign_id)
        assert invoked, "on_job_found callback was not captured"
        mock_tailor.assert_not_called()


def test_fit_summary_still_called_on_job_found():
    """generate_fit_summary MUST still be triggered automatically when job is found."""
    campaign_id = _make_campaign()
    job = _make_job()

    fit_called = threading.Event()

    def fake_fit(jd, mpath):
        fit_called.set()
        return {"raw": "FIT_SCORE: 70", "jd_summary": "Test role"}

    with patch("app.tailor_resume") as mock_tailor, \
         patch("app.generate_fit_summary", side_effect=fake_fit):
        _invoke_on_job_found(job, campaign_id)
        # Allow background thread to run
        fit_called.wait(timeout=3)

    assert fit_called.is_set(), "generate_fit_summary was not called"


def test_job_stays_pending_after_found():
    """After on_job_found, job status should remain 'pending' (no auto-review)."""
    campaign_id = _make_campaign()
    job = _make_job()

    with patch("app.tailor_resume"), \
         patch("app.generate_fit_summary", return_value={"raw": "", "jd_summary": ""}):
        _invoke_on_job_found(job, campaign_id)

    import time
    time.sleep(0.2)  # brief wait for any async updates

    from db.database import get_conn
    with get_conn() as conn:
        row = conn.execute(
            "SELECT status FROM applications WHERE url=?",
            (job["url"],)
        ).fetchone()

    assert row is not None, "Job was not inserted"
    # Should still be pending — not auto-reviewed
    assert row["status"] == "pending", f"Expected 'pending', got '{row['status']}'"


def test_non_easy_apply_goes_to_manual_queue():
    """Non-easy-apply jobs should be added to manual_queue, not applications."""
    campaign_id = _make_campaign()
    job = _make_job(easy_apply=False, url="https://linkedin.com/jobs/manual-1")

    with patch("app.tailor_resume"), \
         patch("app.generate_fit_summary", return_value={"raw": "", "jd_summary": ""}):
        _invoke_on_job_found(job, campaign_id)

    import time
    time.sleep(0.2)

    from db.database import get_conn
    with get_conn() as conn:
        manual = conn.execute(
            "SELECT * FROM manual_queue WHERE url=?",
            (job["url"],)
        ).fetchone()
        app_row = conn.execute(
            "SELECT * FROM applications WHERE url=?",
            (job["url"],)
        ).fetchone()

    assert manual is not None, "Non-easy-apply job not in manual_queue"
    assert app_row is None, "Non-easy-apply job should not be in applications"
