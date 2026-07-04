@AGENTS.md

# jobbot-next

## What we're building

`jobbot-next` is a **local-first automated LinkedIn job-application assistant**. It runs a
campaign that continuously **scrapes** LinkedIn for roles matching your titles/filters,
uses an **LLM pipeline** to score how well each posting fits your resume and to **ATS-tailor**
a resume per job, classifies each posting as **Easy Apply vs Manual**, and surfaces
everything in a **review dashboard** for human approval before applying.

The whole pipeline is:

```
campaign start → scrape LinkedIn → insert job (pending) → fit-score (async LLM)
              → human review (fit breakdown + Easy/Manual badge) → tailor resume → apply
```

**Stack:** Next.js 16 / React 19 / TypeScript, Node runtime, SQLite (`better-sqlite3`, WAL
mode) as the only datastore. Vitest for unit/integration tests, Playwright for e2e. LLM
providers: Groq / Anthropic / OpenRouter.

Design intent: keep it **local and free-tier friendly** — hence the heavy emphasis on
model routing (cheap model for high-volume scoring, flagship for tailoring) and on
rate-limit / daily-token-budget tracking so a free Groq key isn't blown in minutes.

## End-to-end flow

### Campaign lifecycle — `src/lib/campaign.ts`
- `runCampaign()` is the main loop: scrapes continuously, routes **every** scraped job into
  the `applications` table with status `pending`, then fires a **non-blocking** `analyzeFit()`
  per job (only if a master resume is configured). On an empty scrape it waits ~5 min and
  re-scrapes. It halts on `LinkedinAuthError` (expired session).
- `stopCampaign()` sets the stop flag, updates campaign status, and triggers `/api/retry-fit`
  (fire-and-forget) to settle any in-flight fit analyses.
- `getStatus()` / `getAlert()` expose module-level progress + alert state to `/api/status`.

### Scraping & Easy Apply detection — `src/lib/scraper.ts`
- `scrapeJobs()` drives a persistent Chrome context, paginates LinkedIn search results
  (`buildSearchUrl()` builds the query from titles/location/work-type/experience/date filters),
  and scrolls to hydrate job cards.
- **Easy Apply detection** (`classifyEasyApply()`): inspects the apply button's SVG icon
  (`linkedin-bug` ⇒ Easy Apply, `link-external` ⇒ external) plus its `aria-label`. External
  signals win first; when ambiguous it **defaults to external** (the safer assumption).
  Pure text helper: `isEasyApplyText()`.

### LinkedIn auth — `src/lib/linkedin.ts`
- `isLinkedinConnected()` checks the Chrome profile's `li_at` cookie (must exist and be
  unexpired) — i.e. a real login landed, not just a profile dir.
- `disconnectLinkedin()` removes the profile. `isAuthwallUrl()` detects LinkedIn authwall redirects.

## AI pipeline — `src/lib/resume.ts` (+ `src/lib/fit-scoring.ts`)

### Model routing
- `getActiveProvider()` / `getActiveModel()` resolve the configured provider+model
  (**flagship**, used for resume tailoring). `getFastModel()` returns a cheaper, higher-quota
  model (used for high-volume fit scoring & extraction).
- Model tables: `PROVIDER_MODELS` and `PROVIDER_FAST_MODELS`. Selection is stored in `config`.

### Fit scoring
- On the fresh-scrape path a single `COMBINED_FIT_PROMPT` call merges extraction + rationale
  (replacing the older two-call `EXTRACTOR_PROMPT` + `RATIONALE_PROMPT` sequence).
- Four sub-scores: **fit / keyword / hardreq / parseability**, computed by `blendFitScore()`,
  `calculateKeywordCoverage()`, `calculateHardReqScore()`, `calculateParseability()`; the LLM
  response is parsed by `buildFitResult()` / `parseFitCategories()`. `analyzeFit()` orchestrates
  scoring + persistence; degraded/missing fields fall back to defaults rather than crashing.

### Resume tailoring
- `tailorResume()` uses `TAILOR_PROMPT` (flagship model) to weave 8–12 JD keywords into the
  resume **inline** while preserving canonical facts (dates, employers, schools).
- `calculateAtsScore()` records before/after ATS scores; `extractKeywordsFromResponse()` /
  `extractResumeFromResponse()` parse the output; tailored `.txt` + `.docx` are written per job.

## Rate limiting & API usage tracking

This is the "API usage tracker" — a **three-layer** system tuned to Groq's free tier:

1. **Per-minute (TPM) pacing** — in-memory, not persisted (resets every minute anyway).
   `reserveTokenBudget()` waits when the rolling 60s window is full; `hasTokenBudget()` /
   `tokensUsedInWindow()` are the pure helpers behind it.
2. **429 back-off** — `setRateLimited()` records a back-off window (never shortens it),
   `getRateLimitState()` reads it, `clearRateLimit()` force-clears for a manual retry,
   `parseRetryAfterMs()` parses Groq's "try again in 37m22s" strings.
3. **Daily exhaustion** — `DEFAULT_DAILY_TOKEN_LIMIT` (100k), `DAILY_STOP_THRESHOLD_MS` (5 min).
   `isDailyExhaustion()` returns true when retry-after ≥ 5 min **or** tokens ≥ limit;
   `maybeStopForDailyExhaustion()` then stops the campaign (vs auto-resuming a minute blip).

**Persistence:** `incrementApiUsage()` / `getApiUsageToday()` upsert the `api_usage` table keyed
by `(provider, model_key, call_date)`; token counts come from `extractTokenCount()`.
`GET /api/usage` returns the dashboard gauge payload (`tokens`, `calls`, `dailyLimit`, `pct`,
`warn` at ≥80%, `rateLimited`, `retryAt`) for the **active** model.

> **Known nits** (from a prior review, not yet fixed): `/api/usage` returns all-zeros on any
> error (can mask a real DB fault); a `daily_token_limit` of `0` can't disable the cap
> (`|| DEFAULT` overrides it); the gauge reflects only the active model, not aggregate usage.

## Data model — `src/lib/db.ts`

SQLite with **WAL mode** and an **HMR-safe singleton** connection (`getConn()` / `initDb()` /
`closeConn()`). Tables:

| Table | Purpose |
|-------|---------|
| `campaigns` | campaign metadata + status (`name`, `titles`, `locations`, `status`, `preferred_model`) |
| `applications` | the collected job postings + fit scores + apply state (status `pending`/`applied`/`discarded`…, `easy_apply`, `fit_score`/`keyword_score`/`hardreq_score`/`parseability_score`, `url` UNIQUE) |
| `manual_queue` | jobs routed to manual handling |
| `config` | key–value settings (resume path, name/email/phone, `daily_token_limit`, provider/model) |
| `api_usage` | per-model daily LLM telemetry (`call_count`, `tokens`) |

Key helpers: `insertApplication()`, `updateApplication()`, `getPendingJobs()`,
`getAllApplications()`, `getSeenUrls()` (dedup), `getConfig()`/`setConfig()`,
`createCampaign()`/`updateCampaignStatus()`/`getActiveCampaign()`, `markApplied()`.

## API routes — `src/app/api/*`

| Route | Purpose |
|-------|---------|
| `campaign/start`, `campaign/stop` | launch / stop `runCampaign()` |
| `status` | campaign status + pending/analyzed counts |
| `usage` | daily token gauge + rate-limit state |
| `apply/[id]`, `apply-status/[id]`, `job-status/[id]` | apply + poll application state |
| `discard/[id]`, `bulk-discard` | skip jobs |
| `retailor/[id]` | manual resume re-tailor for one job |
| `retry-fit`, `retry-pending` | resumable scoring of unscored/stale jobs |
| `linkedin-connect`, `linkedin-status`, `linkedin-disconnect` | LinkedIn session mgmt |
| `download/[id]`, `resume-text/[id]` | serve tailored resume (docx / text) |
| `setup`, `settings` | persist config |
| `test-reset` | dev-only DB connection reset |

## Frontend / user journey

`setup` wizard (resume + filters) → `setup/linkedin` (connect, polls `linkedin-status`) →
start campaign → **dashboard** ([src/app/DashboardClient.tsx](src/app/DashboardClient.tsx))
polls `/api/status` (~5s) and `/api/usage` (~15s) and auto-triggers retry-fit → review a job
([ReviewClient.tsx](src/app/review/[id]/ReviewClient.tsx)) with the fit-category breakdown
and **Easy/Manual apply badge** → apply. Settings live at
[SettingsClient.tsx](src/app/settings/SettingsClient.tsx).

## Dev commands

```bash
npm run dev          # next dev (http://localhost:3000)
npm run build        # next build
npm test             # vitest run (unit/integration, tests/*.test.ts)
npm run test:watch   # vitest watch
npx playwright test  # e2e (single worker, isolated tests/e2e/.test.db, page objects in tests/e2e/pages/)
npm run lint         # eslint
```

Deployment notes live in `docs/superpowers/plans/server-deployment.md`.
