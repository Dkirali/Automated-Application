# JobBot — Next.js + TypeScript Migration
**Date:** 2026-04-14  
**Status:** Approved  
**Scope:** Phase 1 (TypeScript rewrite) + Phase 2 (Cloud DB + multi-user)  
**Deferred:** Phase 3 (Auth/invite-only) + Phase 4 (Hetzner deploy + subdomain) — until personal site is built

---

## Goal

Rewrite JobBot from Python/Flask/SQLite to Next.js/TypeScript/PostgreSQL while keeping the UI, UX, and feature set **identical**. Add multi-user support with per-user data isolation.

---

## Phase 1 — TypeScript Rewrite (single-user, local parity)

### Stack

| Concern | Current | New |
|---|---|---|
| Framework | Flask (Python) | Next.js 14+ App Router (TypeScript) |
| Templates | Jinja2 | React Server Components (JSX/TSX) |
| CSS | `style.css` (plain) | CSS Modules (TypeScript-aware) |
| Database | SQLite via `sqlite3` | SQLite via `better-sqlite3` (Phase 1 only) |
| Word docs | `python-docx` | `docx` npm package |
| PDF generation | `WeasyPrint` | `playwright` `page.pdf()` (already a dep) |
| LLM — Anthropic | `anthropic` | `@anthropic-ai/sdk` |
| LLM — Groq | `groq` | `groq` npm |
| LLM — OpenRouter | `httpx` | `fetch` |
| Browser automation | `playwright` (Python) | `playwright` (Node.js native) |
| Background threads | `threading.Thread` | Node.js `worker_threads` |
| Tests | `pytest` | `vitest` |

### Project Structure

```
src/
├── app/
│   ├── layout.tsx                   # root layout — imports global CSS
│   ├── page.tsx                     # dashboard (was: GET /)
│   ├── review/[id]/page.tsx         # review page
│   ├── application/[id]/page.tsx    # detail page (applied jobs)
│   ├── settings/page.tsx
│   ├── setup/page.tsx
│   └── api/
│       ├── campaign/start/route.ts  # POST /campaign/start
│       ├── campaign/stop/route.ts   # POST /campaign/stop
│       ├── status/route.ts          # GET /status
│       ├── usage/route.ts           # GET /api/usage
│       ├── job-status/[id]/route.ts # GET /api/job-status/:id
│       ├── apply/[id]/route.ts      # POST /apply/:id
│       ├── discard/[id]/route.ts    # POST /discard/:id
│       ├── bulk-discard/route.ts    # POST /bulk-discard
│       ├── retailor/[id]/route.ts   # POST /retailor/:id
│       ├── download/[id]/route.ts   # GET /download/:id
│       ├── resume-text/[id]/route.ts # GET /resume-text/:id
│       └── retry-pending/route.ts   # POST /retry-pending
├── lib/
│   ├── db.ts                        # all DB queries (was: db/database.py)
│   ├── resume.ts                    # LLM calls + docx generation (was: engine/resume.py)
│   ├── scraper.ts                   # Playwright LinkedIn scraper (was: engine/scraper.py)
│   ├── submitter.ts                 # Easy Apply submission (was: engine/submitter.py)
│   ├── safety.ts                    # rate-limit / safety checks (was: engine/safety.py)
│   └── campaign.ts                  # campaign runner using worker_threads (was: run_campaign in app.py)
└── styles/
    ├── globals.css                  # current style.css, unchanged
    └── [component].module.css       # component-scoped overrides where needed
```

### CSS Strategy

- `src/styles/globals.css` — the existing `style.css` copied verbatim. Imported once in `layout.tsx`. All existing class names work as-is.
- CSS Modules used only for **new** component-specific styles or where TypeScript class-name safety is needed. No existing styles need to be rewritten.

### Template Migration

Jinja2 templates → React Server Components (TSX). The mapping is mechanical:

| Jinja2 | React/TSX |
|---|---|
| `{% for item in list %}` | `{list.map(item => ...)}` |
| `{% if condition %}` | `{condition && ...}` |
| `{{ variable }}` | `{variable}` |
| `{% set x = val %}` | `const x = val` (in component body) |
| `{% include %}` | Import component |

All HTML structure, class names, and inline styles stay identical. The JS in `<script>` tags (pagination, sort/filter, fit modal, etc.) moves to Client Components (`'use client'`).

### Campaign Runner (threading → worker_threads)

The Flask campaign loop ran as a `threading.Thread`. In Next.js (deployed as a persistent Node.js process on Hetzner — not serverless), this becomes a Node.js `worker_threads.Worker`. The pattern is identical: one worker per active campaign, shared state via `Atomics` or a simple module-level Map for status, stopped via `worker.terminate()` or a `SharedArrayBuffer` stop flag.

### TDD Approach for Phase 1

Each Python module is ported in RED → GREEN → REFACTOR order:

1. Write Vitest tests that mirror the existing pytest tests
2. Confirm they fail (RED)
3. Port the TypeScript implementation (GREEN)
4. Refactor + confirm passing

Test files live in `tests/` mirroring the `src/lib/` structure.

---

## Phase 2 — Cloud DB + Multi-User

### Database: Supabase (PostgreSQL)

Replace `better-sqlite3` with Supabase. Schema stays the same with one addition: `user_id TEXT NOT NULL` on every table, referencing Supabase Auth users.

```sql
-- Added to every existing table:
ALTER TABLE campaigns      ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE applications   ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE manual_queue   ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE config         ADD COLUMN user_id TEXT NOT NULL;
ALTER TABLE api_usage      ADD COLUMN user_id TEXT NOT NULL;

-- Row Level Security (enforced at DB level, not just app level)
ALTER TABLE campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
-- ... (same for all tables)

CREATE POLICY "users see own data" ON campaigns
  USING (user_id = auth.uid());
-- ... (same for all tables)
```

The `db.ts` library switches from `better-sqlite3` to the `@supabase/supabase-js` client. All query functions gain a `userId` parameter. The API routes pass `session.user.id` from NextAuth into every DB call.

### File Storage: Supabase Storage

Resumes move from the local filesystem to Supabase Storage:

```
resumes/{userId}/master.docx          ← uploaded on setup/settings
resumes/{userId}/tailored/{appId}.docx
resumes/{userId}/tailored/{appId}.pdf
```

The `download` route streams from Supabase Storage. The `resume-text` route fetches the docx, extracts text, and returns JSON — same as today.

### Per-User LinkedIn Sessions

Each user has their own Playwright Chrome profile stored in a Docker volume on Hetzner:

```
/data/chrome-profiles/{userId}/   ← persistent volume
```

The LinkedIn connect flow (browser launch, wait for login) and campaign scraper both pass `userDataDir: /data/chrome-profiles/${userId}` to Playwright. Sessions are fully isolated between users.

### Auth: NextAuth.js v5 (deferred to Phase 3)

Placeholder in Phase 2 — all DB queries include `userId` but auth resolves to a single user ID from `SINGLE_USER_ID` env var until Phase 3 implements Google OAuth + invite whitelist. This means Phase 2 is still effectively single-user but the schema and query layer are fully multi-user ready.

---

## Key Constraints

1. **Not serverless** — Must deploy as a persistent Node.js process (Playwright + background threads). Hetzner VPS + Docker is correct. Do NOT deploy to Vercel or Netlify.
2. **CSS unchanged** — The cyberpunk theme (`style.css`) is carried over verbatim. No Tailwind rewrite.
3. **Feature parity** — Phase 1 ships nothing new. Every feature that works in Python must work in TypeScript before moving to Phase 2.
4. **TDD required** — Tests written before implementation for all `src/lib/` modules.

---

## Deferred (Phase 3 + 4)

- Google OAuth + invite-only whitelist
- Hetzner Docker deployment (`Dockerfile`, `docker-compose.yml`)
- Nginx reverse proxy config
- Certbot SSL
- GitHub Actions CI/CD pipeline
- Subdomain DNS setup

These are picked up after the personal website is built and deployed on Hetzner.
