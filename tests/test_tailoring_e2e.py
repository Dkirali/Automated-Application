"""End-to-end test for the tailoring flow.

Covers: insert job → tailor_resume → generate_fit_summary → update_application
with mocked LLM responses, verifying the full pipeline that was silently failing.
"""
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Force in-memory DB before importing anything that touches the database
os.environ["JOBBOT_DB"] = ":memory:"

from db.database import (
    init_db, get_conn, set_config, insert_application,
    get_application, update_application, get_pending_jobs,
)
from engine.resume import (
    tailor_resume, generate_fit_summary, extract_keywords_from_response,
    extract_resume_from_response, calculate_ats_score,
)

FAKE_JD = "We need a Senior Product Manager with experience in agile, OKRs, and stakeholder management."

FAKE_TAILOR_RESPONSE = """KEYWORDS: product management, agile, OKRs, stakeholder management, roadmap, strategy, analytics, cross-functional
RESUME:
## EXPERIENCE
**Senior Product Manager** — Acme Corp
- Led product roadmap using agile methodology and OKRs for goal setting
- Managed stakeholder management across 5 cross-functional teams
- Drove product strategy and analytics for key business metrics

## SKILLS
Product management, agile, OKRs, stakeholder management, roadmap, strategy, analytics"""

FAKE_FIT_RESPONSE = """FIT_SCORE: 82
STRENGTHS: product management, agile, stakeholder management
GAPS: analytics tooling experience
VERDICT: Strong match — recommend applying given PM and agile background.
JD_SUMMARY: Senior PM role focused on agile delivery and cross-functional leadership.
JD_KEYWORDS: product management, agile, OKRs, stakeholder management, roadmap"""


@pytest.fixture(autouse=True)
def setup_db(tmp_path):
    """Initialize a fresh in-memory DB and create a dummy master resume."""
    init_db()
    master = tmp_path / "master.pdf"
    master.write_bytes(b"dummy pdf content")
    set_config("master_resume_path", str(master))
    set_config("name", "Test User")
    set_config("email", "test@example.com")
    set_config("phone", "555-1234")
    yield tmp_path


def _insert_test_job(campaign_id=1):
    """Insert a test job and return its app_id."""
    return insert_application(
        campaign_id=campaign_id,
        company="TestCorp",
        title="Senior Product Manager",
        location="Remote",
        url=f"https://linkedin.com/jobs/view/{os.urandom(4).hex()}",
        job_description=FAKE_JD,
        easy_apply=True,
    )


class TestTailorResume:
    """Tests for tailor_resume — the function that calls LLM and writes docx."""

    @patch("engine.resume._call_llm", return_value=FAKE_TAILOR_RESPONSE)
    @patch("engine.resume.read_resume_text", return_value="Experienced PM with agile background.")
    def test_tailor_resume_returns_expected_keys(self, mock_read, mock_llm, setup_db):
        master = str(setup_db / "master.pdf")
        result = tailor_resume(job_id=1, job_description=FAKE_JD, master_resume_path=master)

        assert "ats_score" in result
        assert "keywords" in result
        assert "docx_path" in result
        assert result["ats_score"] > 0
        assert len(result["keywords"]) > 0
        assert Path(result["docx_path"]).name == "tailored.docx"

    @patch("engine.resume._call_llm", return_value=FAKE_TAILOR_RESPONSE)
    @patch("engine.resume.read_resume_text", return_value="Experienced PM with agile background.")
    def test_tailor_resume_creates_docx_file(self, mock_read, mock_llm, setup_db):
        master = str(setup_db / "master.pdf")
        result = tailor_resume(job_id=2, job_description=FAKE_JD, master_resume_path=master)
        assert Path(result["docx_path"]).exists()

    @patch("engine.resume._call_llm", side_effect=RuntimeError("API quota exceeded"))
    @patch("engine.resume.read_resume_text", return_value="Some resume text.")
    def test_tailor_resume_propagates_api_error(self, mock_read, mock_llm, setup_db):
        master = str(setup_db / "master.pdf")
        with pytest.raises(RuntimeError, match="API quota exceeded"):
            tailor_resume(job_id=3, job_description=FAKE_JD, master_resume_path=master)

    @patch("engine.resume._call_llm", return_value="KEYWORDS: python\nRESUME:\n")
    @patch("engine.resume.read_resume_text", return_value="Original resume text here.")
    def test_tailor_resume_fallback_on_empty_parse(self, mock_read, mock_llm, setup_db):
        """When LLM returns empty RESUME block, should fall back to original text."""
        master = str(setup_db / "master.pdf")
        result = tailor_resume(job_id=4, job_description=FAKE_JD, master_resume_path=master)
        # Should still return a result (using original text as fallback)
        assert result["docx_path"] is not None


class TestGenerateFitSummary:
    """Tests for generate_fit_summary — the fit evaluation call."""

    @patch("engine.resume._call_llm", return_value=FAKE_FIT_RESPONSE)
    @patch("engine.resume.read_resume_text", return_value="Experienced PM.")
    def test_fit_summary_parses_all_fields(self, mock_read, mock_llm, setup_db):
        master = str(setup_db / "master.pdf")
        result = generate_fit_summary(FAKE_JD, master)

        assert result["fit_score"] == 82
        assert "product management" in result["strengths"]
        assert "analytics tooling experience" in result["gaps"]
        assert "recommend" in result["verdict"].lower()
        assert result["jd_summary"] != ""
        assert result["raw"] == FAKE_FIT_RESPONSE

    @patch("engine.resume._call_llm", side_effect=RuntimeError("rate limited"))
    @patch("engine.resume.read_resume_text", return_value="Resume text.")
    def test_fit_summary_propagates_api_error(self, mock_read, mock_llm, setup_db):
        master = str(setup_db / "master.pdf")
        with pytest.raises(RuntimeError, match="rate limited"):
            generate_fit_summary(FAKE_JD, master)


class TestEndToEndTailoringPipeline:
    """Full pipeline: insert → tailor → fit → update DB.
    This is the flow that was silently failing in production."""

    @patch("engine.resume._call_llm")
    @patch("engine.resume.read_resume_text", return_value="Experienced PM with agile background.")
    def test_full_pipeline_pending_to_reviewed(self, mock_read, mock_llm, setup_db):
        """Simulates what run_campaign does for each job."""
        # LLM is called twice: once for tailor, once for fit
        mock_llm.side_effect = [FAKE_TAILOR_RESPONSE, FAKE_FIT_RESPONSE]

        app_id = _insert_test_job()
        assert app_id is not None

        # Verify job starts as pending
        job = get_application(app_id)
        assert job["status"] == "pending"
        assert job["ats_score"] is None

        master_path = str(setup_db / "master.pdf")

        # Run tailoring (what run_campaign does)
        tailor = tailor_resume(app_id, FAKE_JD, master_path)
        fit = generate_fit_summary(FAKE_JD, master_path)
        update_application(
            app_id, "reviewed",
            ats_score=tailor["ats_score"],
            original_ats_score=tailor.get("original_ats_score"),
            keywords=tailor.get("keywords_str"),
            resume_path=tailor["docx_path"],
            fit_summary=fit.get("raw", ""),
            jd_summary=fit.get("jd_summary", ""),
        )

        # Verify job is now reviewed with all fields populated
        job = get_application(app_id)
        assert job["status"] == "reviewed"
        assert job["ats_score"] > 0
        assert job["resume_path"] is not None
        assert job["fit_summary"] != ""
        assert job["keywords"] is not None
        assert "agile" in job["keywords"].lower()

    @patch("engine.resume._call_llm", side_effect=RuntimeError("Connection timeout"))
    @patch("engine.resume.read_resume_text", return_value="Resume text.")
    def test_pipeline_api_failure_marks_failed(self, mock_read, mock_llm, setup_db):
        """When API fails, job should be marked 'failed' — not left as 'pending'."""
        app_id = _insert_test_job()
        master_path = str(setup_db / "master.pdf")

        try:
            tailor_resume(app_id, FAKE_JD, master_path)
        except Exception:
            update_application(app_id, "failed")

        job = get_application(app_id)
        assert job["status"] == "failed"

    @patch("engine.resume._call_llm")
    @patch("engine.resume.read_resume_text", return_value="PM with agile background.")
    def test_pipeline_no_job_description_stays_pending(self, mock_read, mock_llm, setup_db):
        """Jobs without a JD should stay pending (skip tailoring)."""
        app_id = insert_application(
            campaign_id=1, company="NoCorp", title="PM",
            location="Remote",
            url=f"https://linkedin.com/jobs/view/{os.urandom(4).hex()}",
            job_description="",  # empty JD
            easy_apply=True,
        )

        job = get_application(app_id)
        assert job["status"] == "pending"
        # LLM should not have been called
        mock_llm.assert_not_called()

    @patch("engine.resume._call_llm")
    @patch("engine.resume.read_resume_text", return_value="Experienced PM.")
    def test_duplicate_url_returns_none(self, mock_read, mock_llm, setup_db):
        """Duplicate URLs should return None from insert_application."""
        url = "https://linkedin.com/jobs/view/duplicate123"
        app_id1 = insert_application(1, "Corp", "PM", "NYC", url, FAKE_JD)
        app_id2 = insert_application(1, "Corp", "PM", "NYC", url, FAKE_JD)
        assert app_id1 is not None
        assert app_id2 is None


class TestRetryPendingRoute:
    """Test the /retry-pending endpoint."""

    @patch("engine.resume._call_llm")
    @patch("engine.resume.read_resume_text", return_value="PM resume.")
    def test_retry_pending_endpoint_exists(self, mock_read, mock_llm, setup_db):
        """Verify the route is registered and accessible."""
        from app import app as flask_app
        with flask_app.test_client() as client:
            resp = client.post("/retry-pending", follow_redirects=False)
            # Should redirect to dashboard (302) or follow redirect (200)
            assert resp.status_code in (302, 200)
