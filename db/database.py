import sqlite3
import os
import datetime
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

def _migrate(conn):
    """Add columns introduced after initial schema, safe to run every startup."""
    migrations = [
        "ALTER TABLE applications ADD COLUMN fit_summary TEXT",
        "ALTER TABLE applications ADD COLUMN easy_apply INTEGER DEFAULT 1",
        "ALTER TABLE applications ADD COLUMN created_at TEXT",
        "ALTER TABLE applications ADD COLUMN original_ats_score INTEGER",
        "ALTER TABLE applications ADD COLUMN keywords TEXT",
        "ALTER TABLE applications ADD COLUMN jd_summary TEXT",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
        except Exception:
            pass  # column already exists


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
                status TEXT DEFAULT 'pending',
                ats_score INTEGER,
                resume_path TEXT,
                job_description TEXT,
                fit_summary TEXT,
                easy_apply INTEGER DEFAULT 1,
                applied_at TEXT,
                created_at TEXT
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

        _migrate(conn)


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


def create_campaign(name: str, titles: str, locations: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO campaigns (name, titles, locations, status, started_at) VALUES (?,?,?,'running',?)",
            (name, titles, locations, datetime.datetime.now(datetime.timezone.utc).isoformat())
        )
        return cur.lastrowid

def update_campaign_status(campaign_id: int, status: str, stop_reason: str = None):
    with get_conn() as conn:
        conn.execute(
            "UPDATE campaigns SET status=?, stopped_at=?, stop_reason=? WHERE id=?",
            (status, datetime.datetime.now(datetime.timezone.utc).isoformat(), stop_reason, campaign_id)
        )

def get_active_campaign() -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE status='running' ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

def get_all_campaigns() -> list[dict]:
    """Return all campaigns with application counts, newest first."""
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT c.*,
                   COUNT(a.id)                                          AS total_count,
                   SUM(CASE WHEN a.status='applied'   THEN 1 ELSE 0 END) AS applied_count,
                   SUM(CASE WHEN a.status='pending'   THEN 1 ELSE 0 END) AS pending_count,
                   SUM(CASE WHEN a.status='discarded' THEN 1 ELSE 0 END) AS discarded_count
            FROM campaigns c
            LEFT JOIN applications a ON a.campaign_id = c.id
            GROUP BY c.id
            ORDER BY c.started_at DESC
            LIMIT 20
        """).fetchall()
        return [dict(r) for r in rows]

def insert_application(campaign_id, company, title, location, url,
                       job_description, easy_apply=True) -> int | None:
    with get_conn() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO applications "
                "(campaign_id,company,title,location,url,job_description,easy_apply,status,created_at) "
                "VALUES (?,?,?,?,?,?,?,'pending',?)",
                (campaign_id, company, title, location, url, job_description,
                 1 if easy_apply else 0,
                 datetime.datetime.now(datetime.timezone.utc).isoformat())
            )
            return cur.lastrowid
        except sqlite3.IntegrityError:
            return None

def insert_manual(campaign_id, company, title, location, url, reason):
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO manual_queue (campaign_id,company,title,location,url,reason,added_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (campaign_id, company, title, location, url, reason,
                 datetime.datetime.now(datetime.timezone.utc).isoformat())
            )
        except sqlite3.IntegrityError:
            pass

def get_all_applications() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM applications WHERE status IN ('applied','failed','discarded') "
            "ORDER BY applied_at DESC"
        ).fetchall()]

def get_manual_queue() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM manual_queue ORDER BY added_at DESC"
        ).fetchall()]

def get_seen_urls() -> set:
    with get_conn() as conn:
        apps = {r[0] for r in conn.execute("SELECT url FROM applications").fetchall()}
        manual = {r[0] for r in conn.execute("SELECT url FROM manual_queue").fetchall()}
        return apps | manual

def update_application(app_id: int, status: str, ats_score: int = None,
                       resume_path: str = None, fit_summary: str = None,
                       original_ats_score: int = None, keywords: str = None,
                       jd_summary: str = None):
    with get_conn() as conn:
        conn.execute(
            "UPDATE applications SET status=?, "
            "ats_score=COALESCE(?,ats_score), "
            "resume_path=COALESCE(?,resume_path), "
            "fit_summary=COALESCE(?,fit_summary), "
            "original_ats_score=COALESCE(?,original_ats_score), "
            "keywords=COALESCE(?,keywords), "
            "jd_summary=COALESCE(?,jd_summary) "
            "WHERE id=?",
            (status, ats_score, resume_path, fit_summary,
             original_ats_score, keywords, jd_summary, app_id)
        )


def mark_applied(app_id: int):
    with get_conn() as conn:
        conn.execute(
            "UPDATE applications SET status='applied', applied_at=? WHERE id=?",
            (datetime.datetime.now(datetime.timezone.utc).isoformat(), app_id)
        )


def get_pending_jobs() -> list[dict]:
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM applications WHERE status='pending' ORDER BY created_at DESC"
        ).fetchall()]

def get_application(app_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
        return dict(row) if row else None
