import sqlite3
import os
from pathlib import Path

DB_PATH = os.environ.get("JOBBOT_DB", "jobbot.db")
_conn = None

def get_conn():
    global _conn
    if DB_PATH == ":memory:":
        if _conn is None:
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
        return _conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                titles TEXT NOT NULL,
                locations TEXT NOT NULL,
                status TEXT DEFAULT 'idle',
                started_at TEXT,
                stopped_at TEXT,
                stop_reason TEXT
            );
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER,
                company TEXT,
                title TEXT,
                location TEXT,
                url TEXT UNIQUE,
                status TEXT DEFAULT 'applied',
                ats_score INTEGER,
                resume_path TEXT,
                job_description TEXT,
                applied_at TEXT
            );
            CREATE TABLE IF NOT EXISTS manual_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER,
                company TEXT,
                title TEXT,
                location TEXT,
                url TEXT UNIQUE,
                reason TEXT,
                added_at TEXT
            );
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)

def set_config(key: str, value: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value)
        )

def get_config(key: str) -> str | None:
    conn = get_conn()
    row = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None

def is_setup_complete() -> bool:
    required = ["name", "email", "phone", "master_resume_path"]
    return all(get_config(k) is not None for k in required)
