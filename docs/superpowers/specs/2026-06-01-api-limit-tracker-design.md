# Daily API Limit Tracker — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)

## Problem

When a long-running campaign drives the Groq LLM (fit-scoring, résumé tailoring),
the user has no visibility into how close they are to Groq's **daily** quota. Today
the app only reacts to a per-call 429 (pauses fit-retries via a banner). The user
wants:

1. A **live gauge on the dashboard** showing progress toward the daily limit.
2. **All runs stopped immediately** the moment a rate-limit (429) actually hits.
3. A **proactive notification** when approaching the daily limit (before being blocked).

## Decisions (locked)

- **Track tokens/day, not requests.** On Groq's free tier the token-per-day cap
  (~100k) binds long before the request-per-day cap (~1,000) for this token-heavy
  workload. The provider SDK responses already contain `usage.total_tokens`; the
  current code discards it. We will thread it through and persist it.
- **Daily cap is configurable** via a Settings field (`daily_token_limit` config
  key), defaulting to **100,000** (Groq free-tier TPD).
- **Auto-stop is tiered** — fired from the existing 429 path, not the estimated gauge,
  but graduated so a transient minute-window limit does **not** kill a long campaign:
  - **Transient/medium limit** (retry-after below `DAILY_STOP_THRESHOLD_MS = 5 min`
    *and* usage below the cap) → *pause only* and auto-resume (today's behavior).
  - **Daily-exhaustion limit** (retry-after ≥ 5 min — daily caps reset at UTC midnight
    so they return long waits — *or* `totalTokens` already ≥ cap) → **hard-stop the
    campaign**.
- **Warn at 80%** of the cap. Threshold is a hardcoded constant (`WARN_THRESHOLD = 0.8`)
  — not exposed in Settings (YAGNI).
- **Track tokens per active model**, not summed across all models — Groq's cap is
  per-model. The gauge measures the active model's tokens against the cap.
- **Notify via the browser Notification API (desktop popup) + in-app banner.**

## Architecture

Four small units, each independently testable:

### 1. Token-usage tracking (`src/lib/db.ts`)
- Add a `tokens` column to the existing `api_usage` table (idempotent ALTER, same
  pattern as the fit-scoring v2 columns).
- New/changed helpers:
  - `incrementApiUsage(modelKey, tokens = 0)` — bumps `call_count` by 1 and `tokens`
    by the supplied amount in one UPSERT. Backward-compatible default keeps existing
    call sites working.
  - `getApiUsageToday()` — extended to also return per-model tokens; returns
    `{ counts: Record<string, number>, tokensByModel: Record<string, number> }`.
    Callers pick the active model's tokens (Groq's cap is per-model); summing across
    models would conflate distinct caps.
- **Interface:** pure DB functions, no knowledge of limits or UI.

### 2. Token capture at the LLM boundary (`src/lib/resume.ts`)
- The provider completion functions (Groq / Anthropic / OpenRouter branches) currently
  resolve to a bare `string`. Change them to resolve to `{ text: string; totalTokens: number }`,
  reading `completion.usage?.total_tokens ?? 0`.
- `callProvider` / `callLlm` thread `totalTokens` back to the existing `trackUsage`
  call so `incrementApiUsage(usageKey, totalTokens)` records real tokens.
- No new API calls; only the already-returned usage object is read.

### 3. Tiered auto-stop on rate limit (`src/lib/resume.ts` → `setRateLimited`)
- `setRateLimited(retryAtMs, message)` is the single chokepoint already called on every
  long 429. Extend it to **conditionally** halt active work:
  - Compute `isDailyExhaustion = (retryAtMs - Date.now()) >= DAILY_STOP_THRESHOLD_MS`
    (5 min) `|| getActiveModelTokensToday() >= dailyLimit`.
  - **Only if `isDailyExhaustion`:** call `stopCampaign()` and mark the active campaign
    `stopped` with `stop_reason = "rate_limited"` (via `getActiveCampaign` /
    `updateCampaignStatus`). Imported lazily (`require("./campaign")`, `require("./db")`)
    to avoid a circular import, matching the existing `require("./db")` in `trackUsage`.
  - **Otherwise:** leave the existing pause/back-off behavior untouched — the run
    auto-resumes once `retryAt` passes.
- Fit-retry polling already backs off on `getRateLimitState()` in both cases.
- **Result:** a momentary minute-window limit pauses and recovers on its own; a real
  daily-quota exhaustion hard-stops the campaign + pauses fit-retries.

### 4. Usage API + dashboard gauge
- **`/api/usage` (GET)** — extend the response to:
  ```json
  {
    "model": "<active model_key>",
    "tokens": 42310,
    "dailyLimit": 100000,
    "pct": 0.42,
    "warn": false,
    "rateLimited": false,
    "retryAt": 0,
    "calls": 37
  }
  ```
  `tokens` = the **active model's** tokens today (`tokensByModel[activeModel]`), not a
  sum. `dailyLimit` comes from `getConfig("daily_token_limit")` (fallback 100000).
  `warn = pct >= 0.8`. `rateLimited` / `retryAt` come from `getRateLimitState()`.
- **`DashboardClient.tsx`** — new `LimitGauge` sub-component:
  - Polls `/api/usage` every 15 s (independent of the 2 s status poll).
  - Renders a labeled progress bar: `42,310 / 100,000 tokens today (42%)`.
  - Color states: normal (<80%), warn (≥80%, amber), blocked (rate-limited, red, shows
    "resets/​retry at <time>").
  - An "Enable alerts" toggle on the gauge requests `Notification.permission` **on that
    click** (a user gesture — never on page load, which browsers auto-deny). If granted,
    crossing 80% for the first time this session fires a desktop notification
    ("JobBot: 80% of your daily Groq token limit used"), guarded by a `useRef` so it
    fires once per session. If denied/unsupported, degrade silently to the in-app banner.
  - When `rateLimited` is true, surface the existing red banner copy (reuse current
    `llmRateLimited` styling) and note that runs were auto-stopped.
- **`src/app/settings/...`** — add a "Daily token limit" number input writing the
  `daily_token_limit` config key through the existing settings POST route.

## Data flow

```
LLM call (resume.ts) ──usage.total_tokens──▶ incrementApiUsage(model, tokens) ──▶ api_usage.tokens
                                                                                        │
long 429 ──▶ setRateLimited() ──▶ daily-exhaustion? ──yes──▶ stopCampaign() + stopped(rate_limited)
                                          └──no──▶ pause + auto-resume after retryAt    │
                                                                                        ▼
Dashboard ──poll 15s──▶ GET /api/usage ──▶ {model, tokens, dailyLimit, pct, warn, rateLimited}
                                                │
                                  LimitGauge: bar + color + (if alerts enabled) once-per-session notify ≥80%
```

## Error handling

- Token capture is best-effort: if `usage` is absent, record `0` tokens (call still
  counted). Never throw from the usage path.
- Auto-stop in `setRateLimited` is wrapped in try/catch (lazy requires) so a stop
  failure never masks the original `RateLimitError`.
- `/api/usage` returns safe defaults if the DB read fails.
- Desktop notification is feature-detected (`"Notification" in window`); absence
  degrades silently to the in-app banner.

## Testing

- **Unit (`tests/db.test.ts`):** `incrementApiUsage` accumulates tokens; `getApiUsageToday`
  sums tokens; the ALTER is idempotent.
- **Unit (resume):** `setRateLimited` with a **long** retry-after (or usage ≥ cap)
  triggers `stopCampaign` + campaign status update; a **short** retry-after does **not**
  stop the campaign (mock campaign/db). Provider parsing maps a usage object to
  `totalTokens`.
- **Unit (usage route):** `/api/usage` reports the **active model's** tokens and computes
  `pct`/`warn` correctly across boundaries (0%, 79%, 80%, 100%, rate-limited).
- **E2E (`tests/e2e/app.spec.ts`):** gauge renders on the dashboard and reflects a seeded
  usage row; reuse `JOBBOT_TEST_MODE` to inject usage without real LLM calls.
- **Real-key smoke (per project rule):** run a short campaign with the live Groq key,
  confirm the gauge increments by real token counts and a forced 429 stops the campaign.

## Out of scope

- Per-minute (RPM/TPM) visualization — already handled by inline back-off.
- Historical usage charts / multi-day trends.
- Configurable warn threshold.
