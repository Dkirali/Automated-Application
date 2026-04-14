"""
TDD tests for process_job() — manual-tailor flow (Feature 6).

These tests verify:
1. tailor_resume is NOT called automatically when process_job() runs.
2. The application is inserted with status 'pending'.
3. generate_fit_summary IS called in a background thread.
4. If generate_fit_summary fails, the application stays 'pending' (non-fatal).
"""
import threading
import time
import pytest
from unittest.mock import patch, MagicMock

import db.database as db_module
from db.database import init_db, get_application


@pytest.fixture(autouse=True)
def fresh_db():
    """Reset in-memory DB before every test in this module."""
    db_module._conn = None
    init_db()
    yield
    db_module._conn = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_job(**overrides):
    base = {
        "title": "Product Manager",
        "company": "Acme",
        "location": "Remote",
        "url": "https://linkedin.com/jobs/view/999",
        "job_description": "Build products.",
        "easy_apply": True,
    }
    base.update(overrides)
    return base


def _run_process_job(job, campaign_id=1):
    from app import process_job
    stop_event = threading.Event()
    process_job(campaign_id, job, stop_event)


# ---------------------------------------------------------------------------
# Test 1 — tailor_resume must NOT be called automatically
# ---------------------------------------------------------------------------

def test_tailor_not_called_on_job_insert(tmp_path):
    """process_job() must NOT call tailor_resume — tailoring is now manual."""
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    with patch("app.tailor_resume") as mock_tailor, \
         patch("app.generate_fit_summary", return_value={"raw": "", "jd_summary": ""}):
        _run_process_job(_make_job(), campaign_id=campaign_id)
        time.sleep(0.3)  # allow background fit thread to start

    mock_tailor.assert_not_called()


# ---------------------------------------------------------------------------
# Test 2 — application is inserted with status 'pending'
# ---------------------------------------------------------------------------

def test_application_inserted_as_pending(tmp_path):
    """process_job() must insert the application with status='pending'."""
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    with patch("app.generate_fit_summary", return_value={"raw": "", "jd_summary": ""}):
        _run_process_job(_make_job(), campaign_id=campaign_id)

    from db.database import get_conn
    with get_conn() as conn:
        row = conn.execute(
            "SELECT status FROM applications WHERE url=?",
            ("https://linkedin.com/jobs/view/999",)
        ).fetchone()

    assert row is not None, "Application was not inserted"
    assert row["status"] == "pending", f"Expected 'pending', got {row['status']!r}"


# ---------------------------------------------------------------------------
# Test 3 — generate_fit_summary IS called in background
# ---------------------------------------------------------------------------

def test_fit_summary_called_on_job_insert(tmp_path):
    """process_job() must call generate_fit_summary() automatically."""
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    fit_called = threading.Event()

    def fake_fit(jd, mpath):
        fit_called.set()
        return {"raw": "FIT_SCORE: 72\nSTRENGTHS: planning\nGAPS: None\nVERDICT: Good fit.", "jd_summary": ""}

    with patch("app.generate_fit_summary", side_effect=fake_fit):
        _run_process_job(_make_job(), campaign_id=campaign_id)
        fit_called.wait(timeout=5)

    assert fit_called.is_set(), "generate_fit_summary was not called by process_job()"


# ---------------------------------------------------------------------------
# Test 4 — fit summary failure keeps job as 'pending' (non-fatal)
# ---------------------------------------------------------------------------

def test_fit_failure_keeps_pending(tmp_path):
    """If generate_fit_summary raises, application must stay 'pending', not 'failed'."""
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    done = threading.Event()

    def exploding_fit(jd, mpath):
        done.set()
        raise RuntimeError("LLM exploded")

    with patch("app.generate_fit_summary", side_effect=exploding_fit):
        _run_process_job(_make_job(), campaign_id=campaign_id)
        done.wait(timeout=5)

    time.sleep(0.2)  # let exception handler run

    from db.database import get_conn
    with get_conn() as conn:
        row = conn.execute(
            "SELECT status FROM applications WHERE url=?",
            ("https://linkedin.com/jobs/view/999",)
        ).fetchone()

    assert row is not None, "Application was not inserted"
    assert row["status"] == "pending", (
        f"Expected status to stay 'pending' after fit failure, got {row['status']!r}"
    )
