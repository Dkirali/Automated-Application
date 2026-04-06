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
    update_application, insert_application, get_pending_jobs, mark_applied,
    get_application, get_all_campaigns
)

from engine.resume import tailor_resume, generate_fit_summary
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
        os.environ["ANTHROPIC_API_KEY"] = api_key  # apply immediately without restart
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
    pending = get_pending_jobs()
    campaigns = get_all_campaigns()
    return render_template("dashboard.html",
                           linkedin_connected=_linkedin_connected(),
                           applications=applications,
                           pending_jobs=pending,
                           manual_queue=manual,
                           campaigns=campaigns,
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
        gemini_key = request.form.get("gemini_key", "").strip()
        groq_key = request.form.get("groq_key", "").strip()
        resume_file = request.files.get("resume")

        if not all([name, email, phone]):
            error = "Name, email, and phone are required."
        else:
            set_config("name", name)
            set_config("email", email)
            set_config("phone", phone)
            if api_key or gemini_key or groq_key:
                from dotenv import dotenv_values
                env_path = Path(".env")
                existing = dict(dotenv_values(env_path)) if env_path.exists() else {}
                if api_key:
                    existing["ANTHROPIC_API_KEY"] = api_key
                    os.environ["ANTHROPIC_API_KEY"] = api_key
                if groq_key:
                    existing["GROQ_API_KEY"] = groq_key
                    os.environ["GROQ_API_KEY"] = groq_key
                if gemini_key:
                    existing["GEMINI_API_KEY"] = gemini_key
                    os.environ["GEMINI_API_KEY"] = gemini_key
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


def process_job(campaign_id: int, job: dict, stop_event) -> None:
    """
    Insert a single scraped job as 'pending', then immediately tailor the resume
    in the same background thread.

    Status flow:
      pending  →  reviewed  (tailor succeeded)
      pending  →  failed    (tailor raised)

    If no master_resume_path is configured, the job is left as 'pending' so the
    user can still review it manually.
    """
    company = job.get("company", "Unknown")
    title   = job.get("title", "Unknown")

    app_id = insert_application(
        campaign_id, company, title,
        job.get("location", ""), job["url"],
        job.get("job_description", ""), easy_apply=True,
    )
    if not app_id:
        return  # duplicate URL — skip

    master_path = get_config("master_resume_path")
    if not master_path or not job.get("job_description"):
        # Nothing to tailor — leave as pending for manual review
        return

    try:
        tailor = tailor_resume(app_id, job["job_description"], master_path)
        update_application(
            app_id, "reviewed",
            ats_score=tailor["ats_score"],
            original_ats_score=tailor.get("original_ats_score"),
            keywords=tailor.get("keywords_str"),
            resume_path=tailor["docx_path"],
        )
    except Exception:
        update_application(app_id, "failed")


def run_campaign(campaign_id: int, titles: list, filters: dict, stop_event):
    """
    Background thread: scrape LinkedIn, insert jobs, and tailor resumes per-job.
    """
    global _alert, _status
    from engine.scraper import scrape_jobs

    seen_urls = get_seen_urls()

    def update(msg):
        global _status
        _status = msg

    while not stop_event.is_set():
        update(f"Scraping LinkedIn for: {', '.join(titles)}…")

        # Jobs are inserted into DB immediately as the scraper finds each one
        pending_jobs_to_tailor = []

        def on_job_found(job):
            """Called by scraper for each job as it's discovered."""
            if not job.get("easy_apply"):
                insert_manual(
                    campaign_id,
                    job.get("company", "Unknown"),
                    job.get("title", "Unknown"),
                    job.get("location", ""),
                    job["url"],
                    "not_easy_apply",
                )
                return
            app_id = insert_application(
                campaign_id,
                job.get("company", "Unknown"),
                job.get("title", "Unknown"),
                job.get("location", ""),
                job["url"],
                job.get("job_description", ""),
                easy_apply=True,
            )
            if app_id:
                job["_app_id"] = app_id
                pending_jobs_to_tailor.append(job)

        try:
            scrape_jobs(titles, filters, seen_urls, stop_event,
                        status_callback=update, on_job=on_job_found)
        except Exception as e:
            _alert = f"Scraper error: {e}"
            _status = f"Scraper error: {e}"
            break

        if not pending_jobs_to_tailor:
            update("No new jobs found — waiting 5 minutes before re-scraping…")
            stop_event.wait(timeout=300)
            continue

        _alert = f"Added {len(pending_jobs_to_tailor)} job(s) — tailoring resumes now…"

        # Tailor resumes + generate fit summaries one by one
        master_path = get_config("master_resume_path")
        for job in pending_jobs_to_tailor:
            if stop_event.is_set():
                break
            app_id = job["_app_id"]
            title = job.get("title", "Unknown")
            company = job.get("company", "Unknown")
            update(f"Tailoring resume for: {title} at {company}…")
            if not master_path or not job.get("job_description"):
                continue
            try:
                tailor = tailor_resume(app_id, job["job_description"], master_path)
                fit = generate_fit_summary(job["job_description"], master_path)
                update_application(
                    app_id, "reviewed",
                    ats_score=tailor["ats_score"],
                    original_ats_score=tailor.get("original_ats_score"),
                    keywords=tailor.get("keywords_str"),
                    resume_path=tailor["docx_path"],
                    fit_summary=fit.get("raw", ""),
                    jd_summary=fit.get("jd_summary", ""),
                )
            except Exception:
                update_application(app_id, "failed")

        added = len(pending_jobs_to_tailor)
        update(f"Processed {added} job(s) — review them in the dashboard")
        _alert = f"Added {added} job(s) – review them in the dashboard"
        stop_event.wait(timeout=300)  # wait before next scrape pass

    _status = "Idle"
    campaign = get_active_campaign()
    if campaign and campaign["status"] == "running":
        update_campaign_status(campaign_id, "stopped")


@app.route("/review/<int:app_id>")
def review_job(app_id):
    """Show a job pending review — read-only, tailoring has already run at insert time."""
    job = get_application(app_id)
    if not job or job["status"] not in ("pending", "reviewed"):
        return redirect(url_for("dashboard"))

    # Reconstruct fit dict from stored fit_summary (populated by process_job at insert time)
    from engine.resume import parse_fit_score, parse_fit_field
    raw = job.get("fit_summary") or ""
    fit = {
        "fit_score":   parse_fit_score(raw),
        "strengths":   [s.strip() for s in parse_fit_field(raw, "STRENGTHS").split(",") if s.strip()],
        "gaps":        [g.strip() for g in parse_fit_field(raw, "GAPS").split(",") if g.strip()],
        "verdict":     parse_fit_field(raw, "VERDICT") or raw,
        "jd_summary":  job.get("jd_summary"),
        "jd_keywords": job.get("keywords"),
    }

    return render_template("review.html", job=job, fit=fit)


@app.route("/apply/<int:app_id>", methods=["POST"])
def apply_job(app_id):
    """Submit Easy Apply for a pending job."""
    from db.database import get_application
    job = get_application(app_id)
    if not job:
        return redirect(url_for("dashboard"))

    master_path = get_config("master_resume_path")
    pdf_path = job.get("resume_path") or master_path

    try:
        submitted = submit_application(
            job_url=job["url"],
            pdf_path=pdf_path,
            name=get_config("name"),
            email=get_config("email"),
            phone=get_config("phone"),
        )
        mark_applied(app_id) if submitted else update_application(app_id, "failed")
    except Exception:
        update_application(app_id, "failed")

    return redirect(url_for("dashboard"))


@app.route("/discard/<int:app_id>", methods=["POST"])
def discard_job(app_id):
    update_application(app_id, "discarded")
    return redirect(url_for("dashboard"))


@app.route("/retailor/<int:app_id>", methods=["POST"])
def retailor_job(app_id):
    """Clear cached resume/ATS data so review page re-runs tailoring fresh."""
    from db.database import get_conn
    with get_conn() as conn:
        conn.execute(
            "UPDATE applications SET resume_path=NULL, ats_score=NULL, "
            "original_ats_score=NULL, keywords=NULL WHERE id=?",
            (app_id,)
        )
    return redirect(url_for("review_job", app_id=app_id))


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
    from engine.resume import read_docx_text
    app_row = get_application(app_id)
    if not app_row or not app_row.get("resume_path"):
        return jsonify({"text": "", "keywords": []})
    text = read_docx_text(Path(app_row["resume_path"]))
    kw_raw = app_row.get("keywords") or ""
    keywords = [k.strip() for k in kw_raw.split(",") if k.strip()]
    return jsonify({"text": text, "keywords": keywords})


if __name__ == "__main__":
    init_db()
    RESUMES_DIR.mkdir(exist_ok=True)
    app.run(debug=False, port=int(os.environ.get("FLASK_PORT", 5001)))
