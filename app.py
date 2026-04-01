import os
import sys
import threading
from pathlib import Path
from flask import Flask, jsonify, redirect, render_template, request, url_for
from dotenv import load_dotenv
from db.database import (
    init_db, get_config, is_setup_complete, set_config,
    create_campaign, update_campaign_status, get_active_campaign,
    insert_manual, get_all_applications, get_manual_queue, get_seen_urls,
    update_application, insert_application
)

from engine.resume import tailor_resume
from engine.submitter import submit_application

load_dotenv()
app = Flask(__name__)
RESUMES_DIR = Path("resumes")
ALLOWED_RESUME_EXTENSIONS = {".docx", ".doc", ".pdf"}


def _save_resume(file) -> tuple[Path | None, str | None]:
    """Save an uploaded resume file. Returns (path, error_message)."""
    if not file or not file.filename:
        return None, None
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_RESUME_EXTENSIONS:
        return None, f"Unsupported file type '{ext}'. Please upload a .docx, .doc, or .pdf."
    dest = RESUMES_DIR / f"master{ext}"
    file.save(dest)
    return dest, None

_stop_event = threading.Event()
_runner_thread = None
_alert = None
_status = "Idle"
_campaign_lock = threading.Lock()

JOBBOT_PROFILE = Path.home() / ".jobbot-chrome"


def _linkedin_connected() -> bool:
    """True if the dedicated Chrome profile has LinkedIn cookies."""
    return (JOBBOT_PROFILE / "Default" / "Cookies").exists()


def _open_linkedin_browser():
    """Open Chrome on the LinkedIn login page using the dedicated profile."""
    from playwright.sync_api import sync_playwright
    JOBBOT_PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(JOBBOT_PROFILE),
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.new_page()
        page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
        try:
            page.wait_for_event("close", timeout=600_000)
        except Exception:
            pass
        context.close()


@app.before_request
def setup_guard():
    allowed = {"setup", "settings", "static", "linkedin_connect", "linkedin_status"}
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

        master_path, err = _save_resume(resume_file)
        if err:
            return render_template("setup.html", error=err)
        if not master_path:
            return render_template("setup.html", error="Please upload your resume.")
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
    resume_path = get_config("master_resume_path")
    resume_name = Path(resume_path).name if resume_path else None
    return render_template("dashboard.html",
                           linkedin_connected=_linkedin_connected(),
                           applications=applications,
                           manual_queue=manual,
                           stats=stats,
                           alert=_alert,
                           resume_name=resume_name)


@app.route("/settings", methods=["GET", "POST"])
def settings():
    success = None
    error = None
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip()
        phone = request.form.get("phone", "").strip()
        api_key = request.form.get("api_key", "").strip()
        resume_file = request.files.get("resume")

        if not all([name, email, phone]):
            error = "Name, email, and phone are required."
        else:
            set_config("name", name)
            set_config("email", email)
            set_config("phone", phone)
            if api_key:
                from dotenv import dotenv_values
                env_path = Path(".env")
                existing = dict(dotenv_values(env_path)) if env_path.exists() else {}
                existing["ANTHROPIC_API_KEY"] = api_key
                env_path.write_text("\n".join(f"{k}={v}" for k, v in existing.items()) + "\n")
            if resume_file and resume_file.filename:
                new_path, err = _save_resume(resume_file)
                if err:
                    error = err
                else:
                    set_config("master_resume_path", str(new_path))
            if not error:
                success = "Settings saved."

    resume_path = get_config("master_resume_path")
    return render_template("settings.html",
                           name=get_config("name") or "",
                           email=get_config("email") or "",
                           phone=get_config("phone") or "",
                           current_resume=Path(resume_path).name if resume_path else None,
                           success=success,
                           error=error)


@app.route("/campaign/start", methods=["POST"])
def campaign_start():
    global _runner_thread, _stop_event, _alert
    with _campaign_lock:
        if get_active_campaign():
            return redirect(url_for("dashboard"))

        titles_raw = request.form.get("titles", "").strip()
        location_text = request.form.get("location_text", "").strip()
        work_types = request.form.getlist("work_type")        # e.g. ["1","2","3"]
        experience_levels = request.form.getlist("exp_level") # e.g. ["3","4"]
        date_posted = request.form.get("date_posted", "")     # e.g. "r604800"
        titles = [t.strip() for t in titles_raw.split(",") if t.strip()]

        if not titles:
            _alert = "Please provide at least one job title."
            return redirect(url_for("dashboard"))

        filters = {
            "location_text": location_text,
            "work_types": work_types,
            "experience_levels": experience_levels,
            "date_posted": date_posted,
        }

        campaign_id = create_campaign(
            name=titles_raw, titles=titles_raw, locations=location_text
        )

        _stop_event = threading.Event()
        _alert = None
        _runner_thread = threading.Thread(
            target=run_campaign,
            args=(campaign_id, titles, filters, _stop_event),
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


@app.route("/status")
def status():
    return jsonify(status=_status)


@app.route("/linkedin-status")
def linkedin_status():
    return jsonify(connected=_linkedin_connected())


@app.route("/linkedin-connect", methods=["POST"])
def linkedin_connect():
    """Spawn the LinkedIn login browser in a background thread."""
    threading.Thread(target=_open_linkedin_browser, daemon=True).start()
    return jsonify(ok=True)


@app.route("/application/<int:app_id>")
def application_detail(app_id):
    from db.database import get_application
    app_row = get_application(app_id)
    if not app_row:
        return redirect(url_for("dashboard"))
    return render_template("detail.html", application=app_row)


def run_campaign(campaign_id: int, titles: list, filters: dict, stop_event):
    """Background thread: scrape LinkedIn and queue jobs until stopped."""
    global _alert, _status
    from engine.scraper import scrape_jobs
    from engine.safety import StopSignal

    seen_urls = get_seen_urls()
    apps_this_session = 0
    consecutive_failures = 0

    while not stop_event.is_set():
        _status = f"Scraping LinkedIn for: {', '.join(titles)}..."
        try:
            jobs = scrape_jobs(titles, filters, seen_urls, stop_event)
        except Exception as e:
            _alert = f"Scraper error: {e}"
            _status = f"Scraper error: {e}"
            break

        if not jobs:
            _status = "No new jobs found — waiting 5 minutes before re-scraping..."
            stop_event.wait(timeout=300)
            continue

        _status = f"Found {len(jobs)} new job(s) — processing..."

        for job in jobs:
            if stop_event.is_set():
                break

            company = job.get("company", "Unknown")
            title = job.get("title", "Unknown")

            if apps_this_session >= 20:
                update_campaign_status(campaign_id, "paused", "session_limit")
                _alert = "Paused after 20 applications. Hit Start to continue."
                _status = "Paused — session limit of 20 reached."
                return

            if not job.get("easy_apply"):
                _status = f"Skipping {title} at {company} — not Easy Apply"
                insert_manual(
                    campaign_id, company, title,
                    job.get("location", ""), job["url"], "not_easy_apply"
                )
                continue

            app_id = insert_application(
                campaign_id, company, title,
                job.get("location", ""), job["url"], job.get("job_description", "")
            )
            if app_id is None:
                continue  # duplicate URL

            # Tailor resume with Claude
            resume_pdf_path = None
            _status = f"Tailoring resume for {title} at {company}..."
            try:
                master_path = get_config("master_resume_path")
                result = tailor_resume(app_id, job.get("job_description", ""), master_path)
                update_application(
                    app_id, "applied",
                    ats_score=result["ats_score"],
                    resume_path=result["docx_path"]
                )
                resume_pdf_path = result.get("pdf_path") or result["docx_path"]
                _status = f"Resume tailored for {title} at {company} (ATS: {result['ats_score']}%) — submitting..."
            except Exception:
                update_application(app_id, "applied")
                _status = f"Resume tailoring failed for {title} at {company} — submitting with master resume..."

            # Submit via Easy Apply
            _status = f"Submitting Easy Apply for {title} at {company}..."
            try:
                submitted = submit_application(
                    job_url=job["url"],
                    pdf_path=resume_pdf_path or get_config("master_resume_path"),
                    name=get_config("name"),
                    email=get_config("email"),
                    phone=get_config("phone"),
                )
                if not submitted:
                    update_application(app_id, "failed")
                    _status = f"Submission failed for {title} at {company}"
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        update_campaign_status(campaign_id, "stopped", "repeated_failures")
                        _alert = StopSignal.REPEATED_FAILURES.value
                        _status = "Stopped — too many consecutive failures"
                        stop_event.set()
                        return
                    continue
            except Exception:
                update_application(app_id, "failed")
                _status = f"Submission error for {title} at {company}"
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    update_campaign_status(campaign_id, "stopped", "repeated_failures")
                    _alert = StopSignal.REPEATED_FAILURES.value
                    _status = "Stopped — too many consecutive failures"
                    stop_event.set()
                    return
                continue

            consecutive_failures = 0
            apps_this_session += 1
            _status = f"Applied to {title} at {company} ({apps_this_session}/20 this session)"

    _status = "Idle"
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
