import os
import threading
from pathlib import Path
from flask import Flask, redirect, render_template, request, url_for
from dotenv import load_dotenv
from db.database import (
    init_db, get_config, is_setup_complete, set_config,
    create_campaign, update_campaign_status, get_active_campaign,
    insert_manual, get_all_applications, get_manual_queue, get_seen_urls,
    update_application, insert_application
)

load_dotenv()
app = Flask(__name__)
RESUMES_DIR = Path("resumes")

_stop_event = threading.Event()
_runner_thread = None
_alert = None
_campaign_lock = threading.Lock()


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
        from dotenv import dotenv_values
        env_path = Path(".env")
        existing = dict(dotenv_values(env_path)) if env_path.exists() else {}
        existing["ANTHROPIC_API_KEY"] = api_key
        env_path.write_text("\n".join(f"{k}={v}" for k, v in existing.items()) + "\n")
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
    with _campaign_lock:
        if get_active_campaign():
            return redirect(url_for("dashboard"))

        titles_raw = request.form.get("titles", "").strip()
        locations_raw = request.form.get("locations", "").strip()
        titles = [t.strip() for t in titles_raw.split(",") if t.strip()]
        locations = [l.strip() for l in locations_raw.split(",") if l.strip()]

        if not titles:
            _alert = "Please provide at least one job title."
            return redirect(url_for("dashboard"))

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
    from db.database import get_application
    app_row = get_application(app_id)
    if not app_row:
        return redirect(url_for("dashboard"))
    return render_template("detail.html", application=app_row)


def run_campaign(campaign_id: int, titles: list, locations: list, stop_event):
    """Background thread: scrape LinkedIn and queue jobs until stopped."""
    global _alert
    from engine.scraper import scrape_jobs

    seen_urls = get_seen_urls()
    apps_this_session = 0

    while not stop_event.is_set():
        try:
            jobs = scrape_jobs(titles, locations, seen_urls, stop_event)
        except Exception as e:
            _alert = f"Scraper error: {e}"
            break

        for job in jobs:
            if stop_event.is_set():
                break

            if apps_this_session >= 20:
                update_campaign_status(campaign_id, "paused", "session_limit")
                _alert = "Paused after 20 applications. Hit Start to continue."
                return

            if not job.get("easy_apply"):
                insert_manual(
                    campaign_id, job.get("company", ""), job.get("title", ""),
                    job.get("location", ""), job["url"], "not_easy_apply"
                )
                continue

            app_id = insert_application(
                campaign_id, job.get("company", ""), job.get("title", ""),
                job.get("location", ""), job["url"], job.get("job_description", "")
            )
            if app_id is None:
                continue  # duplicate URL

            # Tailor resume with Claude
            try:
                from engine.resume import tailor_resume
                master_path = get_config("master_resume_path")
                result = tailor_resume(app_id, job.get("job_description", ""), master_path)
                update_application(
                    app_id, "applied",
                    ats_score=result["ats_score"],
                    resume_path=result["docx_path"]
                )
            except Exception:
                update_application(app_id, "applied")
            apps_this_session += 1
            # Easy Apply submission wired in Task 11

        if not jobs:
            # No new jobs found — wait 5 minutes before re-scraping
            stop_event.wait(timeout=300)

    campaign = get_active_campaign()
    if campaign and campaign["status"] == "running":
        update_campaign_status(campaign_id, "stopped")


@app.route("/download/<int:app_id>")
def download_resume(app_id):
    from flask import send_file
    from db.database import get_application
    app_row = get_application(app_id)
    if not app_row or not app_row.get("resume_path"):
        return "Not found", 404
    docx_path = Path(app_row["resume_path"])
    pdf_path = docx_path.with_suffix(".pdf")
    serve_path = pdf_path if pdf_path.exists() else docx_path
    if not serve_path.exists():
        return "File not found", 404
    return send_file(serve_path, as_attachment=True)


@app.route("/resume-text/<int:app_id>")
def resume_text(app_id):
    from db.database import get_application
    from engine.resume import read_docx_text
    app_row = get_application(app_id)
    if not app_row or not app_row.get("resume_path"):
        return "No resume available."
    return read_docx_text(Path(app_row["resume_path"]))


if __name__ == "__main__":
    init_db()
    RESUMES_DIR.mkdir(exist_ok=True)
    app.run(debug=False, port=int(os.environ.get("FLASK_PORT", 5001)))
