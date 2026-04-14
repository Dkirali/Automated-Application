"""
Tests for new Flask routes and modifications introduced in the 6-feature UI enhancement.

RED phase: these tests will fail until the implementation is complete.
"""
import pytest
import json
import os


@pytest.fixture(autouse=True)
def isolated_env(tmp_path, monkeypatch):
    """Each test gets its own fresh in-memory DB and isolated environment."""
    db_path = str(tmp_path / "test.db")
    monkeypatch.setenv("JOBBOT_DB", db_path)
    # Reset cached connection
    import db.database as dbmod
    dbmod._conn = None
    yield
    dbmod._conn = None


@pytest.fixture
def client(isolated_env):
    """Flask test client with testing config and setup bypassed."""
    import db.database as dbmod
    dbmod.init_db()

    # Complete setup so setup_guard passes
    dbmod.set_config("name", "Test User")
    dbmod.set_config("email", "test@example.com")
    dbmod.set_config("phone", "1234567890")
    dbmod.set_config("master_resume_path", "/fake/resume.docx")

    import app as app_module
    app_module.app.config["TESTING"] = True
    app_module.app.config["WTF_CSRF_ENABLED"] = False

    with app_module.app.test_client() as c:
        yield c


# ── /api/usage endpoint (RED — fails until endpoint is added) ──

def test_usage_endpoint_exists(client):
    resp = client.get("/api/usage")
    assert resp.status_code == 200


def test_usage_endpoint_returns_json(client):
    resp = client.get("/api/usage")
    assert resp.content_type == "application/json"
    data = resp.get_json()
    assert isinstance(data, dict)


def test_usage_endpoint_returns_empty_when_no_calls(client):
    resp = client.get("/api/usage")
    data = resp.get_json()
    # May be empty dict or have zero-count keys — must be a dict
    assert isinstance(data, dict)


def test_usage_endpoint_reflects_incremented_count(client):
    from db.database import increment_api_usage
    increment_api_usage("groq/llama-3.3-70b")
    increment_api_usage("groq/llama-3.3-70b")
    resp = client.get("/api/usage")
    data = resp.get_json()
    assert data.get("groq/llama-3.3-70b") == 2


# ── campaign/start with preferred_model (RED — fails until implemented) ──

def test_campaign_start_accepts_preferred_model(client, monkeypatch):
    """Posting preferred_model to campaign/start should not error."""
    # Mock the background thread so we don't actually try to scrape
    import app as app_module
    monkeypatch.setattr(app_module, "run_campaign", lambda *a, **kw: None)

    resp = client.post("/campaign/start", data={
        "titles": "Software Engineer",
        "location_text": "Remote",
        "preferred_model": "groq/llama-3.3-70b",
    }, follow_redirects=False)
    # Should redirect to dashboard, not 400/500
    assert resp.status_code in (301, 302, 200)


def test_campaign_start_stores_preferred_model(client, monkeypatch):
    """The preferred_model value should be persisted on the campaign row."""
    import app as app_module
    monkeypatch.setattr(app_module, "run_campaign", lambda *a, **kw: None)
    import threading
    monkeypatch.setattr(threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: None})())

    client.post("/campaign/start", data={
        "titles": "Software Engineer",
        "preferred_model": "openrouter/gpt-oss-120b",
    }, follow_redirects=False)

    import db.database as dbmod
    with dbmod.get_conn() as conn:
        row = conn.execute(
            "SELECT preferred_model FROM campaigns LIMIT 1"
        ).fetchone()
    assert row is not None
    assert row["preferred_model"] == "openrouter/gpt-oss-120b"
