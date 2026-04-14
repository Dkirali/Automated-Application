# JobBot — Next.js + TypeScript Migration Plan (Phase 1 + 2)

> Save this file to `docs/superpowers/plans/server-deployment.md` as first step.

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

### Task 0 — Save this plan document

```bash
cp /Users/dkirali/.claude/plans/compiled-skipping-unicorn.md \
   /Users/dkirali/Desktop/Project/jobbot/docs/superpowers/plans/server-deployment.md
```

---

### Task 1 — Scaffold Next.js project

```bash
cd /Users/dkirali/Desktop/Project
npx create-next-app@latest jobbot-next \
  --typescript --app --src-dir --no-tailwind --eslint \
  --import-alias "@/*" --no-git
cd jobbot-next
npm install better-sqlite3 docx mammoth playwright @playwright/test vitest @vitejs/plugin-react
npm install -D @types/better-sqlite3 @types/node
npx playwright install chromium
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', globals: true }
})
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Copy CSS verbatim:
```bash
cp /Users/dkirali/Desktop/Project/jobbot/static/style.css \
   src/styles/globals.css
```

Update `src/app/layout.tsx` to import `'@/styles/globals.css'`.

Commit: `chore: scaffold jobbot-next Next.js 14 project`

---

### Task 2 — Port db.ts (TDD)

**File:** `src/lib/db.ts`, **Test:** `tests/lib/db.test.ts`

**Step 1 — Write failing tests:**

```typescript
// tests/lib/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

// We test against an in-memory db by patching the module
process.env.JOBBOT_DB = ':memory:'

import {
  initDb, getConfig, setConfig, isSetupComplete,
  createCampaign, getActiveCampaign, updateCampaignStatus,
  insertApplication, getApplication, updateApplication,
  insertManual, getManualQueue, getSeenUrls,
  getApiUsageToday, incrementApiUsage,
  getPendingJobs, getAllApplications, markApplied, getAllCampaigns
} from '@/lib/db'

beforeEach(() => { initDb() })

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
  it('returns false when name/email/phone/resume missing', () => {
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
  it('updateCampaignStatus sets status', () => {
    const id = createCampaign({ name: 'test', titles: 'PM', locations: 'Remote' })
    updateCampaignStatus(id, 'stopped')
    expect(getActiveCampaign()).toBeNull()
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
    const app = getApplication(id!)
    expect(app?.status).toBe('pending')
  })
  it('returns null for duplicate URL', () => {
    const cid = createCampaign({ name: 'c', titles: 'PM', locations: 'Remote' })
    insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/dup', jobDescription: '', easyApply: true })
    const id2 = insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/dup', jobDescription: '', easyApply: true })
    expect(id2).toBeNull()
  })
  it('updateApplication changes status', () => {
    const cid = createCampaign({ name: 'c', titles: 'PM', locations: 'Remote' })
    const id = insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/2', jobDescription: '', easyApply: true })
    updateApplication(id!, 'reviewed')
    expect(getApplication(id!)?.status).toBe('reviewed')
  })
  it('getSeenUrls returns all inserted urls', () => {
    const cid = createCampaign({ name: 'c', titles: 'PM', locations: 'Remote' })
    insertApplication({ campaignId: cid, company: 'A', title: 'PM',
      location: '', url: 'https://li.com/3', jobDescription: '', easyApply: true })
    expect(getSeenUrls().has('https://li.com/3')).toBe(true)
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

**Step 2 — Run, verify RED:** `npm test tests/lib/db.test.ts`

**Step 3 — Implement `src/lib/db.ts`:**

```typescript
import Database, { Database as DB } from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.JOBBOT_DB
  ?? path.join(process.cwd(), 'jobbot.db')

let _db: DB | null = null

export function getDb(): DB {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

export function initDb(): void {
  if (process.env.JOBBOT_DB === ':memory:') _db = null  // force fresh for tests
  const db = getDb()
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
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value)
}

export function isSetupComplete(): boolean {
  return ['name', 'email', 'phone', 'master_resume_path'].every(k => !!getConfig(k))
}

// ── Campaigns ────────────────────────────────────────────────────────────────

export interface CreateCampaignParams {
  name: string; titles: string; locations: string; preferredModel?: string
}

export function createCampaign(p: CreateCampaignParams): number {
  const result = getDb().prepare(
    'INSERT INTO campaigns (name, titles, locations, preferred_model) VALUES (?, ?, ?, ?)'
  ).run(p.name, p.titles, p.locations, p.preferredModel ?? 'auto')
  return result.lastInsertRowid as number
}

export function getActiveCampaign(): Record<string, unknown> | null {
  return (getDb().prepare("SELECT * FROM campaigns WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined) ?? null
}

export function updateCampaignStatus(id: number, status: string, stopReason?: string): void {
  getDb().prepare('UPDATE campaigns SET status = ?, stop_reason = ? WHERE id = ?')
    .run(status, stopReason ?? null, id)
}

export function getAllCampaigns(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM campaigns ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── Applications ─────────────────────────────────────────────────────────────

export interface InsertApplicationParams {
  campaignId: number; company: string; title: string; location: string
  url: string; jobDescription: string; easyApply: boolean
}

export function insertApplication(p: InsertApplicationParams): number | null {
  try {
    const result = getDb().prepare(
      `INSERT INTO applications (campaign_id, company, title, location, url,
       job_description, easy_apply) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(p.campaignId, p.company, p.title, p.location, p.url,
          p.jobDescription, p.easyApply ? 1 : 0)
    return result.lastInsertRowid as number
  } catch { return null }  // UNIQUE constraint on url
}

export function getApplication(id: number): Record<string, unknown> | null {
  return (getDb().prepare('SELECT * FROM applications WHERE id = ?').get(id) as Record<string, unknown> | undefined) ?? null
}

export function getSeenUrls(): Set<string> {
  const rows = getDb().prepare('SELECT url FROM applications UNION SELECT url FROM manual_queue').all() as { url: string }[]
  return new Set(rows.map(r => r.url))
}

export interface UpdateApplicationParams {
  atsScore?: number; originalAtsScore?: number; keywords?: string
  resumePath?: string; modelUsed?: string; fitSummary?: string; jdSummary?: string
}

export function updateApplication(id: number, status: string, extra: UpdateApplicationParams = {}): void {
  const sets: string[] = ['status = ?']
  const vals: unknown[] = [status]
  if (extra.atsScore !== undefined)         { sets.push('ats_score = ?');          vals.push(extra.atsScore) }
  if (extra.originalAtsScore !== undefined) { sets.push('original_ats_score = ?'); vals.push(extra.originalAtsScore) }
  if (extra.keywords !== undefined)         { sets.push('keywords = ?');            vals.push(extra.keywords) }
  if (extra.resumePath !== undefined)       { sets.push('resume_path = ?');         vals.push(extra.resumePath) }
  if (extra.modelUsed !== undefined)        { sets.push('model_used = ?');          vals.push(extra.modelUsed) }
  if (extra.fitSummary !== undefined)       { sets.push('fit_summary = ?');         vals.push(extra.fitSummary) }
  if (extra.jdSummary !== undefined)        { sets.push('jd_summary = ?');          vals.push(extra.jdSummary) }
  vals.push(id)
  getDb().prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function markApplied(id: number): void {
  getDb().prepare("UPDATE applications SET status = 'applied' WHERE id = ?").run(id)
}

export function getPendingJobs(): Record<string, unknown>[] {
  return getDb().prepare(
    "SELECT * FROM applications WHERE status IN ('pending','reviewed') ORDER BY id DESC"
  ).all() as Record<string, unknown>[]
}

export function getAllApplications(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM applications ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── Manual Queue ─────────────────────────────────────────────────────────────

export function insertManual(p: { campaignId: number; company: string; title: string; location: string; url: string; reason: string }): void {
  try {
    getDb().prepare(
      'INSERT INTO manual_queue (campaign_id, company, title, location, url, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(p.campaignId, p.company, p.title, p.location, p.url, p.reason)
  } catch { /* duplicate url */ }
}

export function getManualQueue(): Record<string, unknown>[] {
  return getDb().prepare('SELECT * FROM manual_queue ORDER BY id DESC').all() as Record<string, unknown>[]
}

// ── API Usage ────────────────────────────────────────────────────────────────

export function incrementApiUsage(modelKey: string): void {
  const today = new Date().toISOString().slice(0, 10)
  getDb().prepare(
    `INSERT INTO api_usage (model_key, call_date, call_count) VALUES (?, ?, 1)
     ON CONFLICT(model_key, call_date) DO UPDATE SET call_count = call_count + 1`
  ).run(modelKey, today)
}

export function getApiUsageToday(): Record<string, number> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = getDb().prepare(
    'SELECT model_key, call_count FROM api_usage WHERE call_date = ?'
  ).all(today) as { model_key: string; call_count: number }[]
  return Object.fromEntries(rows.map(r => [r.model_key, r.call_count]))
}
```

**Step 4 — Run, verify GREEN:** `npm test tests/lib/db.test.ts`

**Step 5 — Commit:** `feat: port db.ts with better-sqlite3 (TDD green)`

---

### Task 3 — Port safety.ts (TDD)

**File:** `src/lib/safety.ts`, **Test:** `tests/lib/safety.test.ts`

**Step 1 — Write failing tests:**

```typescript
// tests/lib/safety.test.ts
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

**Step 2 — Run, verify RED.**

**Step 3 — Implement `src/lib/safety.ts`:**

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
  if (CAPTCHA_PATTERNS.some(p => p.test(pageText)))    return StopSignal.CAPTCHA
  if (AUTH_PATTERNS.some(p => p.test(pageText)))        return StopSignal.AUTH_WALL
  if (RATE_LIMIT_PATTERNS.some(p => p.test(pageText))) return StopSignal.RATE_LIMIT
  return StopSignal.NONE
}

export async function checkPageForStopSignal(page: import('playwright').Page): Promise<StopSignal> {
  const text = await page.evaluate(() => document.body?.innerText ?? '')
  return classifyStopSignal(text)
}
```

**Step 4 — Run, verify GREEN.**

**Step 5 — Commit:** `feat: port safety.ts (TDD green)`

---

### Task 4 — Port resume.ts (TDD)

**File:** `src/lib/resume.ts`, **Test:** `tests/lib/resume.test.ts`

Key differences from Python:
- `python-docx` → `docx` npm package for DOCX generation
- `WeasyPrint` → Playwright `page.pdf()` for PDF export
- `anthropic` → `@anthropic-ai/sdk`
- `groq` Python → `groq` npm
- OpenRouter: `httpx.post` → `fetch`
- `threading.Lock` for rate limiter → `async` mutex via a promise queue

**Step 1 — Write failing tests (pure functions only — no LLM calls):**

```typescript
// tests/lib/resume.test.ts
import { describe, it, expect } from 'vitest'
import {
  extractKeywordsFromResponse, extractResumeFromResponse,
  calculateAtsScore, parseFitScore, parseFitField, matchesKeyword
} from '@/lib/resume'

describe('extractKeywordsFromResponse', () => {
  it('parses KEYWORDS line', () => {
    expect(extractKeywordsFromResponse('KEYWORDS: agile, product, roadmap\nRESUME:\nfoo'))
      .toEqual(['agile', 'product', 'roadmap'])
  })
  it('returns empty array if missing', () => {
    expect(extractKeywordsFromResponse('no keywords here')).toEqual([])
  })
})

describe('extractResumeFromResponse', () => {
  it('parses RESUME block', () => {
    const text = 'KEYWORDS: foo\nRESUME:\nPROFESSIONAL EXPERIENCE\n• Built stuff'
    expect(extractResumeFromResponse(text)).toContain('PROFESSIONAL EXPERIENCE')
  })
})

describe('calculateAtsScore', () => {
  it('returns 100 when all keywords present', () => {
    expect(calculateAtsScore(['agile', 'product'], 'We use agile product management')).toBe(100)
  })
  it('returns 0 for empty keywords', () => {
    expect(calculateAtsScore([], 'any text')).toBe(0)
  })
  it('uses whole-word match for short keywords', () => {
    // 'ai' should not match 'main'
    expect(calculateAtsScore(['ai'], 'domain main training')).toBe(0)
  })
})

describe('parseFitScore', () => {
  it('extracts fit score', () => {
    expect(parseFitScore('FIT_SCORE: 85\nSTRENGTHS: foo')).toBe(85)
  })
  it('returns 0 if missing', () => {
    expect(parseFitScore('no score here')).toBe(0)
  })
})

describe('parseFitField', () => {
  it('extracts named field', () => {
    expect(parseFitField('VERDICT: Strong candidate', 'VERDICT')).toBe('Strong candidate')
  })
})
```

**Step 2 — Run, verify RED.**

**Step 3 — Implement `src/lib/resume.ts`** (pure functions first, then LLM wiring):

```typescript
import fs from 'fs'
import path from 'path'
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx'
import { incrementApiUsage } from '@/lib/db'

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function matchesKeyword(kw: string, text: string): boolean {
  const kwLower = kw.toLowerCase()
  const textLower = text.toLowerCase()
  if (kwLower.length <= 4) {
    return new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(textLower)
  }
  return textLower.includes(kwLower)
}

export function extractKeywordsFromResponse(text: string): string[] {
  const m = text.match(/KEYWORDS:\s*([^\n]+)/)
  if (!m) return []
  return m[1].split(',').map(k => k.trim()).filter(Boolean)
}

export function extractResumeFromResponse(text: string): string {
  const m = text.match(/RESUME:\s*\n([\s\S]*)/)
  return m ? m[1].trim() : ''
}

export function calculateAtsScore(keywords: string[], resumeText: string): number {
  if (!keywords.length) return 0
  const matched = keywords.filter(kw => matchesKeyword(kw, resumeText)).length
  return Math.round((matched / keywords.length) * 100)
}

export function parseFitScore(text: string): number {
  const m = text.match(/FIT_SCORE:\s*(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

export function parseFitField(text: string, field: string): string {
  const m = text.match(new RegExp(`${field}:\\s*([^\\n]+)`))
  return m ? m[1].trim() : ''
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^>\s*/gm, '')
}

// ── Resume text reader ────────────────────────────────────────────────────────

export async function readResumeText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.docx' || ext === '.doc') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value.trim()
  }
  throw new Error(`Unsupported resume format: ${ext}`)
}

// ── DOCX writer ───────────────────────────────────────────────────────────────

export async function writeTailoredDocx(newText: string, outputPath: string): Promise<void> {
  const SECTION_KEYWORDS = new Set([
    'professional experience', 'experience', 'education', 'skills',
    'about', 'summary', 'projects', 'certifications', 'certificates',
  ])
  const lines = newText.split('\n')
  const paragraphs: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: 'Doruk Kirali', bold: true, size: 36 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: 'Product Operations Manager', bold: true, size: 24 })], alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: '0532 286 04 61 • kiralidoruk@gmail.com • linkedin.com/in/doruk-kirali', size: 18 })], alignment: AlignmentType.CENTER }),
  ]
  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped) continue
    const low = stripped.toLowerCase()
    if (SECTION_KEYWORDS.has(low.replace(/:$/, ''))) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: stripped.toUpperCase(), bold: true })], thematicBreak: true }))
    } else if (stripped.startsWith('•') || stripped.startsWith('-')) {
      paragraphs.push(new Paragraph({ children: [new TextRun(stripped.slice(1).trim())], bullet: { level: 0 } }))
    } else {
      paragraphs.push(new Paragraph({ children: [new TextRun(stripped)] }))
    }
  }
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const buffer = await Packer.toBuffer(doc)
  fs.writeFileSync(outputPath, buffer)
}

// ── PDF export ────────────────────────────────────────────────────────────────

export async function exportPdf(docxPath: string, pdfPath: string): Promise<void> {
  const mammoth = await import('mammoth')
  const { value: html } = await mammoth.convertToHtml({ path: docxPath })
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`<html><body style="font-family:sans-serif;padding:40px">${html}</body></html>`)
  await page.pdf({ path: pdfPath, format: 'A4' })
  await browser.close()
}

// ── LLM rate limiter (promise queue) ─────────────────────────────────────────

const LLM_MIN_INTERVAL_MS = 4000
let _lastCallTime = 0

async function waitRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - _lastCallTime
  if (elapsed < LLM_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, LLM_MIN_INTERVAL_MS - elapsed))
  }
  _lastCallTime = Date.now()
}

// ── Available models ──────────────────────────────────────────────────────────

export const AVAILABLE_MODELS: Record<string, string> = {
  'auto':                       'Auto (best available)',
  'groq/llama-3.3-70b':        'Groq — Llama 3.3 70B',
  'openrouter/gpt-oss-120b':   'OpenRouter — GPT-OSS 120B',
  'openrouter/minimax-m2.5':   'OpenRouter — MiniMax M2.5',
  'openrouter/free':            'OpenRouter — Best Free',
  'anthropic/claude-sonnet':   'Anthropic — Claude Sonnet',
}

let _lastModelUsed = '—'
export function getLastModelUsed(): string { return _lastModelUsed }

async function callProvider(name: string, fn: () => Promise<string>): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fn() }
    catch (e: unknown) {
      const msg = String(e).toLowerCase()
      if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) return null
      if (attempt === 2) { console.warn(`${name} failed after 3 attempts:`, e); return null }
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)))
    }
  }
  return null
}

export async function callLlm(prompt: string, maxTokens = 2048, preferredModel = 'auto'): Promise<string> {
  await waitRateLimit()

  const groqKey = process.env.GROQ_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  const callGroq = async (): Promise<string> => {
    const { Groq } = await import('groq')
    const client = new Groq({ apiKey: groqKey })
    const msg = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile', max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return msg.choices[0].message.content!
  }

  const callOpenRouter = (model: string) => async (): Promise<string> => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${orKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const data = await res.json() as { choices: { message: { content: string } }[] }
    return data.choices[0].message.content
  }

  const callAnthropic = async (): Promise<string> => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: anthropicKey })
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return (msg.content[0] as { text: string }).text
  }

  type ProviderEntry = [string, () => Promise<string>, string | undefined, string]
  const MODEL_MAP: Record<string, ProviderEntry> = {
    'groq/llama-3.3-70b':     ['Groq/Llama-3.3-70B',          callGroq,                           groqKey,       'groq/llama-3.3-70b'],
    'openrouter/gpt-oss-120b': ['OpenRouter/gpt-oss-120b:free', callOpenRouter('openai/gpt-oss-120b:free'), orKey, 'openrouter/gpt-oss-120b'],
    'openrouter/minimax-m2.5': ['OpenRouter/minimax-m2.5:free', callOpenRouter('minimax/minimax-m2.5:free'), orKey, 'openrouter/minimax-m2.5'],
    'openrouter/free':         ['OpenRouter/free',              callOpenRouter('openrouter/auto:free'), orKey,      'openrouter/free'],
    'anthropic/claude-sonnet': ['Anthropic/Claude-Sonnet',      callAnthropic,                      anthropicKey,  'anthropic/claude-sonnet'],
  }

  if (preferredModel !== 'auto') {
    const entry = MODEL_MAP[preferredModel]
    if (entry) {
      const [label, fn, key, usageKey] = entry
      if (key) {
        const result = await callProvider(label, fn)
        if (result) { _lastModelUsed = label; incrementApiUsage(usageKey); return result }
      }
      throw new Error(`Model ${preferredModel} failed`)
    }
  }

  // Auto cascade
  const cascade: ProviderEntry[] = [
    MODEL_MAP['groq/llama-3.3-70b'],
    MODEL_MAP['openrouter/gpt-oss-120b'],
    MODEL_MAP['openrouter/minimax-m2.5'],
    MODEL_MAP['openrouter/free'],
    MODEL_MAP['anthropic/claude-sonnet'],
  ]
  for (const [label, fn, key, usageKey] of cascade) {
    if (!key) continue
    const result = await callProvider(label, fn)
    if (result) { _lastModelUsed = label; incrementApiUsage(usageKey); return result }
  }
  throw new Error('All LLM providers failed — check API keys in Settings')
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const FIT_PROMPT = `You are a senior recruiter evaluating a candidate's fit for a role.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Respond in this exact format (no extra text):
FIT_SCORE: <0-100>
STRENGTHS: <comma-separated list of 2-4 matching skills or experiences>
GAPS: <comma-separated list of 1-3 missing skills, or "None">
VERDICT: <one sentence — would you recommend applying? why?>
JD_SUMMARY: <2-3 sentence summary of the role, seniority level, and key focus areas>
JD_KEYWORDS: keyword1, keyword2, keyword3, ... <8-12 most important ATS/skills keywords from the job posting>`

const TAILOR_PROMPT = `You are an expert resume writer specialising in ATS optimisation.

Job Posting:
{job_description}

Current Resume:
{resume_text}

Task:
1. Extract the 8-12 most important ATS keywords from the job posting.
2. Rewrite experience bullets to incorporate these keywords naturally.
   CRITICAL: Never append keyword labels. Describe actual work.
3. Do NOT invent experience.
4. Format as plain text with ALL CAPS section headings.
5. Do NOT include candidate name/contact info.

Respond in this exact format:
KEYWORDS: keyword1, keyword2, ...
RESUME:
[Full rewritten resume]`

// ── Main functions ────────────────────────────────────────────────────────────

export async function tailorResume(params: {
  jobId: number; jobDescription: string; masterResumePath: string
  existingKeywords?: string[]; preferredModel?: string
}): Promise<{
  keywords: string[]; keywordsStr: string; atsScore: number; originalAtsScore: number
  tailoredText: string; docxPath: string; pdfPath: string | null; modelUsed: string
}> {
  const resumeText = await readResumeText(params.masterResumePath)
  const response = await callLlm(
    TAILOR_PROMPT.replace('{job_description}', params.jobDescription).replace('{resume_text}', resumeText),
    2048, params.preferredModel ?? 'auto'
  )
  const keywords = params.existingKeywords ?? extractKeywordsFromResponse(response)
  const tailoredText = extractResumeFromResponse(response) || resumeText
  const atsScore = calculateAtsScore(keywords, tailoredText)
  const originalText = await readResumeText(params.masterResumePath)
  const originalAtsScore = calculateAtsScore(keywords, originalText)

  const jobDir = path.join(process.cwd(), 'resumes', String(params.jobId))
  fs.mkdirSync(jobDir, { recursive: true })
  const docxPath = path.join(jobDir, 'tailored.docx')
  const pdfPath = path.join(jobDir, 'tailored.pdf')

  await writeTailoredDocx(stripMarkdown(tailoredText), docxPath)
  let finalPdfPath: string | null = pdfPath
  try { await exportPdf(docxPath, pdfPath) }
  catch { finalPdfPath = null }

  return { keywords, keywordsStr: keywords.join(', '), atsScore, originalAtsScore,
           tailoredText, docxPath, pdfPath: finalPdfPath, modelUsed: getLastModelUsed() }
}

export async function generateFitSummary(jobDescription: string, masterResumePath: string): Promise<{
  fitScore: number; strengths: string[]; gaps: string[]
  verdict: string; jdSummary: string; jdKeywords: string; raw: string
}> {
  const resumeText = await readResumeText(masterResumePath)
  const raw = await callLlm(
    FIT_PROMPT.replace('{job_description}', jobDescription.slice(0, 4000))
              .replace('{resume_text}', resumeText.slice(0, 3000)),
    512
  )
  return {
    fitScore:   parseFitScore(raw),
    strengths:  parseFitField(raw, 'STRENGTHS').split(',').map(s => s.trim()).filter(Boolean),
    gaps:       parseFitField(raw, 'GAPS').split(',').map(g => g.trim()).filter(Boolean),
    verdict:    parseFitField(raw, 'VERDICT'),
    jdSummary:  parseFitField(raw, 'JD_SUMMARY'),
    jdKeywords: parseFitField(raw, 'JD_KEYWORDS'),
    raw,
  }
}
```

**Step 4 — Run, verify GREEN:** `npm test tests/lib/resume.test.ts`

**Step 5 — Commit:** `feat: port resume.ts (TDD green)`

---

### Task 5 — Port scraper.ts (TDD)

**File:** `src/lib/scraper.ts`, **Test:** `tests/lib/scraper.test.ts`

Note: Playwright calls cannot be unit-tested without a real browser. Tests cover pure helper functions only.

**Step 1 — Write failing tests:**

```typescript
// tests/lib/scraper.test.ts
import { describe, it, expect } from 'vitest'
import { buildSearchUrl } from '@/lib/scraper'

describe('buildSearchUrl', () => {
  it('builds basic URL with titles and location', () => {
    const url = buildSearchUrl(['Product Manager', 'PM'], { location_text: 'London' })
    expect(url).toContain('keywords=Product+Manager+OR+PM')
    expect(url).toContain('location=London')
  })
  it('includes work type filter', () => {
    const url = buildSearchUrl(['PM'], { location_text: '', work_types: ['2'] })
    expect(url).toContain('f_WT=2')
  })
  it('includes date posted filter', () => {
    const url = buildSearchUrl(['PM'], { location_text: '', date_posted: 'r604800' })
    expect(url).toContain('f_TPR=r604800')
  })
  it('includes start offset for pagination', () => {
    const url = buildSearchUrl(['PM'], { location_text: '' }, 25)
    expect(url).toContain('start=25')
  })
})
```

**Step 2 — Run, verify RED.**

**Step 3 — Implement `src/lib/scraper.ts`:**

```typescript
import { chromium, BrowserContext } from 'playwright'
import path from 'path'
import { checkPageForStopSignal, StopSignal } from '@/lib/safety'

const LINKEDIN_JOBS_URL = 'https://www.linkedin.com/jobs/search/'

function getProfileDir(userId?: string): string {
  const base = process.env.CHROME_PROFILES_DIR ?? path.join(process.env.HOME!, '.jobbot-chrome')
  return userId ? path.join(base, userId) : base
}

export function buildSearchUrl(titles: string[], filters: {
  location_text?: string; work_types?: string[]; experience_levels?: string[]; date_posted?: string
}, start = 0): string {
  const params = new URLSearchParams()
  params.set('keywords', titles.join(' OR '))
  if (filters.location_text) params.set('location', filters.location_text)
  if (filters.work_types?.length)      params.set('f_WT', filters.work_types.join(','))
  if (filters.experience_levels?.length) params.set('f_E', filters.experience_levels.join(','))
  if (filters.date_posted)             params.set('f_TPR', filters.date_posted)
  if (start > 0)                        params.set('start', String(start))
  return `${LINKEDIN_JOBS_URL}?${params.toString()}`
}

async function getBrowserContext(userId?: string): Promise<BrowserContext> {
  const profileDir = getProfileDir(userId)
  require('fs').mkdirSync(profileDir, { recursive: true })
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  })
}

export async function scrapeJobs(params: {
  titles: string[]; filters: Record<string, unknown>; seenUrls: Set<string>
  stopSignal: { stopped: boolean }; userId?: string
  onStatus?: (msg: string) => void; onJob?: (job: Record<string, unknown>) => Promise<void>
}): Promise<void> {
  const { titles, filters, seenUrls, stopSignal, userId, onStatus, onJob } = params
  const update = (msg: string) => onStatus?.(msg)

  const context = await getBrowserContext(userId)
  try {
    const page = await context.newPage()
    let pageStart = 0
    const PAGE_SIZE = 25
    let consecutiveEmpty = 0

    while (!stopSignal.stopped) {
      const url = buildSearchUrl(titles, filters as Parameters<typeof buildSearchUrl>[1], pageStart)
      const pageNum = (pageStart / PAGE_SIZE) + 1
      update(`Opening LinkedIn page ${pageNum}…`)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)

      const signal = await checkPageForStopSignal(page)
      if (signal !== StopSignal.NONE) {
        update(`Stop signal detected: ${signal}`)
        break
      }

      // Scroll to load cards
      for (let i = 0; i < 8 && !stopSignal.stopped; i++) {
        const before = await page.locator('.job-card-container').count()
        await page.evaluate(() => {
          const card = document.querySelector('.job-card-container')
          if (!card) return
          let el: Element | null = card.parentElement
          while (el) {
            if ((el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 50) {
              (el as HTMLElement).scrollBy(0, 1200); return
            }
            el = el.parentElement
          }
        })
        await page.waitForTimeout(1500)
        if (await page.locator('.job-card-container').count() === before) break
      }

      const cardSelectors = ['.job-card-container', 'li.jobs-search-results__list-item', '.base-search-card']
      let cards: import('playwright').Locator[] = []
      for (const sel of cardSelectors) {
        const found = await page.locator(sel).all()
        if (found.length) { cards = found; break }
      }

      if (!cards.length) { if (pageStart === 0) break; consecutiveEmpty++; if (consecutiveEmpty >= 2) break; pageStart += PAGE_SIZE; continue }

      let newOnPage = 0
      for (const card of cards) {
        if (stopSignal.stopped) break
        let url: string | undefined
        try {
          const href = await card.locator('a[href*="/jobs/view/"]').first().getAttribute('href') ?? ''
          url = href.startsWith('/') ? `https://www.linkedin.com${href.split('?')[0]}` : href.split('?')[0]
        } catch { continue }
        if (!url || seenUrls.has(url)) continue

        const title   = await card.locator('h3, .job-card-list__title').first().innerText().then(t => t.split('\n')[0].trim()).catch(() => '')
        const company = await card.locator('h4, .artdeco-entity-lockup__subtitle').first().innerText().then(t => t.split('\n')[0].trim()).catch(() => '')
        const location = await card.locator('.job-card-container__metadata-item, .job-search-card__location').first().innerText().catch(() => '')

        try { await card.scrollIntoViewIfNeeded(); await card.click(); await page.waitForTimeout(2000) } catch { continue }

        const easyApply = await page.locator("button:has-text('Easy Apply')").count() > 0
        const jobDescription = await page.locator('.jobs-description__content, #job-details').first().innerText().catch(() => '')

        const job = { title, company, location, url, easyApply, jobDescription }
        seenUrls.add(url)
        newOnPage++
        if (onJob) await onJob(job)
        await page.waitForTimeout(3000 + Math.random() * 2000)
      }

      consecutiveEmpty = newOnPage === 0 ? consecutiveEmpty + 1 : 0
      if (consecutiveEmpty >= 2) break
      pageStart += PAGE_SIZE
      await page.waitForTimeout(2000 + Math.random() * 2000)
    }
  } finally { await context.close() }
}

export async function isLinkedInConnected(userId?: string): Promise<boolean> {
  const cookieFile = path.join(getProfileDir(userId), 'Default', 'Cookies')
  return require('fs').existsSync(cookieFile)
}

export async function openLinkedInBrowser(userId?: string): Promise<void> {
  const context = await getBrowserContext(userId)
  const page = await context.newPage()
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' })
  await new Promise(r => page.on('close', r))
  await context.close()
}
```

**Step 4 — Run, verify GREEN:** `npm test tests/lib/scraper.test.ts`

**Step 5 — Commit:** `feat: port scraper.ts (TDD green)`

---

### Task 6 — Port submitter.ts (TDD)

**File:** `src/lib/submitter.ts`, **Test:** `tests/lib/submitter.test.ts`

Tests cover only non-browser logic.

**Step 1 — Write failing test:**

```typescript
// tests/lib/submitter.test.ts
import { describe, it, expect } from 'vitest'
// Submitter is all Playwright — just verify the module exports what we expect
import { submitApplication } from '@/lib/submitter'

describe('submitApplication', () => {
  it('exports submitApplication function', () => {
    expect(typeof submitApplication).toBe('function')
  })
})
```

**Step 2 — Run, verify RED.**

**Step 3 — Implement `src/lib/submitter.ts`:**

```typescript
import { Page } from 'playwright'
import { scrapeJobs } from '@/lib/scraper'
import fs from 'fs'

async function fillVisibleFields(page: Page, phone: string, pdfPath: string): Promise<void> {
  for (const label of ['Phone', 'Mobile phone number']) {
    try {
      const field = page.getByLabel(label, { exact: true })
      if (await field.count() > 0 && await field.first().isVisible()) {
        await field.first().fill(phone)
      }
    } catch { /* ignore */ }
  }
  const upload = page.locator("input[type='file']")
  if (pdfPath && await upload.count() > 0 && fs.existsSync(pdfPath)) {
    try { await upload.first().setInputFiles(pdfPath) } catch { /* ignore */ }
  }
}

async function fillEasyApply(page: Page, phone: string, pdfPath: string): Promise<boolean> {
  try { await page.waitForSelector('.jobs-easy-apply-modal', { timeout: 10000 }) }
  catch { return false }

  for (let step = 0; step < 10; step++) {
    await fillVisibleFields(page, phone, pdfPath)
    const submit = page.locator("button[aria-label='Submit application']")
    const next   = page.locator("button[aria-label='Continue to next step']")
    if (await submit.count() > 0) { await submit.click(); await page.waitForTimeout(2000); return true }
    if (await next.count() > 0)   { await next.click(); await page.waitForTimeout(1500) }
    else break
  }
  return false
}

export async function submitApplication(params: {
  jobUrl: string; pdfPath: string; name: string; email: string; phone: string; userId?: string
}): Promise<boolean> {
  const { chromium } = await import('playwright')
  const profileDir = require('path').join(process.env.HOME!, '.jobbot-chrome')
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, channel: 'chrome' })
  try {
    const page = await context.newPage()
    await page.goto(params.jobUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const notNow = page.locator("button[aria-label='Not now']")
    if (await notNow.count() > 0) { await notNow.click(); await page.waitForTimeout(1000) }
    const applyBtn = page.locator("[aria-label*='Easy Apply']")
    if (await applyBtn.count() === 0) return false
    await applyBtn.first().click()
    await page.waitForTimeout(2000)
    return fillEasyApply(page, params.phone, params.pdfPath)
  } finally { await context.close() }
}
```

**Step 4 — Run, verify GREEN.**

**Step 5 — Commit:** `feat: port submitter.ts (TDD green)`

---

### Task 7 — Port campaign runner (worker_threads)

**Files:** `src/lib/campaign.ts`, `src/lib/campaignWorker.ts`

No unit tests for worker itself (integration only). Test the state interface.

```typescript
// src/lib/campaign.ts
import { Worker } from 'worker_threads'
import path from 'path'

interface CampaignState {
  status: string
  alert: string | null
}

const _state: CampaignState = { status: 'Idle', alert: null }
let _worker: Worker | null = null

export function getCampaignStatus(): string { return _state.status }
export function getCampaignAlert(): string | null { return _state.alert }
export function clearAlert(): void { _state.alert = null }

export function startCampaign(campaignId: number, titles: string[], filters: Record<string, unknown>): void {
  if (_worker) return  // already running
  _worker = new Worker(path.join(__dirname, 'campaignWorker.js'), {
    workerData: { campaignId, titles, filters }
  })
  _worker.on('message', (msg: { type: string; payload: string }) => {
    if (msg.type === 'status') _state.status = msg.payload
    if (msg.type === 'alert')  _state.alert  = msg.payload
    if (msg.type === 'done')   { _state.status = 'Idle'; _worker = null }
  })
  _worker.on('error', err => { console.error('Campaign worker error:', err); _state.status = 'Idle'; _worker = null })
}

export function stopCampaign(): void {
  _worker?.terminate()
  _worker = null
  _state.status = 'Idle'
}
```

```typescript
// src/lib/campaignWorker.ts
import { workerData, parentPort } from 'worker_threads'
import { scrapeJobs } from './scraper'
import { insertApplication, insertManual, getConfig, getSeenUrls, updateApplication, getActiveCampaign, updateCampaignStatus } from './db'
import { generateFitSummary } from './resume'

const { campaignId, titles, filters } = workerData as { campaignId: number; titles: string[]; filters: Record<string, unknown> }

const stopSignal = { stopped: false }

function post(type: string, payload: string): void {
  parentPort?.postMessage({ type, payload })
}

async function run(): Promise<void> {
  const seenUrls = getSeenUrls()
  let totalFound = 0

  while (!stopSignal.stopped) {
    post('status', `Scraping LinkedIn for: ${titles.join(', ')}…`)
    let jobsFound = 0
    const masterPath = getConfig('master_resume_path')

    await scrapeJobs({
      titles, filters: filters as Parameters<typeof scrapeJobs>[0]['filters'],
      seenUrls, stopSignal,
      onStatus: msg => post('status', msg),
      onJob: async (job) => {
        if (!job.easyApply) {
          insertManual({ campaignId, company: String(job.company ?? 'Unknown'),
            title: String(job.title ?? 'Unknown'), location: String(job.location ?? ''),
            url: String(job.url), reason: 'not_easy_apply' })
          return
        }
        const appId = insertApplication({
          campaignId, company: String(job.company ?? 'Unknown'),
          title: String(job.title ?? 'Unknown'), location: String(job.location ?? ''),
          url: String(job.url), jobDescription: String(job.jobDescription ?? ''), easyApply: true
        })
        if (!appId) return
        jobsFound++
        post('status', `[${jobsFound} found] ${job.title} at ${job.company} — awaiting manual tailor`)

        if (masterPath && job.jobDescription) {
          try {
            const fit = await generateFitSummary(String(job.jobDescription), masterPath)
            updateApplication(appId, 'pending', { fitSummary: fit.raw, jdSummary: fit.jdSummary })
          } catch (e) { console.warn(`Fit summary failed for app ${appId}:`, e) }
        }
      }
    })

    totalFound += jobsFound
    if (!jobsFound) {
      post('status', `All pages scraped, ${totalFound} total — re-scanning in 5m`)
      await new Promise(r => setTimeout(r, 300_000))
    } else {
      post('alert', `Added ${jobsFound} job(s) – review them in the dashboard`)
      post('status', `Done: ${jobsFound} new, ${totalFound} total — next scan in 5m`)
      await new Promise(r => setTimeout(r, 300_000))
    }
  }

  const campaign = getActiveCampaign()
  if (campaign && campaign['status'] === 'running') updateCampaignStatus(Number(campaign['id']), 'stopped')
  post('done', 'Campaign finished')
}

run().catch(e => { post('status', `Error: ${e}`); process.exit(1) })
```

Commit: `feat: campaign runner using worker_threads`

---

### Task 8 — API Routes

All routes live in `src/app/api/`. Pattern:

```typescript
// src/app/api/status/route.ts
import { NextResponse } from 'next/server'
import { getPendingJobs } from '@/lib/db'
import { getCampaignStatus } from '@/lib/campaign'

export async function GET() {
  const pending = getPendingJobs()
  return NextResponse.json({ status: getCampaignStatus(), pending_count: pending.length })
}
```

Create one route file per endpoint:

| File | Method | Python equivalent |
|---|---|---|
| `api/status/route.ts` | GET | `GET /status` |
| `api/usage/route.ts` | GET | `GET /api/usage` |
| `api/job-status/[id]/route.ts` | GET | `GET /api/job-status/:id` |
| `api/campaign/start/route.ts` | POST | `POST /campaign/start` |
| `api/campaign/stop/route.ts` | POST | `POST /campaign/stop` |
| `api/apply/[id]/route.ts` | POST | `POST /apply/:id` |
| `api/discard/[id]/route.ts` | POST | `POST /discard/:id` |
| `api/bulk-discard/route.ts` | POST | `POST /bulk-discard` |
| `api/retailor/[id]/route.ts` | POST | `POST /retailor/:id` |
| `api/download/[id]/route.ts` | GET | `GET /download/:id` |
| `api/resume-text/[id]/route.ts` | GET | `GET /resume-text/:id` |
| `api/linkedin-status/route.ts` | GET | `GET /linkedin-status` |
| `api/linkedin-connect/route.ts` | POST | `POST /linkedin-connect` |
| `api/retry-pending/route.ts` | POST | `POST /retry-pending` |

Key implementation notes:
- `campaign/start`: accepts FormData, calls `startCampaign()`, returns redirect
- `apply/[id]`: calls `submitApplication()` in background, returns immediately
- `retailor/[id]`: kicks off `tailorResume()` in background (no worker needed — just async)
- `download/[id]`: streams file with correct Content-Disposition header
- All routes check `isSetupComplete()` except setup/settings

Commit: `feat: all API routes wired up`

---

### Task 9 — React Server Components (Templates → TSX)

Convert each Jinja2 template to a React Server Component. Jinja2 → TSX mapping is mechanical:

| Jinja2 | TSX |
|---|---|
| `{% for x in list %}` | `{list.map(x => ...)}` |
| `{% if cond %}...{% endif %}` | `{cond && ...}` |
| `{{ var }}` | `{var}` |
| `{% set x = v %}` | `const x = v` in component body |
| `{% include %}` | import component |

**`src/app/layout.tsx`** — root layout, imports globals.css, sets charset/viewport

**`src/app/page.tsx`** (dashboard) — calls `getPendingJobs()`, `getAllApplications()`, `getActiveCampaign()`, etc. directly (Server Component). Interactive JS (polling, sort/filter, bulk select, fit modal) extracted to `'use client'` sub-components:
- `src/components/CampaignForm.tsx` (form with model selector)
- `src/components/PendingJobsGrid.tsx` (sort/filter/bulk select client logic)
- `src/components/StatusPoller.tsx` (setInterval polling)

**`src/app/review/[id]/page.tsx`** — reads job from DB, renders fit bar, ATS rings. Resume panel JS (markdown renderer, keyword highlighter, count-up animation) → `src/components/ResumePanel.tsx` ('use client')

**`src/app/application/[id]/page.tsx`** — same resume panel, no re-tailor form

**`src/app/settings/page.tsx`** — Server Component that handles POST via server action or API route

**`src/app/setup/page.tsx`** — same pattern

CSS class names stay identical — `globals.css` is copied verbatim, all class names work.

Commit: `feat: port all Jinja2 templates to React Server Components`

---

### Task 10 — Setup guard middleware

```typescript
// src/middleware.ts
import { NextResponse, NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const bypass = ['/setup', '/settings', '/api/linkedin', '/_next', '/favicon']
  if (bypass.some(p => req.nextUrl.pathname.startsWith(p))) return NextResponse.next()
  // Check setup cookie (set by settings/setup page server action)
  const setupDone = req.cookies.get('setup_complete')?.value === '1'
  if (!setupDone) return NextResponse.redirect(new URL('/setup', req.url))
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next|favicon).*)'] }
```

Commit: `feat: setup guard middleware`

---

### Task 11 — Phase 1 verification

```bash
cd /Users/dkirali/Desktop/Project/jobbot-next
npm test                      # all unit tests pass
npm run build                 # Next.js build succeeds
npm run dev                   # starts on http://localhost:3000
```

Manual checks:
1. `/setup` — fill form, upload resume, save
2. Dashboard loads with correct cyberpunk styles
3. Start campaign → status updates via polling
4. Job cards appear with fit scores
5. Click job card → review page with ATS rings
6. Re-tailor → spinner shows → resume loads
7. Apply / Discard work
8. Settings saves and reloads

Commit: `feat: Phase 1 complete — Next.js TypeScript feature parity`

---

## Phase 2 — Supabase + Multi-User

### Task 12 — Supabase project setup

```bash
npm install @supabase/supabase-js
```

In Supabase dashboard:
1. Create project `jobbot`
2. Run the SQL below in the SQL editor

```sql
-- Schema (mirrors SQLite schema + user_id)
CREATE TABLE config (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE campaigns (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  titles TEXT NOT NULL,
  locations TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  stop_reason TEXT,
  preferred_model TEXT DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE applications (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id BIGINT NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  url TEXT NOT NULL,
  job_description TEXT,
  easy_apply BOOLEAN DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending',
  ats_score INTEGER,
  original_ats_score INTEGER,
  keywords TEXT,
  resume_path TEXT,
  model_used TEXT,
  fit_summary TEXT,
  jd_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, url)
);

CREATE TABLE manual_queue (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  campaign_id BIGINT,
  company TEXT,
  title TEXT,
  location TEXT,
  url TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, url)
);

CREATE TABLE api_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  call_date DATE NOT NULL,
  call_count INTEGER DEFAULT 0,
  UNIQUE(user_id, model_key, call_date)
);

-- Row Level Security
ALTER TABLE config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage    ENABLE ROW LEVEL SECURITY;

-- RLS policies (Phase 2 uses service role key — policies enforce app-level user_id match)
CREATE POLICY "users own data" ON config       USING (user_id = current_setting('app.user_id'));
CREATE POLICY "users own data" ON campaigns    USING (user_id = current_setting('app.user_id'));
CREATE POLICY "users own data" ON applications USING (user_id = current_setting('app.user_id'));
CREATE POLICY "users own data" ON manual_queue USING (user_id = current_setting('app.user_id'));
CREATE POLICY "users own data" ON api_usage    USING (user_id = current_setting('app.user_id'));
```

Add to `.env.local`:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SINGLE_USER_ID=user_doruk
```

---

### Task 13 — Swap db.ts to Supabase

**File:** `src/lib/db.ts` — replace `better-sqlite3` with `@supabase/supabase-js`.

Every function gains a `userId` parameter (defaults to `process.env.SINGLE_USER_ID`).

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function userId(): string {
  return process.env.SINGLE_USER_ID ?? 'default'
}

export async function getConfig(key: string, uid = userId()): Promise<string | null> {
  const { data } = await supabase.from('config')
    .select('value').eq('user_id', uid).eq('key', key).single()
  return data?.value ?? null
}

export async function setConfig(key: string, value: string, uid = userId()): Promise<void> {
  await supabase.from('config').upsert({ user_id: uid, key, value })
}

// ... (all functions become async, add uid param, use supabase.from() queries)
```

All callers (API routes, campaign worker) become async — update accordingly.

Commit: `feat: swap db.ts to Supabase (Phase 2)`

---

### Task 14 — Supabase Storage for resumes

**File:** `src/lib/storage.ts` (new)

```typescript
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function uploadResume(localPath: string, storagePath: string): Promise<string> {
  const buffer = fs.readFileSync(localPath)
  const { error } = await supabase.storage.from('resumes').upload(storagePath, buffer, { upsert: true })
  if (error) throw error
  return storagePath
}

export async function downloadResume(storagePath: string, localPath: string): Promise<void> {
  const { data, error } = await supabase.storage.from('resumes').download(storagePath)
  if (error || !data) throw error
  fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()))
}

export async function getResumeSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('resumes').createSignedUrl(storagePath, 3600)
  if (error || !data) throw error
  return data.signedUrl
}
```

Storage paths:
- Master resume: `resumes/{userId}/master.docx`
- Tailored: `resumes/{userId}/tailored/{appId}.docx` and `.pdf`

Update `settings` route: upload master resume to Supabase Storage after saving.
Update `download/[id]` route: stream from Supabase Storage signed URL.
Update `resume-text/[id]` route: download to temp file, extract text, delete temp.

Commit: `feat: Supabase Storage for resume files`

---

### Task 15 — Per-user Chrome profiles

**File:** `src/lib/scraper.ts` — already written to support `userId` param.

In `campaignWorker.ts`, pass `userId: workerData.userId` to `scrapeJobs`.

In `campaign.ts`, pass `userId` from `workerData`.

API routes pass `userId = process.env.SINGLE_USER_ID` to all campaign/scraper calls.

Chrome profile path: `/data/chrome-profiles/{userId}` on Hetzner (set via `CHROME_PROFILES_DIR` env var). Locally uses `~/.jobbot-chrome/{userId}`.

Commit: `feat: per-user Chrome profiles`

---

### Task 16 — Phase 2 verification

```bash
npm run build
npm run dev
```

Manual checks:
1. All Phase 1 features still work
2. Data persists in Supabase (check Supabase dashboard)
3. Resume uploaded to Supabase Storage on setup
4. Download streams from Storage
5. Chrome profile created per-user in correct directory
6. `SINGLE_USER_ID` env var drives all user isolation

Commit: `feat: Phase 2 complete — Supabase + multi-user ready`

---

## .env.local template

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


**6 features requested:**
1. Redesign the tailored resume panel (review.html / detail.html)
2. Fit score breakdown modal (click badge → see full breakdown)
3. Dashboard filters & sorting (sort by fit, by AI used)
4. Model selector on dashboard campaign form + usage indicators (track call count in DB)
5. Pagination (20/40/60, client-side JS)
6. Manual tailoring — remove auto-tailor from campaign flow, auto-fit analysis stays

---

## Critical Files

| File | Role |
|---|---|
| `jobbot/templates/dashboard.html` | Campaign form, pending jobs cards, applications section |
| `jobbot/templates/review.html` | Fit analysis, tailored resume panel, re-tailor controls |
| `jobbot/templates/detail.html` | Simple tailored resume panel |
| `jobbot/static/style.css` | All styles (~1950 lines, cyberpunk HUD theme) |
| `jobbot/app.py` | All Flask routes, `on_job_found()` callback, campaign start |
| `jobbot/db/database.py` | Schema, query functions |
| `jobbot/engine/resume.py` | `tailor_resume()`, `generate_fit_summary()`, `_call_llm()` |

---

## TDD Approach

All backend changes follow **RED → GREEN → REFACTOR**. Tests in `jobbot/tests/` use pytest + in-memory SQLite (existing pattern in `tests/test_database.py`). Frontend changes verified via E2E tests after implementation (`/everything-claude-code:e2e`).

**Test files to create/extend:**
- `tests/test_database.py` — extend with api_usage + preferred_model tests
- `tests/test_app_routes.py` — new file for Flask route tests (campaign start, usage endpoint, manual tailor flow)
- `tests/test_manual_tailor.py` — new file verifying auto-tailor is NOT called during campaign

---

## Implementation Plan

### Step 1 — RED: Write failing tests for DB changes first

**File: `jobbot/tests/test_database.py`** — add before implementing DB changes:

```python
def test_api_usage_table_exists():
    init_db()
    with get_conn() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert "api_usage" in tables

def test_increment_api_usage_first_call():
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    usage = get_api_usage_today()
    assert usage.get("groq/llama-3.3-70b", 0) == 1

def test_increment_api_usage_accumulates():
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    increment_api_usage("groq/llama-3.3-70b")
    usage = get_api_usage_today()
    assert usage["groq/llama-3.3-70b"] == 2

def test_increment_api_usage_multiple_models():
    init_db()
    increment_api_usage("groq/llama-3.3-70b")
    increment_api_usage("openrouter/gpt-oss-120b")
    usage = get_api_usage_today()
    assert usage["groq/llama-3.3-70b"] == 1
    assert usage["openrouter/gpt-oss-120b"] == 1

def test_campaigns_has_preferred_model_column():
    init_db()
    with get_conn() as conn:
        cols = {r[1] for r in conn.execute(
            "PRAGMA table_info(campaigns)"
        ).fetchall()}
    assert "preferred_model" in cols
```

**File: `jobbot/tests/test_app_routes.py`** — new file, add before implementing routes:

```python
import pytest
from app import app as flask_app

@pytest.fixture
def client(tmp_path, monkeypatch):
    """Flask test client with isolated DB."""
    monkeypatch.setenv("JOBBOT_DB", str(tmp_path / "test.db"))
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c

def test_usage_endpoint_returns_json(client):
    resp = client.get("/api/usage")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, dict)

def test_campaign_start_accepts_preferred_model(client, monkeypatch):
    # Set up minimal config so setup guard passes
    ...  # mock is_setup_complete to return True
    resp = client.post("/campaign/start", data={
        "titles": "Engineer",
        "preferred_model": "groq/llama-3.3-70b"
    })
    # Redirects to dashboard
    assert resp.status_code in (302, 200)
```

**File: `jobbot/tests/test_manual_tailor.py`** — new file:

```python
from unittest.mock import patch, MagicMock

def test_on_job_found_does_not_call_tailor_resume():
    """Auto-tailor must NOT be triggered during campaign job processing."""
    with patch("app.tailor_resume") as mock_tailor:
        # Simulate on_job_found callback with a valid job
        from app import _simulate_job_found_for_test  # helper we'll add
        _simulate_job_found_for_test({
            "title": "Engineer",
            "company": "Acme",
            "url": "https://example.com/job/1",
            "job_description": "We need a great engineer",
            "easy_apply": True,
        })
        mock_tailor.assert_not_called()

def test_on_job_found_still_calls_fit_summary():
    """Fit analysis MUST still run automatically."""
    with patch("app.generate_fit_summary") as mock_fit:
        from app import _simulate_job_found_for_test
        _simulate_job_found_for_test({...})
        mock_fit.assert_called_once()
```

Run tests: `pytest tests/ -v` → all 5+ new tests **FAIL** (RED) ✓

---

### Step 2 (was Step 1) — Database: `api_usage` table + `preferred_model` on campaigns

**File: `jobbot/db/database.py`**

1. Add `api_usage` table to schema:
```sql
CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model_key TEXT NOT NULL,
    call_date TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    UNIQUE(provider, model_key, call_date)
);
```

2. Add `preferred_model TEXT DEFAULT 'auto'` column to `campaigns` table via `ALTER TABLE` in init (use `IF NOT EXISTS` pattern already used in DB).

3. Add helper functions:
   - `increment_api_usage(model_key: str)` — upsert today's count
   - `get_api_usage_today() -> dict[str, int]` — returns `{model_key: count}` for all models today

---

After implementing Step 2 DB changes, run `pytest tests/test_database.py -v` → all DB tests **PASS** (GREEN) ✓

---

### Step 3 (was Step 2) — Engine: Track usage per call

**File: `jobbot/engine/resume.py`**

After every successful `_call_llm()` (line ~421 where `_set_last_model()` is called), call `db.increment_api_usage(model_key)`.

Import `db` lazily inside the function to avoid circular import (same pattern as other db calls in app.py).

No other changes to resume.py for this step.

---

### Step 4 — Manual Tailoring: Remove auto-tailor from campaign flow

**File: `jobbot/app.py`**

In `on_job_found()` callback (lines ~390–413):
- **Remove** the `tailor_resume()` call + subsequent `update_application("reviewed", ...)` 
- **Keep** the `generate_fit_summary()` background thread — it auto-runs when job is found
- Jobs will now stay in `status='pending'` with fit data but no resume
- The existing `/retailor/<app_id>` route already handles manual tailoring — no changes needed there

Also in `on_job_found()`, after insert, the status should remain `'pending'` (do not transition to `'reviewed'` until user manually tailors). Add `_simulate_job_found_for_test()` helper function (test-only, guarded by `if app.config.get("TESTING")`) to support the manual tailor tests.

Run `pytest tests/test_manual_tailor.py -v` → **PASS** (GREEN) ✓

**File: `jobbot/app.py` — Campaign start route (`POST /campaign/start`)**

Accept `preferred_model` from form, store it in the campaign row (via `create_campaign()` or direct insert).

Add `/api/usage` endpoint returning `get_api_usage_today()` as JSON (used by dashboard JS to populate usage bars).

Run `pytest tests/test_app_routes.py -v` → **PASS** (GREEN) ✓

---

### Step 5 — Dashboard: Model selector + usage bars in campaign form

**File: `jobbot/templates/dashboard.html`**

Add a model selector row to the campaign form (before the Start Campaign button):

```html
<div class="form-row model-select-row">
  <label>AI Model for Tailoring</label>
  <div class="model-options" id="modelOptions">
    <!-- One card per model: radio + name + usage bar -->
    <label class="model-option" data-model="auto">
      <input type="radio" name="preferred_model" value="auto" checked>
      <span class="model-name">Auto (best available)</span>
      <span class="model-usage-bar">
        <span class="usage-fill" id="usage-auto"></span>
      </span>
      <span class="usage-count" id="usage-count-auto">— calls</span>
    </label>
    <!-- repeat for each model key -->
  </div>
</div>
```

JS on page load: fetch `/api/usage`, populate each `#usage-count-{key}` and set `--fill-pct` CSS variable on `.usage-fill` bars.
- Groq soft daily limit estimate: 30 calls → bar fills proportionally
- OpenRouter/Anthropic: show raw count only (no hard limit known)
- Models with no API key configured: show "Not configured" + disabled state (pass `configured_models` set from Flask to template)

---

### Step 6 — Dashboard: Sort/Filter controls + Tailor button on cards

**File: `jobbot/templates/dashboard.html`**

**A. Sort/Filter bar** (above pending jobs grid):

```html
<div class="jobs-controls">
  <div class="sort-group">
    <span class="control-label">Sort by</span>
    <button class="sort-btn active" data-sort="fit-desc">Fit ↓</button>
    <button class="sort-btn" data-sort="fit-asc">Fit ↑</button>
    <button class="sort-btn" data-sort="newest">Newest</button>
    <button class="sort-btn" data-sort="model">AI Model</button>
  </div>
  <div class="filter-group">
    <span class="control-label">Status</span>
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="tailored">Tailored</button>
    <button class="filter-btn" data-filter="untailored">Not Tailored</button>
  </div>
</div>
```

JS: pure client-side sort/filter on the `.job-card` elements using `data-fit`, `data-model`, `data-tailored` attributes rendered by Jinja.

**B. Job card changes** (within the pending jobs loop):
- Add `data-fit="{{ job.fit_score or 0 }}"`, `data-model="{{ job.model_used or '' }}"`, `data-tailored="{{ 1 if job.resume_path else 0 }}"` to card element
- Add tailoring status badge: if `job.resume_path` is None → show `<span class="untailored-badge">Not tailored</span>` + `<button class="tailor-btn">Tailor Resume</button>`; else show `<span class="tailored-badge model-badge">{{ job.model_used }}</span>`
- The "Tailor" button POSTs to `/retailor/<id>` with the campaign's preferred model as default (but user can override per-job via a small model selector on the card — keep it simple, just use campaign default on button click via JS form submit)
- Make the fit score badge **clickable** → triggers breakdown modal (see Step 7)

---

### Step 7 — Pagination (client-side JS)

**File: `jobbot/templates/dashboard.html`**

Add pagination controls below both the pending jobs section and the applications section:

```html
<div class="pagination-bar">
  <span class="page-size-label">Show</span>
  <button class="page-size-btn active" data-size="20">20</button>
  <button class="page-size-btn" data-size="40">40</button>
  <button class="page-size-btn" data-size="60">60</button>
  <span class="page-nav">
    <button class="prev-btn" disabled>‹ Prev</button>
    <span class="page-indicator">1 / 1</span>
    <button class="next-btn" disabled>Next ›</button>
  </span>
</div>
```

JS: `PaginationController` class that takes a container selector + page size. On init, assigns `data-index` to each card and shows only the current page slice. Page size buttons update the slice. Prev/Next navigate pages. State is in-memory only (no URL params needed for this use case).

---

### Step 8 — Fit Score Breakdown Modal

**File: `jobbot/templates/dashboard.html` + `review.html`**
**File: `jobbot/static/style.css`**

A single reusable modal component rendered once in the body, populated by JS when a fit badge is clicked.

**Trigger**: Any `.fit-badge[data-fit-id]` click calls `openFitModal(appId)`.

**Modal layout:**
```
┌──────────────────────────────────────────────────────┐
│  FIT ANALYSIS — [Job Title]                      [×]  │
├──────────────────────────────────────────────────────┤
│                                                       │
│  [ large score ring ]   STRENGTHS                     │
│       75%               ● product roadmap ownership  │
│   FIT SCORE             ● cross-functional leadership │
│                                                       │
│                         GAPS                          │
│                         ✗ DTC beauty experience      │
│                         ✗ performance marketing      │
├──────────────────────────────────────────────────────┤
│  VERDICT                                              │
│  "Strong tech background but lacks consumer-goods..." │
├──────────────────────────────────────────────────────┤
│  JD KEYWORDS: [product vision] [roadmap] [DTC] ...   │
└──────────────────────────────────────────────────────┘
```

**Data delivery**: Jinja renders fit data as `data-*` attributes on `.fit-badge` elements, or as a JSON blob in a `<script type="application/json" id="fit-data">` per job. JS reads this on click — no extra API call needed.

The score ring reuses the existing SVG ring CSS pattern from `review.html` (`.ats-ring` / `.ring-fill`).

---

### Step 9 — Tailored Resume Panel Redesign

**File: `jobbot/templates/review.html`** (right panel, currently ~lines 185-250)
**File: `jobbot/templates/detail.html`** (right panel)
**File: `jobbot/static/style.css`**

**New panel structure** (replaces current model badge + raw `#resume-content`):

```html
<div class="resume-panel">
  <!-- Sticky header -->
  <div class="resume-panel-header">
    <div class="resume-panel-title">
      <span class="panel-label">TAILORED RESUME</span>
      {% if job.model_used %}
      <span class="model-badge">{{ job.model_used }}</span>
      {% endif %}
    </div>
    <div class="resume-panel-actions">
      {% if job.keywords %}
      <span class="kw-match-badge" title="Keywords matched in resume">
        <svg>…hexagon icon…</svg>
        <span id="kw-match-count">—</span> / {{ job.keywords.split(',')|length }} kw
      </span>
      {% endif %}
      <a href="/download/{{ job.id }}" class="btn-download">↓ PDF</a>
      <!-- Re-tailor form (already exists, just moved into header) -->
      <form action="/retailor/{{ job.id }}" method="post" class="retailor-form">
        <select name="model" class="model-select-inline">
          {% for key, label in available_models.items() %}
          <option value="{{ key }}">{{ label }}</option>
          {% endfor %}
        </select>
        <button type="submit" class="btn-retailor">⟳ Re-tailor</button>
      </form>
    </div>
  </div>
  <!-- Resume body — JS renders markdown here (same as current) -->
  <div class="resume-body" id="resume-content">
    <div class="skeleton-loader">…</div>
  </div>
</div>
```

**CSS improvements for rendered resume (`resume-body`):**
- `h2.resume-name`: larger (1.4rem), cyan text, letter-spacing, bottom border `#00d4ff 1px solid`, margin-bottom 4px
- `h3.resume-section`: uppercase, 0.7rem, `#5a9db8` color, border-left `3px solid #00d4ff`, padding-left 8px, margin-top 24px
- `.resume-bullet`: padding-left 16px, `::before` content `"›"` in cyan
- `.resume-summary`: italic, border-left `2px solid #00ff88`, padding-left 10px, color `#c8f0ff`
- Panel header: `position: sticky; top: 0; background: #061825; z-index: 10; padding: 12px 16px; border-bottom: 1px solid #1e4a60`
- `resume-body`: `overflow-y: auto; max-height: calc(100vh - 200px); padding: 20px`
- `.kw-match-badge`: pill style with hexagon icon, cyan color
- `.btn-download`: small HUD button, cyan border

**detail.html** — same redesign applied. Currently loads via same `/resume-text/{id}` fetch + same JS renderer. Replace the raw `#resume-content` div with the new `resume-panel` structure (simplified — no re-tailor form since detail.html is for applied jobs).

---

### Step 10 — Styling (style.css additions)

All new CSS to be appended to `/jobbot/static/style.css`:

- `.model-options` + `.model-option` — radio card grid for campaign form
- `.usage-fill` — animated usage bar with CSS variable `--fill-pct`
- `.jobs-controls` + `.sort-btn` + `.filter-btn` — sort/filter bar in HUD chip style (matching existing `.chip-toggle` pattern)
- `.untailored-badge` / `.tailored-badge` — status indicators on job cards
- `.tailor-btn` — per-card tailor button (cyan outline, small)
- `.pagination-bar` — HUD-style pagination footer
- `.page-size-btn` + `.prev-btn` + `.next-btn` — pagination controls
- `#fit-modal` — full-screen overlay modal
- `.fit-modal-content` — modal panel with dark surface, HUD corners
- `.fit-score-ring` — reuse SVG ring pattern
- `.fit-strengths` + `.fit-gaps` — two-column chip layout in modal
- `.fit-verdict` — blockquote style with cyan left border
- `.fit-keywords-list` — keyword chips row
- `.resume-panel` + `.resume-panel-header` + `.resume-panel-actions` — new resume panel styles
- `.resume-body h2`, `.resume-body h3`, `.resume-body .resume-bullet` etc. — improved resume typography

---

## Verification Plan

1. **Start app**: `cd jobbot && python app.py`
2. **Manual tailoring**: Start a campaign, confirm jobs appear as `pending` with fit data but no resume. Click "Tailor Resume" on a card → spinner shows → on completion card shows model badge.
3. **Fit modal**: Click a fit score badge on dashboard → modal opens with correct strengths/gaps/verdict/keywords.
4. **Sort/filter**: Use sort buttons to reorder by fit score — verify cards reorder. Filter by "Not tailored" — verify untailored cards shown only.
5. **Pagination**: With 20+ pending jobs, verify page size 20 shows first 20, Next btn works.
6. **Model selector**: Open campaign form, verify model cards render with usage bars. Start campaign with specific model selected.
7. **Usage tracking**: Tailor a resume, then reload dashboard — usage count for that model increments.
8. **Resume panel**: Go to review page, verify sticky header with model badge + download button + keyword match count. Verify resume typography improved (section headers, bullets).
9. **E2E with /everything-claude-code:e2e**: Run full flow after implementation.
10. **Git**: Commit to `feat/ui-enhancements` branch, push to GitHub.

---

## AI Handoff Document

**If context is lost, create this at `jobbot/HANDOFF.md` immediately so another AI can continue:**

```
# JobBot Enhancement — AI Handoff

## Project location
/Users/dkirali/Desktop/Project/jobbot

## Run the app
cd /Users/dkirali/Desktop/Project/jobbot
source venv/bin/activate
python app.py
# Opens at http://127.0.0.1:5000

## Run tests
cd /Users/dkirali/Desktop/Project/jobbot
source venv/bin/activate
pytest tests/ -v

## Git branch for this work
git checkout feat/ui-enhancements  (or create it if it doesn't exist)

## 6 Features being implemented (pick up from the last completed step)

1. TAILORED RESUME REDESIGN
   - review.html right panel: sticky header (model badge + download btn + keyword count), 
     better resume typography (cyan section headers, indented bullets)
   - detail.html: same panel, no re-tailor form
   - CSS classes to add: .resume-panel, .resume-panel-header, .resume-panel-actions,
     .resume-body h2/h3/bullet improvements, .kw-match-badge, .btn-download

2. FIT SCORE BREAKDOWN MODAL
   - Fit badges are clickable → shows modal with score ring, strengths chips, gaps chips,
     verdict quote, JD keywords
   - Modal element: #fit-modal (rendered once in body, JS populates from data-* attrs)
   - Fit data embedded in template as JSON: <script type="application/json" id="fit-data-{id}">
   - CSS classes: #fit-modal, .fit-modal-content, .fit-score-ring, .fit-strengths, 
     .fit-gaps, .fit-verdict, .fit-keywords-list

3. DASHBOARD SORT/FILTER
   - Sort bar above pending jobs: Fit ↓, Fit ↑, Newest, AI Model
   - Filter bar: All, Tailored, Not Tailored
   - Pure client-side JS: cards have data-fit, data-model, data-tailored attrs
   - CSS: .jobs-controls, .sort-btn, .filter-btn

4. MODEL SELECTOR ON DASHBOARD + USAGE TRACKING
   - Add api_usage table to SQLite: (provider, model_key, call_date, call_count UNIQUE)
   - Add preferred_model column to campaigns table
   - increment_api_usage(model_key) called after each successful LLM call in engine/resume.py
   - get_api_usage_today() returns {model_key: count}
   - /api/usage endpoint returns JSON of today's counts
   - Campaign form: model selector radio cards with usage bars (JS fetches /api/usage)
   - CSS: .model-options, .model-option, .usage-fill (CSS var --fill-pct)

5. PAGINATION (client-side JS)
   - PaginationController class: takes container + page size, assigns data-index to cards
   - Page sizes: 20, 40, 60
   - Controls: page-size buttons + prev/next + "page X of Y" indicator
   - Applied to both pending jobs section and applications section
   - CSS: .pagination-bar, .page-size-btn, .prev-btn, .next-btn, .page-indicator

6. MANUAL TAILORING
   - REMOVE tailor_resume() call from on_job_found() in app.py (~lines 390-413)
   - KEEP generate_fit_summary() background thread (auto-runs on job found)
   - Jobs arrive as pending with fit data but NO resume
   - Add "Tailor Resume" button to dashboard job cards → POST /retailor/<id>
   - /retailor route already exists and works — just expose it in UI
   - Show "Not tailored" badge on cards where resume_path is None

## Key files
- app.py — Flask routes, on_job_found() callback (line ~364), campaign start (line ~195)
- db/database.py — schema init, query functions
- engine/resume.py — tailor_resume(), generate_fit_summary(), _call_llm() (~line 421)
- templates/dashboard.html — main UI (426 lines)
- templates/review.html — review/tailor page (369 lines)
- templates/detail.html — applied job detail page (102 lines)
- static/style.css — all styles (~1950 lines, cyberpunk theme)
- tests/ — pytest test files

## Design tokens (cyberpunk HUD theme)
bg: #040c14, surface: #061825/#0b2336
cyan: #00d4ff, lime: #00ff88, red: #ff3355, amber: #ffb700, magenta: #ff00aa
fonts: Inter (body), Share Tech Mono (HUD/numbers)
NO external CSS/JS libraries — pure CSS + vanilla JS only

## TDD requirements
- Write tests BEFORE implementing backend changes
- tests/test_database.py — extend with api_usage + preferred_model tests
- tests/test_app_routes.py — new file for Flask route tests
- tests/test_manual_tailor.py — verify auto-tailor not called
- Run: pytest tests/ --cov=db --cov=engine --cov=app --cov-report=term-missing
- Target: 80%+ coverage on new code

## After all features done
1. pytest tests/ -v  (all pass)
2. /everything-claude-code:e2e  (E2E test suite)
3. git checkout -b feat/ui-enhancements && git add && git commit && git push
```

---

## Order of Implementation (TDD-driven)

| Step | Action | Cycle |
|---|---|---|
| 0 | Create `jobbot/HANDOFF.md` with the AI Handoff content above | SETUP |
| 1 | Write failing tests for DB, routes, manual-tailor behavior | RED |
| 2 | Implement DB schema changes | GREEN |
| 3 | Implement engine usage tracking | GREEN |
| 4 | Implement app.py manual tailor + usage endpoint + campaign model | GREEN |
| 5 | Run all backend tests: `pytest tests/ -v` — must pass | VERIFY |
| 6 | Style.css: add all new CSS classes | — |
| 7 | dashboard.html: model selector + sort/filter + tailor buttons + pagination + fit modal | — |
| 8 | review.html: resume panel redesign + fit modal component | — |
| 9 | detail.html: resume panel redesign | — |
| 10 | Run app, manually verify all 6 features in browser | VERIFY |
| 11 | Run `/everything-claude-code:e2e` for automated E2E tests | E2E |
| 12 | Commit + push to GitHub on feature branch | GIT |

**Test coverage target: 80%+ for all new backend functions.**
Run `pytest tests/ --cov=db --cov=engine --cov=app --cov-report=term-missing` after step 5.
