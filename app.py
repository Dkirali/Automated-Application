import os
import threading
from pathlib import Path
from flask import Flask, redirect, render_template, request, url_for
from dotenv import load_dotenv
from db.database import (
    init_db, get_config, is_setup_complete, set_config,
    create_campaign, update_campaign_status, get_active_campaign,
    insert_manual, get_all_applications, get_manual_queue, get_seen_urls,
    update_application
)

load_dotenv()
app = Flask(__name__)
RESUMES_DIR = Path("resumes")

_stop_event = threading.Event()
_runner_thread = None
_alert = None


@app.before_request
def setup_guard():
    allowed = {"setup", "static"}
    if request.endpoint not in allowed and not is_setup_complete():
        return redirect(url_for("setup"))


@app.route("/setup", methods=["GET", "POST"])
def setup():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip()
        phone = request.form.get("phone", "").strip()
        api_key = request.form.get("api_key", "").strip()
        resume_file = request.files.get("resume")

        if not all([name, email, phone, api_key, resume_file]):
            return render_template("setup.html", error="All fields are required.")

        master_path = RESUMES_DIR / "master.docx"
        resume_file.save(master_path)
        set_config("name", name)
        set_config("email", email)
        set_config("phone", phone)
        set_config("master_resume_path", str(master_path))
        Path(".env").write_text(f"ANTHROPIC_API_KEY={api_key}\n")
        return redirect(url_for("dashboard"))

    return render_template("setup.html", error=None)


@app.route("/")
def dashboard():
    campaign = get_active_campaign()
    applications = get_all_applications()
    manual = get_manual_queue()
    stats = {
        "applied": sum(1 for a in applications if a["status"] == "applied"),
        "manual": len(manual),
        "status": campaign["status"] if campaign else "idle",
    }
    return render_template("dashboard.html",
                           applications=applications,
                           manual_queue=manual,
                           stats=stats,
                           alert=_alert)


@app.route("/campaign/start", methods=["POST"])
def campaign_start():
    global _runner_thread, _stop_event, _alert
    if get_active_campaign():
        return redirect(url_for("dashboard"))

    titles_raw = request.form.get("titles", "")
    locations_raw = request.form.get("locations", "")
    titles = [t.strip() for t in titles_raw.split(",") if t.strip()]
    locations = [l.strip() for l in locations_raw.split(",") if l.strip()]

    campaign_id = create_campaign(
        name=titles_raw, titles=titles_raw, locations=locations_raw
    )

    _stop_event = threading.Event()
    _alert = None
    _runner_thread = threading.Thread(
        target=run_campaign,
        args=(campaign_id, titles, locations, _stop_event),
        daemon=True
    )
    _runner_thread.start()
    return redirect(url_for("dashboard"))


@app.route("/campaign/stop", methods=["POST"])
def campaign_stop():
    global _alert
    _stop_event.set()
    campaign = get_active_campaign()
    if campaign:
        update_campaign_status(campaign["id"], "stopped", "user_stopped")
    _alert = None
    return redirect(url_for("dashboard"))


@app.route("/application/<int:app_id>")
def application_detail(app_id):
    from db.database import get_conn
    with get_conn() as conn:
        app_row = conn.execute("SELECT * FROM applications WHERE id=?", (app_id,)).fetchone()
    if not app_row:
        return redirect(url_for("dashboard"))
    return render_template("detail.html", application=dict(app_row))


def run_campaign(campaign_id: int, titles: list, locations: list, stop_event):
    """Background thread: scrape + submit jobs until stopped."""
    global _alert
    seen_urls = get_seen_urls()
    apps_this_session = 0
    consecutive_failures = 0

    while not stop_event.is_set():
        # Scraper and submitter wired in later tasks
        stop_event.wait(timeout=300)

    campaign = get_active_campaign()
    if campaign and campaign["status"] == "running":
        update_campaign_status(campaign_id, "stopped")


if __name__ == "__main__":
    init_db()
    RESUMES_DIR.mkdir(exist_ok=True)
    app.run(debug=False, port=5000)
