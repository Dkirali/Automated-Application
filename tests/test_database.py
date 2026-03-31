import pytest
from jobbot.db.database import init_db, get_conn, set_config, get_config, is_setup_complete

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
