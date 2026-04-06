"""
TDD tests for process_job() — eager tailoring at insert time.

These tests verify:
1. tailor_resume is called with correct args when process_job() runs.
2. The application is inserted with status 'pending' before tailoring starts.
3. After successful tailoring, update_application is called with ats_score and resume_path.
4. If tailor_resume raises, the application status is set to 'failed'.
"""
import threading
import pytest
from unittest.mock import patch, MagicMock, call

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
    """Import and call process_job() after the module is loaded."""
    from app import process_job
    stop_event = threading.Event()
    process_job(campaign_id, job, stop_event)


# ---------------------------------------------------------------------------
# Test 1 — tailor_resume is called with the correct arguments
# ---------------------------------------------------------------------------

def test_tailor_called_on_job_insert(tmp_path):
    """process_job() must call tailor_resume(app_id, job_description, master_path)."""
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    tailor_result = {
        "ats_score": 75,
        "original_ats_score": 50,
        "keywords_str": "python, agile",
        "docx_path": str(tmp_path / "tailored.docx"),
    }

    with patch("app.tailor_resume", return_value=tailor_result) as mock_tailor:
        _run_process_job(_make_job(), campaign_id=campaign_id)

    mock_tailor.assert_called_once()
    call_args = mock_tailor.call_args
    # First arg is the app_id (int), second is job_description, third is master path
    assert isinstance(call_args[0][0], int), "First arg must be app_id (int)"
    assert call_args[0][1] == "Build products.", "Second arg must be job_description"
    assert call_args[0][2] == str(resume), "Third arg must be master_resume_path"


# ---------------------------------------------------------------------------
# Test 2 — status is 'pending' right after insert, before tailor completes
# ---------------------------------------------------------------------------

def test_application_status_set_to_pending_before_tailor(tmp_path):
    """
    The application must be inserted with status='pending' before tailor_resume
    is invoked. We verify by capturing the app_id inside a patched tailor_resume
    and checking the DB status at that exact moment.
    """
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    status_at_tailor_time = {}

    def capture_status(app_id, job_description, master_path):
        row = get_application(app_id)
        status_at_tailor_time["status"] = row["status"] if row else None
        return {
            "ats_score": 60,
            "original_ats_score": 40,
            "keywords_str": "agile",
            "docx_path": str(tmp_path / "tailored.docx"),
        }

    with patch("app.tailor_resume", side_effect=capture_status):
        _run_process_job(_make_job(), campaign_id=campaign_id)

    assert status_at_tailor_time["status"] == "pending", (
        f"Expected 'pending' at tailor time, got {status_at_tailor_time['status']!r}"
    )


# ---------------------------------------------------------------------------
# Test 3 — update_application called with ats_score and resume_path on success
# ---------------------------------------------------------------------------

def test_application_updated_after_tailor(tmp_path):
    """
    After tailor_resume returns successfully, update_application must be called
    with status='reviewed', ats_score, and resume_path from the tailor result.
    """
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    tailor_result = {
        "ats_score": 88,
        "original_ats_score": 55,
        "keywords_str": "product, roadmap",
        "docx_path": str(tmp_path / "tailored.docx"),
    }

    with patch("app.tailor_resume", return_value=tailor_result):
        with patch("app.update_application") as mock_update:
            _run_process_job(_make_job(), campaign_id=campaign_id)

    # Find the call that sets the reviewed status
    reviewed_calls = [c for c in mock_update.call_args_list
                      if len(c[0]) >= 2 and c[0][1] == "reviewed"]
    assert reviewed_calls, "update_application was never called with status='reviewed'"

    _, kwargs = reviewed_calls[0]
    assert kwargs.get("ats_score") == 88, f"Expected ats_score=88, got {kwargs.get('ats_score')}"
    assert kwargs.get("resume_path") == str(tmp_path / "tailored.docx"), (
        f"Expected resume_path to match docx_path, got {kwargs.get('resume_path')!r}"
    )


# ---------------------------------------------------------------------------
# Test 4 — tailor_resume failure marks application as 'failed'
# ---------------------------------------------------------------------------

def test_tailor_failure_marks_failed(tmp_path):
    """
    If tailor_resume raises an exception, the application must be updated to
    status='failed' and the exception must not propagate out of process_job().
    """
    resume = tmp_path / "master.docx"
    resume.write_bytes(b"fake")

    from db.database import set_config, create_campaign, insert_application
    set_config("master_resume_path", str(resume))
    campaign_id = create_campaign("test", "PM", "Remote")

    with patch("app.tailor_resume", side_effect=RuntimeError("LLM exploded")):
        with patch("app.update_application") as mock_update:
            # Must NOT raise
            _run_process_job(_make_job(), campaign_id=campaign_id)

    failed_calls = [c for c in mock_update.call_args_list
                    if len(c[0]) >= 2 and c[0][1] == "failed"]
    assert failed_calls, "update_application was never called with status='failed' on tailor error"
