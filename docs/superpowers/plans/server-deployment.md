# JobBot — Next.js + TypeScript Migration Plan (Phase 1 + 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate JobBot from Python/Flask/SQLite to Next.js 14+/TypeScript/PostgreSQL while keeping the UI, UX, and feature set **identical**. Phase 1 is a single-user TypeScript rewrite with SQLite. Phase 2 swaps to Supabase PostgreSQL and adds multi-user support with per-user data isolation.

**Architecture:** Phase 1: Next.js API routes + React Server Components + SQLite with better-sqlite3. Phase 2: Same frontend, swaps DB to Supabase PostgreSQL, adds user_id isolation, Supabase Storage for files, per-user Chrome profiles.

**Tech Stack:** Next.js 14+, TypeScript, Vitest, Playwright, better-sqlite3 (Phase 1) / Supabase (Phase 2), Worker Threads for campaign loops.

---

## Context

Migrate JobBot from Python/Flask/SQLite to Next.js 14+/TypeScript/PostgreSQL while keeping the UI, UX, and feature set **identical**. Phase 1 is a single-user TypeScript rewrite with SQLite. Phase 2 swaps to Supabase PostgreSQL and adds multi-user support with per-user data isolation.

**Source repo:** `/Users/dkirali/Desktop/Project/jobbot` (Python, 691-line app.py, ~5600 lines total)
**Target repo:** `jobbot-next` (new Next.js repo, lives alongside jobbot)
**Spec:** `docs/superpowers/specs/2026-04-14-jobbot-nextjs-migration.md`

---

## Critical Files (Python source → TypeScript target)

| Python source | TypeScript target |
|---|---|
| `db/database.py` (262 lines) | `src/lib/db.ts` |
| `engine/safety.py` (42 lines) | `src/lib/safety.ts` |
| `engine/resume.py` (643 lines) | `src/lib/resume.ts` |
| `engine/scraper.py` (263 lines) | `src/lib/scraper.ts` |
| `engine/submitter.py` (85 lines) | `src/lib/submitter.ts` |
| `app.py` campaign loop | `src/lib/campaign.ts` + `src/lib/campaignWorker.ts` |
| `templates/dashboard.html` | `src/app/page.tsx` |
| `templates/review.html` | `src/app/review/[id]/page.tsx` |
| `templates/detail.html` | `src/app/application/[id]/page.tsx` |
| `templates/settings.html` | `src/app/settings/page.tsx` |
| `templates/setup.html` | `src/app/setup/page.tsx` |
| `static/style.css` (2073 lines) | `src/styles/globals.css` (copied verbatim) |

---

## Phase 1 — TypeScript Rewrite

### Task 1 — Scaffold Next.js project

- [ ] **Step 1: Create Next.js project**

```bash
cd /Users/dkirali/Desktop/Project
npx create-next-app@latest jobbot-next \
  --typescript --app --src-dir --no-tailwind --eslint \
  --import-alias "@/*" --no-git
cd jobbot-next
```

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3 docx mammoth playwright @playwright/test vitest @vitejs/plugin-react
npm install -D @types/better-sqlite3 @types/node
npx playwright install chromium
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', globals: true }
})
```

- [ ] **Step 4: Update package.json scripts**

Add to `scripts` section:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Copy CSS**

```bash
cp /Users/dkirali/Desktop/Project/jobbot/static/style.css \
   src/styles/globals.css
```

- [ ] **Step 6: Update layout.tsx**

```typescript
import '@/styles/globals.css'

export const metadata = {
  charset: 'utf-8',
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: scaffold jobbot-next Next.js 14 project"
```

---

### Task 2 — Port db.ts (TDD)

**File:** `src/lib/db.ts`, **Test:** `tests/db.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

process.env.JOBBOT_DB = ':memory:'

import {
  initDb, getConfig, setConfig, isSetupComplete,
  createCampaign, getActiveCampaign, updateCampaignStatus,
  insertApplication, getApplication, updateApplication,
  insertManual, getManualQueue, getSeenUrls,
  getApiUsageToday, incrementApiUsage,
  getPendingJobs, getAllApplications, markApplied, getAllCampaigns,
  closeConn
} from '@/lib/db'

beforeEach(() => { initDb() })
afterEach(() => { closeConn() })

describe('config', () => {
  it('returns null for missing key', () => {
    expect(getConfig('missing')).toBeNull()
  })
  it('stores and retrieves a value', () => {
    setConfig('name', 'Doruk')
    expect(getConfig('name')).toBe('Doruk')
  })
})

describe('isSetupComplete', () => {
  it('returns false when incomplete', () => {
    expect(isSetupComplete()).toBe(false)
  })
  it('returns true when all required keys set', () => {
    setConfig('name', 'Doruk')
    setConfig('email', 'a@b.com')
    setConfig('phone', '123')
    setConfig('master_resume_path', '/tmp/r.docx')
    expect(isSetupComplete()).toBe(true)
  })
})

describe('campaigns', () => {
  it('creates a campaign and returns id', () => {
    const id = createCampaign({ name: 'test', titles: 'PM', locations: 'Remote' })
    expect(id).toBeGreaterThan(0)
  })
  it('getActiveCampaign returns running campaign', () => {
    createCampaign({ name: 'test', titles: 'PM', locations: 'Remote' })
    const c = getActiveCampaign()
    expect(c?.status).toBe('running')
  })
})

describe('applications', () => {
  it('inserts and retrieves application', () => {
    const cid = createCampaign({ name: 'c', titles: 'PM', locations: 'Remote' })
    const id = insertApplication({
      campaignId: cid, company: 'Acme', title: 'PM',
      location: 'Remote', url: 'https://li.com/1',
      jobDescription: 'Desc', easyApply: true
    })
    expect(id).toBeGreaterThan(0)
  })
  it('returns null for duplicate URL', () => {
    const cid = createCampaign({ name: 'c', titles: 'PM', locations: 'Remote' })
    insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/dup', jobDescription: '', easyApply: true })
    const id2 = insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/dup', jobDescription: '', easyApply: true })
    expect(id2).toBeNull()
  })
})

describe('api_usage', () => {
  it('increments and reads usage', () => {
    incrementApiUsage('groq/llama-3.3-70b')
    incrementApiUsage('groq/llama-3.3-70b')
    const usage = getApiUsageToday()
    expect(usage['groq/llama-3.3-70b']).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests — verify RED**

```bash
npm test tests/db.test.ts
# Expected: Multiple test failures (functions don't exist yet)
```

- [ ] **Step 3: Implement src/lib/db.ts**

```typescript
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.JOBBOT_DB ?? path.join(process.cwd(), 'jobbot.db')

let _db: Database.Database | null = null

export function getConn(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

export function closeConn(): void {
  _db?.close()
  _db = null
}

export function initDb(): void {
  const db = getConn()
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      titles TEXT NOT NULL,
      locations TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      stop_reason TEXT,
      preferred_model TEXT DEFAULT 'auto',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      url TEXT UNIQUE NOT NULL,
      job_description TEXT,
      easy_apply INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      ats_score INTEGER,
      original_ats_score INTEGER,
      keywords TEXT,
      resume_path TEXT,
      model_used TEXT,
      fit_summary TEXT,
      jd_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS manual_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      company TEXT,
      title TEXT,
      location TEXT,
      url TEXT UNIQUE NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_key TEXT NOT NULL,
      call_date TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      UNIQUE(model_key, call_date)
    );
  `)
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getConfig(key: string): string | null {
  const row = getConn().prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(key: string, value: string): void {
  getConn().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value)
}

export function isSetupComplete(): boolean {
  return ['name', 'email', 'phone', 'master_resume_path'].every(k => !!getConfig(k))
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export interface CreateCampaignParams {
  name: string
  titles: string
  locations: string
  preferredModel?: string
}

export function createCampaign(p: CreateCampaignParams): number {
  const result = getConn().prepare(
    'INSERT INTO campaigns (name, titles, locations, preferred_model) VALUES (?, ?, ?, ?)'
  ).run(p.name, p.titles, p.locations, p.preferredModel ?? 'auto')
  return result.lastInsertRowid as number
}

export function getActiveCampaign(): Record<string, unknown> | null {
  return (getConn().prepare("SELECT * FROM campaigns WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined) ?? null
}

export function updateCampaignStatus(id: number, status: string, stopReason?: string): void {
  getConn().prepare('UPDATE campaigns SET status = ?, stop_reason = ? WHERE id = ?')
    .run(status, stopReason ?? null, id)
}

export function getAllCampaigns(): Record<string, unknown>[] {
  return getConn().prepare('SELECT * FROM campaigns ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── Applications ─────────────────────────────────────────────────────────────

export interface InsertApplicationParams {
  campaignId: number
  company: string
  title: string
  location: string
  url: string
  jobDescription: string
  easyApply?: boolean
}

export function insertApplication(p: InsertApplicationParams): number | null {
  try {
    const result = getConn().prepare(
      `INSERT INTO applications (campaign_id, company, title, location, url,
       job_description, easy_apply) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(p.campaignId, p.company, p.title, p.location, p.url,
          p.jobDescription, p.easyApply ? 1 : 0)
    return result.lastInsertRowid as number
  } catch { return null }
}

export function getApplication(id: number): Record<string, unknown> | null {
  return (getConn().prepare('SELECT * FROM applications WHERE id = ?').get(id) as Record<string, unknown> | undefined) ?? null
}

export function getSeenUrls(): Set<string> {
  const rows = getConn().prepare('SELECT url FROM applications UNION SELECT url FROM manual_queue').all() as { url: string }[]
  return new Set(rows.map(r => r.url))
}

export interface UpdateApplicationParams {
  atsScore?: number
  originalAtsScore?: number
  keywords?: string
  resumePath?: string
  modelUsed?: string
  fitSummary?: string
  jdSummary?: string
}

export function updateApplication(id: number, status: string, extra: UpdateApplicationParams = {}): void {
  const sets: string[] = ['status = ?']
  const vals: unknown[] = [status]
  if (extra.atsScore !== undefined) { sets.push('ats_score = ?'); vals.push(extra.atsScore) }
  if (extra.originalAtsScore !== undefined) { sets.push('original_ats_score = ?'); vals.push(extra.originalAtsScore) }
  if (extra.keywords !== undefined) { sets.push('keywords = ?'); vals.push(extra.keywords) }
  if (extra.resumePath !== undefined) { sets.push('resume_path = ?'); vals.push(extra.resumePath) }
  if (extra.modelUsed !== undefined) { sets.push('model_used = ?'); vals.push(extra.modelUsed) }
  if (extra.fitSummary !== undefined) { sets.push('fit_summary = ?'); vals.push(extra.fitSummary) }
  if (extra.jdSummary !== undefined) { sets.push('jd_summary = ?'); vals.push(extra.jdSummary) }
  vals.push(id)
  getConn().prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function markApplied(id: number): void {
  getConn().prepare("UPDATE applications SET status = 'applied' WHERE id = ?").run(id)
}

export function getPendingJobs(): Record<string, unknown>[] {
  return getConn().prepare(
    "SELECT * FROM applications WHERE status IN ('pending','reviewed') ORDER BY id DESC"
  ).all() as Record<string, unknown>[]
}

export function getAllApplications(): Record<string, unknown>[] {
  return getConn().prepare('SELECT * FROM applications ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── Manual Queue ─────────────────────────────────────────────────────────────

export function insertManual(campaignId: number, company: string, title: string, location: string, url: string, reason: string): void {
  try {
    getConn().prepare(
      'INSERT INTO manual_queue (campaign_id, company, title, location, url, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(campaignId, company, title, location, url, reason)
  } catch { /* duplicate url */ }
}

export function getManualQueue(): Record<string, unknown>[] {
  return getConn().prepare('SELECT * FROM manual_queue ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── API Usage ────────────────────────────────────────────────────────────────

export function incrementApiUsage(modelKey: string): void {
  const today = new Date().toISOString().slice(0, 10)
  getConn().prepare(
    `INSERT INTO api_usage (model_key, call_date, call_count) VALUES (?, ?, 1)
     ON CONFLICT(model_key, call_date) DO UPDATE SET call_count = call_count + 1`
  ).run(modelKey, today)
}

export function getApiUsageToday(): Record<string, number> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = getConn().prepare(
    'SELECT model_key, call_count FROM api_usage WHERE call_date = ?'
  ).all(today) as { model_key: string; call_count: number }[]
  return Object.fromEntries(rows.map(r => [r.model_key, r.call_count]))
}
```

- [ ] **Step 4: Run tests — verify GREEN**

```bash
npm test tests/db.test.ts
# Expected: All tests pass
```

- [ ] **Step 5: Commit**

```bash
git add tests/db.test.ts src/lib/db.ts
git commit -m "feat: port db.ts with better-sqlite3 (TDD green)"
```

---

### Task 3 — Port safety.ts (TDD)

**File:** `src/lib/safety.ts`, **Test:** `tests/safety.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/safety.test.ts
import { describe, it, expect } from 'vitest'
import { classifyStopSignal, StopSignal } from '@/lib/safety'

describe('classifyStopSignal', () => {
  it('returns CAPTCHA for captcha text', () => {
    expect(classifyStopSignal('Please verify you are not a robot')).toBe(StopSignal.CAPTCHA)
  })
  it('returns AUTH_WALL for login redirect', () => {
    expect(classifyStopSignal('Sign in to LinkedIn to see all jobs')).toBe(StopSignal.AUTH_WALL)
  })
  it('returns RATE_LIMIT for rate limit text', () => {
    expect(classifyStopSignal('Youve exceeded the rate limit')).toBe(StopSignal.RATE_LIMIT)
  })
  it('returns NONE for normal page content', () => {
    expect(classifyStopSignal('Senior Product Manager at Acme Corp')).toBe(StopSignal.NONE)
  })
})
```

- [ ] **Step 2: Run tests — verify RED**

```bash
npm test tests/safety.test.ts
```

- [ ] **Step 3: Implement src/lib/safety.ts**

```typescript
export enum StopSignal {
  NONE = 'NONE',
  CAPTCHA = 'CAPTCHA',
  AUTH_WALL = 'AUTH_WALL',
  RATE_LIMIT = 'RATE_LIMIT',
}

const CAPTCHA_PATTERNS = [/verify you are not a robot/i, /captcha/i, /security check/i]
const AUTH_PATTERNS = [/sign in to linkedin/i, /join now/i, /authwall/i]
const RATE_LIMIT_PATTERNS = [/rate limit/i, /too many requests/i, /exceeded.*limit/i]

export function classifyStopSignal(pageText: string): StopSignal {
  if (CAPTCHA_PATTERNS.some(p => p.test(pageText))) return StopSignal.CAPTCHA
  if (AUTH_PATTERNS.some(p => p.test(pageText))) return StopSignal.AUTH_WALL
  if (RATE_LIMIT_PATTERNS.some(p => p.test(pageText))) return StopSignal.RATE_LIMIT
  return StopSignal.NONE
}

export async function checkPageForStopSignal(page: import('playwright').Page): Promise<StopSignal> {
  const text = await page.evaluate(() => document.body?.innerText ?? '')
  return classifyStopSignal(text)
}
```

- [ ] **Step 4: Run tests — verify GREEN**

```bash
npm test tests/safety.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/safety.test.ts src/lib/safety.ts
git commit -m "feat: port safety.ts (TDD green)"
```

---

### Task 4 — Port resume.ts (Core resume extraction, ATS scoring, LLM wiring)

Follow TDD: write pure function tests first (`matchesKeyword`, `calculateAtsScore`, `parseFitScore`, etc.), then LLM integration tests, then implement.

**Reference:** `/Users/dkirali/Desktop/Project/jobbot/engine/resume.py` (643 lines)

---

### Task 5 — Port scraper.ts (Playwright-based LinkedIn job scraping)

**Reference:** `/Users/dkirali/Desktop/Project/jobbot/engine/scraper.py` (263 lines)

Key differences:
- Python: BeautifulSoup → TypeScript: Playwright locators
- Python: threading → TypeScript: Promise-based async
- Persistent Chrome profile storage for LinkedIn cookies

---

### Task 6 — Port submitter.ts (LinkedIn Easy Apply automation)

**Reference:** `/Users/dkirali/Desktop/Project/jobbot/engine/submitter.py` (85 lines)

Handles form filling and application submission via Playwright.

---

### Task 7 — Campaign runner (Worker Threads for long-running campaign loops)

**Files:** `src/lib/campaign.ts`, `src/lib/campaignWorker.ts`

`campaign.ts` manages state + message passing.
`campaignWorker.ts` runs in a Worker Thread, orchestrates scraping → fit analysis → insertion.

---

### Task 8 — API Routes

Create routes in `src/app/api/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/status` | GET | Campaign status + pending job count |
| `/api/usage` | GET | Today's API usage by model |
| `/api/job-status/[id]` | GET | Individual job status |
| `/api/campaign/start` | POST | Start new campaign |
| `/api/campaign/stop` | POST | Stop running campaign |
| `/api/apply/[id]` | POST | Submit application (async) |
| `/api/discard/[id]` | POST | Mark as discarded |
| `/api/bulk-discard` | POST | Bulk discard jobs |
| `/api/retailor/[id]` | POST | Tailor resume for specific job |
| `/api/download/[id]` | GET | Download tailored PDF |
| `/api/resume-text/[id]` | GET | Get resume markdown |
| `/api/linkedin-status` | GET | Check LinkedIn session state |
| `/api/linkedin-connect` | POST | Open LinkedIn login |
| `/api/retry-pending` | POST | Reprocess pending jobs |

All routes validate `isSetupComplete()` except `/setup`, `/settings`, `/api/linkedin/*`.

---

### Task 9 — React Server Components (Templates → TSX)

Convert each Jinja2 template to React Server Component:

- **`src/app/layout.tsx`** – Root layout, imports globals.css
- **`src/app/page.tsx`** (dashboard) – Server Component reading DB directly, client sub-components for polling/sorting/filtering
- **`src/app/review/[id]/page.tsx`** – Fit analysis + tailored resume panel
- **`src/app/application/[id]/page.tsx`** – Applied job detail
- **`src/app/settings/page.tsx`** – Configuration (name, email, phone, resume upload)
- **`src/app/setup/page.tsx`** – First-run setup flow

CSS class names stay identical — `globals.css` is copied verbatim.

---

### Task 10 — Setup guard middleware

**File:** `src/middleware.ts`

Redirects to `/setup` if `setup_complete` cookie not set. Allows `/setup`, `/settings`, `/api/linkedin`, `/_next`, `/favicon` to bypass.

---

### Task 11 — Phase 1 Verification

- [ ] Run `npm test` — all tests pass
- [ ] Run `npm run build` — Next.js build succeeds
- [ ] Run `npm run dev` — starts on http://localhost:3000
- [ ] Manual flow test:
  1. `/setup` → fill form, upload resume
  2. Dashboard → start campaign
  3. Job cards appear with fit scores
  4. Click job → review page
  5. Re-tailor → resume loads
  6. Apply/Discard work
  7. Settings saves/reloads

- [ ] Commit: `feat: Phase 1 complete — Next.js TypeScript feature parity`

---

## Phase 2 — Supabase + Multi-User

### Task 12 — Supabase project setup

```bash
npm install @supabase/supabase-js
```

In Supabase dashboard, create project and run SQL schema with `user_id` on all tables + Row-Level Security policies.

Add to `.env.local`:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SINGLE_USER_ID=user_doruk
```

---

### Task 13 — Swap db.ts to Supabase

Replace `better-sqlite3` with `@supabase/supabase-js`. All DB functions become async and gain `userId` parameter.

---

### Task 14 — Supabase Storage for resumes

**File:** `src/lib/storage.ts` (new)

Upload/download/sign resume files via Supabase Storage bucket.

---

### Task 15 — Per-user Chrome profiles

Update scraper.ts to use `userId`-specific profile paths.

---

### Task 16 — Phase 2 Verification

- [ ] Build succeeds, data persists in Supabase
- [ ] Resume uploads to Storage
- [ ] Download streams from Storage
- [ ] Chrome profiles isolated per-user
- [ ] Commit: `feat: Phase 2 complete — Supabase + multi-user ready`

---

## .env.local Template

```
# Phase 1 (SQLite)
JOBBOT_DB=./jobbot.db

# Phase 2 (Supabase — overrides JOBBOT_DB)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SINGLE_USER_ID=user_doruk

# LLM keys
GROQ_API_KEY=
OPENROUTER_API_KEY=
ANTHROPIC_API_KEY=

# Chrome profiles dir (default: ~/.jobbot-chrome/{userId})
CHROME_PROFILES_DIR=
```

---

## Summary

| Phase | Deliverable | Tests |
|---|---|---|
| 1 | Next.js 14+ TypeScript app, feature parity with Python | Vitest unit tests for all `src/lib/` modules |
| 2 | Supabase PostgreSQL + Storage + per-user Chrome profiles | Manual + existing E2E |

**Estimated effort:**
- Phase 1: 40-50 hours (TDD, all core libraries + routes + UI)
- Phase 2: 15-20 hours (DB swap, Storage, RLS setup)

---

## TDD Approach

All backend changes follow **RED → GREEN → REFACTOR**. Tests use Vitest + in-memory SQLite (Phase 1) or test database (Phase 2).

Test files:
- `tests/db.test.ts` — database queries
- `tests/resume.test.ts` — ATS scoring, keyword extraction, LLM parsing
- `tests/safety.test.ts` — stop signal detection
- `tests/scraper.test.ts` — URL builder, pure helpers (no browser tests)
- `tests/campaign.test.ts` — campaign state management

**Target coverage:** 80%+ on all new code.
