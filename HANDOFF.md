# JobBot Enhancement — AI Handoff

> **If context is lost mid-session, read this file to continue.**

## Project location
```
/Users/dkirali/Desktop/Project/jobbot
```

## Run the app
```bash
cd /Users/dkirali/Desktop/Project/jobbot
source venv/bin/activate
python app.py
# Opens at http://127.0.0.1:5001
```

## Run tests
```bash
cd /Users/dkirali/Desktop/Project/jobbot
source venv/bin/activate
pytest tests/ -v
# With coverage:
pytest tests/ --cov=db --cov=engine --cov=app --cov-report=term-missing
```

## Git branch
```bash
git checkout feat/ui-enhancements
# or create it: git checkout -b feat/ui-enhancements
```

---

## 6 Features Being Implemented

Pick up from the last **completed** step below.

---

### Feature 1 — Tailored Resume Panel Redesign
**Files:** `templates/review.html` (right panel), `templates/detail.html`, `static/style.css`

Replace the plain `#resume-content` div with a proper panel:
- **Sticky panel header**: model badge (left), download button + keyword match count + re-tailor form (right)
- **Resume body** (`resume-body`): improved typography — cyan section headers with left border accent, indented bullets with › prefix, italic blockquote summary
- **CSS classes to add:**
  - `.resume-panel` — outer wrapper
  - `.resume-panel-header` — sticky top bar (`position: sticky; top: 0; background: #061825; z-index: 10`)
  - `.resume-panel-title` — left side (label + model badge)
  - `.resume-panel-actions` — right side (kw count + download + re-tailor)
  - `.kw-match-badge` — keyword match pill (cyan)
  - `.btn-download` — small cyan HUD download button
  - `.resume-body` — scrollable content area
  - `.resume-body h2.resume-name` — 1.4rem, cyan, bottom border
  - `.resume-body h3.resume-section` — uppercase, 0.7rem, cyan left border 3px
  - `.resume-body .resume-bullet::before` — cyan › prefix
  - `.resume-body .resume-summary` — lime left border, italic

**detail.html**: Same panel but NO re-tailor form (it's for applied/historical jobs).

---

### Feature 2 — Fit Score Breakdown Modal
**Files:** `templates/dashboard.html`, `templates/review.html`, `static/style.css`

Clicking any fit score badge opens a modal with full breakdown.

**Data delivery**: Each job card embeds fit data as `<script type="application/json" id="fit-data-{id}">` containing `{fit_score, strengths[], gaps[], verdict, jd_summary, keywords}`. JS reads this on click — no extra API call.

**Modal structure** (`#fit-modal`, rendered once in body):
```
┌──────────────────────────────────────────────────────┐
│  FIT ANALYSIS — [Job Title]                      [×]  │
├──────────────────────────────────────────────────────┤
│  [score ring]   STRENGTHS: ● chip ● chip             │
│     75%         GAPS: ✗ chip ✗ chip                  │
├──────────────────────────────────────────────────────┤
│  VERDICT: "..."                                       │
├──────────────────────────────────────────────────────┤
│  JD KEYWORDS: [chip] [chip] [chip]                   │
└──────────────────────────────────────────────────────┘
```

**CSS classes:** `#fit-modal`, `.fit-modal-overlay`, `.fit-modal-content`, `.fit-modal-header`, `.fit-score-ring`, `.fit-columns`, `.fit-strengths`, `.fit-gaps`, `.fit-chip-strength`, `.fit-chip-gap`, `.fit-verdict`, `.fit-keywords-list`

**JS:** `openFitModal(id)` reads `#fit-data-{id}` JSON, populates modal, shows it. ESC + overlay click closes.

---

### Feature 3 — Dashboard Sort/Filter Controls
**File:** `templates/dashboard.html`, `static/style.css`

Add sort/filter bar above the pending jobs grid.

**Sort options** (client-side JS, reads `data-*` attrs on cards):
- Fit ↓ (highest first, default)
- Fit ↑ (lowest first)
- Newest (by `data-created`)
- AI Model (alphabetical by `data-model`)

**Filter options:**
- All (default)
- Tailored (`data-tailored="1"`)
- Not Tailored (`data-tailored="0"`)

**Card data attributes to add in Jinja loop:**
```html
data-fit="{{ job.fit_score or 0 }}"
data-model="{{ job.model_used or '' }}"
data-tailored="{{ '1' if job.resume_path else '0' }}"
data-created="{{ job.created_at or '' }}"
```

**CSS:** `.jobs-controls`, `.sort-group`, `.filter-group`, `.sort-btn`, `.filter-btn`, `.sort-btn.active`, `.filter-btn.active`

---

### Feature 4 — Model Selector on Dashboard + Usage Tracking
**Files:** `db/database.py`, `engine/resume.py`, `app.py`, `templates/dashboard.html`, `static/style.css`

**DB changes (`db/database.py`):**
- New table `api_usage (id, provider, model_key, call_date, call_count, UNIQUE(provider,model_key,call_date))`
- New column `preferred_model TEXT DEFAULT 'auto'` on `campaigns`
- New functions: `increment_api_usage(model_key)`, `get_api_usage_today() -> dict`

**Engine change (`engine/resume.py`):**
- After `_set_last_model(model_key)` in `_call_llm()`, call `increment_api_usage(model_key)` (import lazily to avoid circular import)

**App changes (`app.py`):**
- `POST /campaign/start`: read `preferred_model` from form, pass to `create_campaign()`
- `GET /api/usage`: return `jsonify(get_api_usage_today())`
- Pass `available_models` + `configured_models` (set of keys with API key set) to dashboard template

**Dashboard campaign form:**
- Model selector: radio cards, one per model
- Each card shows: model name, usage bar (`--fill-pct` CSS var), call count
- JS: `fetch('/api/usage')` on page load → populate bars
- Groq soft limit estimate: 30 calls/day (bar fills proportionally)
- Models without API key: disabled + "Not configured" label

**CSS:** `.model-options`, `.model-option`, `.model-option input[type=radio]`, `.model-option.active`, `.model-usage-bar`, `.usage-fill`, `.usage-count`, `.not-configured`

---

### Feature 5 — Pagination (Client-Side JS)
**File:** `templates/dashboard.html`, `static/style.css`

`PaginationController` JS class:
```js
class PaginationController {
  constructor(containerSelector, pageSize = 20) { ... }
  // Assigns data-index to each child, shows/hides based on current page
  // Methods: setPageSize(n), nextPage(), prevPage(), render()
}
```

Add pagination bar below each section:
```html
<div class="pagination-bar">
  Show: <button class="page-size-btn active" data-size="20">20</button>
        <button class="page-size-btn" data-size="40">40</button>
        <button class="page-size-btn" data-size="60">60</button>
  <button class="prev-btn">‹</button>
  <span class="page-indicator">1 / 1</span>
  <button class="next-btn">›</button>
</div>
```

**CSS:** `.pagination-bar`, `.page-size-btn`, `.page-size-btn.active`, `.prev-btn`, `.next-btn`, `.page-indicator`

---

### Feature 6 — Manual Tailoring
**File:** `app.py`

**Change in `on_job_found()` callback** (inside `run_campaign()`, lines ~390–413):
- **REMOVE** the entire `tailor_resume()` block and `update_application("reviewed", ...)` after it
- **KEEP** the `_bg_fit()` background thread (fit analysis still auto-runs)
- Jobs stay as `status='pending'` with fit data but no resume

**Dashboard card changes:**
- If `job.resume_path` is None: show "Not tailored" badge + "Tailor Resume" button
- The button is a form: `POST /retailor/<id>` with `model` from campaign's `preferred_model`
- If `job.resume_path` exists: show existing model badge

**Also remove** `_retry_stale_jobs()` startup function (or at minimum, don't auto-tailor in it — keep fit analysis only).

---

## Key Files Reference
```
app.py                     — Flask routes, on_job_found() (~line 364), campaign_start (~line 195)
db/database.py             — Schema + query functions
engine/resume.py           — tailor_resume(), generate_fit_summary(), _call_llm() (~line 421)
templates/dashboard.html   — Main dashboard (426 lines)
templates/review.html      — Review/tailor page (369 lines)
templates/detail.html      — Applied job detail page (102 lines)
static/style.css           — All styles (~1950 lines, cyberpunk HUD theme)
tests/test_database.py     — DB tests
tests/test_app_routes.py   — Flask route tests (NEW)
tests/test_manual_tailor.py — Auto-tailor removal tests (NEW)
```

## Design Tokens (Cyberpunk HUD Theme)
```css
--bg: #040c14          /* deep space background */
--surface: #061825     /* panel surface */
--surface2: #0b2336    /* elevated surface */
--cyan: #00d4ff        /* primary accent */
--lime: #00ff88        /* success / strengths */
--red: #ff3355         /* danger / gaps */
--amber: #ffb700       /* warning / medium score */
--magenta: #ff00aa     /* special accent */
--text: #c8f0ff        /* ice white text */
--muted: #5a9db8       /* muted text */
--subtle: #1e4a60      /* subtle borders */
/* Fonts: Inter (body), Share Tech Mono (HUD/numbers) */
/* NO external CSS/JS libraries — pure CSS + vanilla JS only */
```

## TDD Requirements
- Write tests BEFORE implementing backend changes
- `tests/test_database.py` — extend with api_usage + preferred_model tests
- `tests/test_app_routes.py` — new file for Flask route tests
- `tests/test_manual_tailor.py` — verify auto-tailor not called
- Target: 80%+ coverage on new code

## After All Features Done
```bash
pytest tests/ -v                    # All tests pass
# /everything-claude-code:e2e       # E2E test suite via Claude Code skill
git add -A && git commit -m "feat: add 6 UI enhancements + manual tailoring"
git push -u origin feat/ui-enhancements
```
