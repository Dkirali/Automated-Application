# JobBot — Design Spec
**Date:** 2026-03-31
**Status:** Approved

---

## Context

The user wants a local automation tool that applies to LinkedIn jobs on their behalf. They manually define target roles and locations, hit Start, and the system scrapes Easy Apply jobs, tailors their resume per posting using Claude, and submits applications — all without them lifting a finger. A dashboard tracks every application, shows the tailored resume per job, and alerts them if something goes wrong.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    JobBot (Local)                    │
│                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐  │
│  │  Flask   │◄──►│  Core Engine │◄──►│  Claude   │  │
│  │Dashboard │    │  (Python)    │    │    API    │  │
│  └──────────┘    └──────┬───────┘    └───────────┘  │
│                         │                            │
│               ┌─────────┼─────────┐                 │
│               ▼         ▼         ▼                 │
│         ┌──────────┐ ┌──────┐ ┌────────┐            │
│         │Playwright│ │SQLite│ │Resumes │            │
│         │(LinkedIn)│ │  DB  │ │ /files │            │
│         └──────────┘ └──────┘ └────────┘            │
└─────────────────────────────────────────────────────┘
```

**Stack:**
- **Backend:** Python + Flask
- **Automation:** Playwright (Chromium) — reuses existing Chrome session cookies
- **AI:** Claude API (claude-sonnet-4-6) for keyword extraction and resume tailoring
- **Resume editing:** python-docx (Word) + WeasyPrint (PDF export)
- **Database:** SQLite (file-based, persists on disk)
- **Frontend:** Flask-served HTML/CSS/JS (light theme, card-based layout)

---

## Core Components

### 1. Campaign Manager
- User defines a campaign: job titles, locations (Istanbul / London / Remote / Hybrid / any combination), and a name
- No duration — campaign runs from Start to Stop
- Multiple campaigns can coexist; each tracked separately
- Campaign statuses: `idle` → `running` → `paused` / `stopped`

### 2. LinkedIn Scraper (Playwright)
- Reads Chrome session cookies from the user's local Chrome profile — no credentials stored
- Searches LinkedIn Jobs using campaign filters
- Detects Easy Apply vs external redirect:
  - **Easy Apply** → proceeds to resume tailoring + submission
  - **External** → saved to manual queue immediately
- Extracts: job title, company, location, full job description, posting URL
- Skips jobs already in the database (deduplication by URL)

### 3. Resume Tailoring Pipeline (Claude)
- Sends full job description + master resume to Claude
- Claude extracts ATS keywords and rewrites bullet points to include them naturally
- Returns: tailored `.docx` content + ATS match score (0–100%)
- Saves per-application files to `/resumes/<job_id>/tailored.docx` and `tailored.pdf`
- Master resume stored once in `/resumes/master.docx`

### 4. Application Submitter (Playwright)
- Clicks Easy Apply on LinkedIn
- Fills standard fields from a one-time config (name, email, phone, years of experience)
- Attaches tailored PDF resume
- Submits and records confirmation in SQLite
- On failure (3 consecutive errors): skips job, flags as `failed`, continues

### 5. Detection Safety
- **Delay between applications:** 90–120 seconds (randomized)
- **Session limit:** Auto-pauses after 20 applications per run (each Start → Stop cycle); waits for user to hit Start again to continue
- **Auto-stop triggers:**

| Signal | Response |
|---|---|
| CAPTCHA detected | Stop — alert: "CAPTCHA detected" |
| Login redirect | Stop — alert: "Session expired — re-login needed" |
| Rate limit / slowdown | Pause 30 min → retry once → stop |
| 3 consecutive submission failures | Stop — alert: "Repeated failures" |
| Account restriction detected | Stop — alert: "Account may be restricted" |

### 6. Dashboard (Flask)

**Main view (light theme, card layout):**
- Stats row: Total Applied / Manual Needed / Session Status
- Start / Stop button (prominent)
- Application list: company, title, location, status badge (Applied ✓ / Manual ⚠ / Failed ✗)
- Manual queue section: jobs flagged for manual application with LinkedIn URL

**Application detail view (click any job):**
- Side-by-side panel:
  - Left: Job posting with ATS keywords highlighted in yellow
  - Right: Tailored resume with matched keywords highlighted in green + ATS score badge
  - Download PDF button

---

## Database Schema

```sql
campaigns (
  id, name, titles, locations,
  status,       -- idle | running | paused | stopped
  started_at, stopped_at, stop_reason
)

applications (
  id, campaign_id, company, title, location,
  url, status,  -- applied | failed
  ats_score, resume_path, applied_at
)

manual_queue (
  id, campaign_id, company, title, location,
  url, reason, added_at
)

config (
  key, value    -- name, email, phone, master_resume_path
)
-- Note: Claude API key stored in .env only, never in the database
```

---

## First-Time Setup

On first run, user is prompted to:
1. Enter name, email, phone (stored in `config` table)
2. Upload master resume (`.docx`)
3. Enter Claude API key (saved to `.env`, never stored in the database)
4. Log into LinkedIn in the browser that opens (session cookies captured automatically)

---

## Project Structure

```
jobbot/
├── app.py                  # Flask app + routes
├── engine/
│   ├── scraper.py          # LinkedIn Playwright scraper
│   ├── submitter.py        # Easy Apply submission
│   ├── resume.py           # Claude tailoring + PDF export
│   └── safety.py           # Detection signals + auto-stop logic
├── db/
│   └── database.py         # SQLite setup + queries
├── templates/
│   ├── dashboard.html
│   ├── detail.html
│   └── setup.html
├── static/
│   └── style.css
├── resumes/
│   ├── master.docx         # User's master resume
│   └── <job_id>/           # Per-application tailored files
├── jobbot.db               # SQLite database
├── requirements.txt
└── .env                    # Claude API key (gitignored)
```

---

## Phased GitHub Delivery

Each phase ships as a PR into `main`. Work happens on a feature branch (`phase-1-foundation`, `phase-2-scraper`, etc.) and is merged only when that phase is fully working end-to-end.

### Phase 1 — Foundation `phase-1-foundation`
**Goal:** Project skeleton, database, setup wizard, and dashboard shell running locally.
- Repo init with `.gitignore` (excludes `.env`, `jobbot.db`, `resumes/`)
- SQLite schema + `database.py`
- First-time setup wizard (Flask route + `setup.html`)
- Dashboard shell with hardcoded placeholder data (`dashboard.html`, `style.css`)
- `requirements.txt`
- ✅ Merge when: `python app.py` opens the setup wizard and dashboard loads with placeholder data

### Phase 2 — LinkedIn Scraper `phase-2-scraper`
**Goal:** Real job scraping from LinkedIn, Easy Apply detection, manual queue population.
- `engine/scraper.py` — cookie-based login, job search, Easy Apply detection
- Scraper results written to SQLite (`applications` + `manual_queue` tables)
- Dashboard wired to real data (no more placeholders)
- ✅ Merge when: Running a campaign populates the dashboard with real LinkedIn jobs

### Phase 3 — Resume Tailoring `phase-3-resume`
**Goal:** Claude reads job postings and produces a tailored resume per application.
- `engine/resume.py` — Claude API integration, keyword extraction, `.docx` editing, PDF export
- ATS score stored in `applications` table
- Application detail view wired up (side-by-side job + resume, keywords highlighted, download PDF)
- ✅ Merge when: Clicking a scraped job shows a tailored resume with ATS score and downloadable PDF

### Phase 4 — Application Submitter `phase-4-submitter`
**Goal:** End-to-end Easy Apply submission via Playwright.
- `engine/submitter.py` — Easy Apply flow, field filling, PDF attachment, submission
- Application status updated to `applied` on success, `failed` on error
- ✅ Merge when: System applies to a real Easy Apply job and it appears in LinkedIn "Applied Jobs"

### Phase 5 — Detection Safety & Polish `phase-5-safety`
**Goal:** Auto-stop logic, randomized delays, session limits, and UI polish.
- `engine/safety.py` — CAPTCHA detection, rate limit handling, auto-stop signals
- 90–120s randomized delay between applications
- 20-app session limit with auto-pause
- Alert banners in dashboard for stop reasons
- ✅ Merge when: All auto-stop triggers fire correctly and the dashboard shows clear alerts

---

## Verification Plan

1. **Setup flow:** Run `python app.py`, confirm setup wizard appears on first launch
2. **LinkedIn scrape:** Start a campaign, confirm jobs appear in the dashboard within 2 minutes
3. **Resume tailoring:** Check `/resumes/<job_id>/` for `.docx` and `.pdf` files after first application
4. **ATS score:** Verify score appears in dashboard detail view and keywords are highlighted
5. **Easy Apply submission:** Confirm application shows as "Applied ✓" in dashboard and appears in LinkedIn "Applied Jobs"
6. **Manual queue:** Confirm non-Easy Apply jobs appear in manual section with correct URL
7. **Auto-stop:** Manually trigger a CAPTCHA scenario (or block network) and verify system stops and alerts
8. **Stop button:** Verify system halts cleanly mid-run with no partial state corruption
