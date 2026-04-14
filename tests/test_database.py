import pytest
import os
from db.database import init_db, get_conn, set_config, get_config, is_setup_complete


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own fresh in-memory DB."""
    monkeypatch.setenv("JOBBOT_DB", ":memory:")
    import db.database as dbmod
    dbmod._conn = None  # reset cached in-memory connection
    yield
    dbmod._conn = None

def test_init_db_creates_tables():
    init_db()
    with get_conn() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert {"campaigns", "applications", "manual_queue", "config"} <= tables

def test_config_set_and_get():
    init_db()
    set_config("name", "Ali")
    assert get_config("name") == "Ali"

def test_config_overwrite():
    init_db()
    set_config("name", "Ali")
    set_config("name", "Mehmet")
    assert get_config("name") == "Mehmet"

def test_setup_incomplete_by_default():
    init_db()
    assert is_setup_complete() is False

def test_setup_complete_after_required_keys():
    init_db()
    for key in ["name", "email", "phone", "master_resume_path"]:
        set_config(key, "value")
    assert is_setup_complete() is True


# ── api_usage table tests (RED — will fail until DB changes are implemented) ──

def test_api_usage_table_exists():
    from db.database import increment_api_usage, get_api_usage_today
    init_db()
    with get_conn() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert "api_usage" in tables


def test_increment_api_usage_first_call():
    from db.database import increment_api_usage, get_api_usage_today
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    usage = get_api_usage_today()
    assert usage.get("groq/llama-3.3-70b", 0) == 1


def test_increment_api_usage_accumulates():
    from db.database import increment_api_usage, get_api_usage_today
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    increment_api_usage("groq/llama-3.3-70b")
    usage = get_api_usage_today()
    assert usage["groq/llama-3.3-70b"] == 2


def test_increment_api_usage_multiple_models():
    from db.database import increment_api_usage, get_api_usage_today
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    increment_api_usage("openrouter/gpt-oss-120b")
    usage = get_api_usage_today()
    assert usage.get("groq/llama-3.3-70b") == 1
    assert usage.get("openrouter/gpt-oss-120b") == 1


def test_get_api_usage_today_returns_dict():
    from db.database import get_api_usage_today
    init_db()
    result = get_api_usage_today()
    assert isinstance(result, dict)


def test_campaigns_has_preferred_model_column():
    init_db()
    with get_conn() as conn:
        cols = {r[1] for r in conn.execute(
            "PRAGMA table_info(campaigns)"
        ).fetchall()}
    assert "preferred_model" in cols
