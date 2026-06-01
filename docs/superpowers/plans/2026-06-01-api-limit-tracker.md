# Daily API Limit Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live daily-token-usage gauge on the dashboard, auto-stop campaigns when the daily Groq quota is exhausted, and warn the user (desktop + in-app) as they approach the limit.

**Architecture:** Reuse the existing `api_usage` table and `globalThis` rate-limit state. Add a `tokens` column and record real `usage.total_tokens` from each LLM response. The `/api/usage` route returns the active model's token usage vs. a configurable daily cap; the dashboard polls it every 15 s and renders a gauge. The existing `setRateLimited()` chokepoint gains a *tiered* auto-stop: transient minute-window limits still pause and auto-resume, but a daily-exhaustion-level limit hard-stops the campaign.

**Tech Stack:** Next.js 16 (App Router), React 19, better-sqlite3, Vitest, Playwright.

---

## File Structure

- `src/lib/db.ts` — add `tokens` column; token-aware `incrementApiUsage` / `getApiUsageToday`.
- `src/lib/resume.ts` — capture tokens from provider responses; tiered auto-stop in `setRateLimited`.
- `src/lib/usage-ui.ts` *(new)* — pure gauge-level helper (testable without a DOM).
- `src/app/api/usage/route.ts` — return the gauge payload.
- `src/app/api/settings/route.ts` — persist `daily_token_limit`.
- `src/app/settings/page.tsx` + `src/app/settings/SettingsClient.tsx` — daily-limit input.
- `src/app/DashboardClient.tsx` — `LimitGauge` UI, polling, gesture-gated notifications.
- `src/styles/globals.css` — gauge styles.
- `tests/db.test.ts` *(new)*, `tests/usage-ui.test.ts` *(new)*, `tests/usage-route.test.ts` *(new)*, `tests/resume-ratelimit.test.ts` *(new)*, `tests/e2e/app.spec.ts` — coverage.

---

### Task 1: Token-aware usage tracking in the DB

**Files:**
- Modify: `src/lib/db.ts` (`initDb` ~line 42, `incrementApiUsage` lines 371–381, `getApiUsageToday` lines 383–391)
- Test: `tests/db.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, incrementApiUsage, getApiUsageToday } from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
});

describe("api usage token tracking", () => {
  it("accumulates calls and tokens per model", () => {
    incrementApiUsage("groq/llama-3.3-70b", 1200);
    incrementApiUsage("groq/llama-3.3-70b", 800);
    const usage = getApiUsageToday();
    expect(usage.counts["groq/llama-3.3-70b"]).toBe(2);
    expect(usage.tokensByModel["groq/llama-3.3-70b"]).toBe(2000);
  });

  it("defaults tokens to 0 when omitted (back-compat)", () => {
    incrementApiUsage("anthropic/claude-sonnet");
    const usage = getApiUsageToday();
    expect(usage.counts["anthropic/claude-sonnet"]).toBe(1);
    expect(usage.tokensByModel["anthropic/claude-sonnet"]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — `getApiUsageToday()` returns a flat `Record`, so `usage.counts` is `undefined`.

- [ ] **Step 3: Add the `tokens` column (idempotent ALTER)**

In `src/lib/db.ts`, inside `initDb()`, immediately after the existing `applications` `newCols` ALTER loop (the block ending around line 116), add:

```ts
  // api_usage gained a token counter on 2026-06-01.
  const usageCols = db
    .prepare("PRAGMA table_info(api_usage)")
    .all() as Array<{ name: string }>;
  if (!usageCols.some((c) => c.name === "tokens")) {
    db.exec("ALTER TABLE api_usage ADD COLUMN tokens INTEGER DEFAULT 0");
  }
```

Also add `tokens INTEGER DEFAULT 0` to the `CREATE TABLE IF NOT EXISTS api_usage` block so fresh DBs get it directly:

```ts
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_key TEXT NOT NULL,
      call_date TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      tokens INTEGER DEFAULT 0,
      UNIQUE(provider, model_key, call_date)
    );
```

- [ ] **Step 4: Make `incrementApiUsage` and `getApiUsageToday` token-aware**

Replace `incrementApiUsage` (lines 371–381) and `getApiUsageToday` (lines 383–391) with:

```ts
export function incrementApiUsage(modelKey: string, tokens: number = 0): void {
  const today = new Date().toISOString().split("T")[0];
  const provider = modelKey.includes("/") ? modelKey.split("/")[0] : modelKey;
  getConn()
    .prepare(
      "INSERT INTO api_usage (provider, model_key, call_date, call_count, tokens) VALUES (?,?,?,1,?) ON CONFLICT(provider, model_key, call_date) DO UPDATE SET call_count = call_count + 1, tokens = tokens + excluded.tokens"
    )
    .run(provider, modelKey, today, tokens);
}

export interface ApiUsageToday {
  counts: Record<string, number>;
  tokensByModel: Record<string, number>;
}

export function getApiUsageToday(): ApiUsageToday {
  const today = new Date().toISOString().split("T")[0];
  const rows = getConn()
    .prepare("SELECT model_key, call_count, tokens FROM api_usage WHERE call_date=?")
    .all(today) as { model_key: string; call_count: number; tokens: number }[];
  const counts: Record<string, number> = {};
  const tokensByModel: Record<string, number> = {};
  for (const r of rows) {
    counts[r.model_key] = r.call_count;
    tokensByModel[r.model_key] = r.tokens;
  }
  return { counts, tokensByModel };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts tests/db.test.ts
git commit -m "feat: track per-model token usage in api_usage"
```

---

### Task 2: Capture token counts from LLM responses

**Files:**
- Modify: `src/lib/resume.ts` (`trackUsage` ~lines 248–256; `callProvider` 760–796; `withValidation` 832–846; `callers` 848–899; final block 901–911)
- Test: `tests/resume-ratelimit.test.ts` (create — also used by Task 3)

- [ ] **Step 1: Write the failing test**

Create `tests/resume-ratelimit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractTokenCount } from "@/lib/resume";

describe("extractTokenCount", () => {
  it("reads total_tokens for groq/openrouter shapes", () => {
    expect(extractTokenCount("groq", { usage: { total_tokens: 1500 } })).toBe(1500);
    expect(extractTokenCount("openrouter", { usage: { total_tokens: 900 } })).toBe(900);
  });

  it("sums input+output tokens for anthropic", () => {
    expect(
      extractTokenCount("anthropic", { usage: { input_tokens: 700, output_tokens: 300 } })
    ).toBe(1000);
  });

  it("returns 0 when usage is missing", () => {
    expect(extractTokenCount("groq", {})).toBe(0);
    expect(extractTokenCount("groq", null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/resume-ratelimit.test.ts`
Expected: FAIL — `extractTokenCount` is not exported from `@/lib/resume`.

- [ ] **Step 3: Add `extractTokenCount` and the `LlmResult` type**

In `src/lib/resume.ts`, just above `callProvider` (line 760), add:

```ts
interface LlmResult {
  text: string;
  tokens: number;
}

// Normalizes a provider's completion object to a single token count.
// Groq + OpenRouter expose usage.total_tokens; Anthropic splits in/out.
export function extractTokenCount(provider: ActiveProvider, raw: unknown): number {
  const usage = (raw as {
    usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
  })?.usage;
  if (!usage) return 0;
  if (provider === "anthropic") {
    return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }
  return usage.total_tokens ?? 0;
}
```

- [ ] **Step 4: Thread `LlmResult` through `callProvider`, `withValidation`, and `callers`**

In `src/lib/resume.ts`:

Change `callProvider`'s signature and return (lines 760–763) to:

```ts
async function callProvider(
  name: string,
  fn: () => Promise<LlmResult>
): Promise<LlmResult | null> {
```

(The body is unchanged — `return await fn();` now returns an `LlmResult`.)

Change `withValidation` (lines 832–846) to validate `result.text`:

```ts
  const withValidation = (
    fn: () => Promise<LlmResult>
  ): (() => Promise<LlmResult>) => {
    if (!validate) return fn;
    return async () => {
      const result = await fn();
      const check = validate(result.text);
      if (!check.ok) {
        console.error(
          "[LLM] Validation failed:",
          check.errors.slice(0, 5).join("; ")
        );
        throw new Error(`Validation failed: ${check.errors[0] ?? "unknown"}`);
      }
      return result;
    };
  };
```

Change `callers` (lines 848–899) so each branch returns `{ text, tokens }`:

```ts
  const callers: Record<ActiveProvider, () => Promise<LlmResult>> = {
    groq: async () => {
      const Groq = require("groq-sdk");
      const client = new Groq({ apiKey });
      const message = await client.chat.completions.create({
        model: model.modelId,
        max_tokens: maxTokens,
        temperature: 0,
        top_p: 0.1,
        messages: [{ role: "user", content: prompt }],
      });
      return {
        text: message.choices[0].message.content,
        tokens: extractTokenCount("groq", message),
      };
    },
    anthropic: async () => {
      const Anthropic =
        require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: model.modelId,
        max_tokens: maxTokens,
        temperature: 0,
        top_p: 0.1,
        messages: [{ role: "user", content: prompt }],
      });
      return {
        text: message.content[0].text,
        tokens: extractTokenCount("anthropic", message),
      };
    },
    openrouter: async () => {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
          "X-Title": "JobBot",
        },
        body: JSON.stringify({
          model: model.modelId,
          max_tokens: maxTokens,
          temperature: 0,
          top_p: 0.1,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        throw new Error(`OpenRouter ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`Empty response from ${model.modelId}`);
      return { text: content, tokens: extractTokenCount("openrouter", data) };
    },
  };
```

Change the final block (lines 901–911) to record tokens and return the text:

```ts
  const result = await callProvider(
    model.displayName,
    withValidation(callers[model.provider])
  );

  if (result === null) {
    throw new Error(`${model.displayName} failed after retries.`);
  }

  trackUsage(model.usageKey, result.tokens);
  return result.text;
```

- [ ] **Step 5: Make `trackUsage` forward the token count**

Replace `trackUsage` (~lines 248–256) with:

```ts
function trackUsage(usageKey: string, tokens: number = 0): void {
  try {
    const { incrementApiUsage } = require("./db");
    incrementApiUsage(usageKey, tokens);
  } catch {
    // non-critical
  }
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- tests/resume-ratelimit.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors (confirms the `LlmResult` threading compiles).

- [ ] **Step 7: Commit**

```bash
git add src/lib/resume.ts tests/resume-ratelimit.test.ts
git commit -m "feat: record real token counts from LLM responses"
```

---

### Task 3: Tiered auto-stop on daily exhaustion

**Files:**
- Modify: `src/lib/resume.ts` (`setRateLimited` lines 727–733)
- Test: `tests/resume-ratelimit.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/resume-ratelimit.test.ts`:

```ts
import { isDailyExhaustion, DAILY_STOP_THRESHOLD_MS } from "@/lib/resume";

describe("isDailyExhaustion", () => {
  const now = 1_000_000;

  it("is true when the retry-after is long (daily window)", () => {
    const retryAt = now + DAILY_STOP_THRESHOLD_MS + 1;
    expect(isDailyExhaustion(retryAt, 0, 100_000, now)).toBe(true);
  });

  it("is true when token usage already meets the cap", () => {
    const retryAt = now + 1000; // short
    expect(isDailyExhaustion(retryAt, 100_000, 100_000, now)).toBe(true);
  });

  it("is false for a short retry-after below the cap", () => {
    const retryAt = now + 30_000; // 30s minute-window blip
    expect(isDailyExhaustion(retryAt, 5_000, 100_000, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/resume-ratelimit.test.ts`
Expected: FAIL — `isDailyExhaustion` / `DAILY_STOP_THRESHOLD_MS` are not exported.

- [ ] **Step 3: Add the predicate and the stop hook**

In `src/lib/resume.ts`, replace `setRateLimited` (lines 727–733) with:

```ts
// A daily-quota exhaustion looks like a long retry-after (resets at UTC
// midnight) or usage already at/over the cap. A short minute-window blip is
// neither — we leave those to the existing pause/auto-resume behavior.
export const DAILY_STOP_THRESHOLD_MS = 5 * 60_000;

export function isDailyExhaustion(
  retryAtMs: number,
  usedTokens: number,
  dailyLimit: number,
  now: number = Date.now()
): boolean {
  return retryAtMs - now >= DAILY_STOP_THRESHOLD_MS || usedTokens >= dailyLimit;
}

// Lazily require db/campaign to avoid a circular import (matches trackUsage).
function maybeStopForDailyExhaustion(retryAtMs: number): void {
  try {
    const { getApiUsageToday, getConfig, getActiveCampaign, updateCampaignStatus } =
      require("./db");
    const model = getActiveModel();
    let usedTokens = 0;
    let dailyLimit = 100_000;
    if (model) {
      const usage = getApiUsageToday();
      usedTokens = usage.tokensByModel?.[model.usageKey] ?? 0;
      dailyLimit = Number(getConfig("daily_token_limit")) || 100_000;
    }
    if (!isDailyExhaustion(retryAtMs, usedTokens, dailyLimit)) return;

    const { stopCampaign } = require("./campaign");
    stopCampaign();
    const campaign = getActiveCampaign();
    if (campaign) updateCampaignStatus(campaign.id, "stopped", "rate_limited");
  } catch {
    // Never let a stop failure mask the original RateLimitError.
  }
}

function setRateLimited(retryAtMs: number, message: string): void {
  // Take the later of the two — never reduce the back-off window.
  if (retryAtMs > llmG.__jobbot_rate_limit_until) {
    llmG.__jobbot_rate_limit_until = retryAtMs;
    llmG.__jobbot_rate_limit_msg = message;
  }
  maybeStopForDailyExhaustion(retryAtMs);
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -- tests/resume-ratelimit.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resume.ts tests/resume-ratelimit.test.ts
git commit -m "feat: hard-stop campaign on daily-quota exhaustion"
```

---

### Task 4: `/api/usage` returns the gauge payload

**Files:**
- Modify: `src/app/api/usage/route.ts` (full rewrite — currently 6 lines)
- Test: `tests/usage-route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/usage-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, setConfig, incrementApiUsage } from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
  setConfig("active_provider", "groq");
});

describe("/api/usage", () => {
  it("reports the active model's tokens and warn=true past 80%", async () => {
    setConfig("daily_token_limit", "10000");
    incrementApiUsage("groq/llama-3.3-70b", 8500);
    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.tokens).toBe(8500);
    expect(body.dailyLimit).toBe(10000);
    expect(body.pct).toBeCloseTo(0.85, 2);
    expect(body.warn).toBe(true);
  });

  it("warn=false below 80%", async () => {
    setConfig("daily_token_limit", "10000");
    incrementApiUsage("groq/llama-3.3-70b", 1000);
    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.warn).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/usage-route.test.ts`
Expected: FAIL — the current route returns the raw usage map (no `tokens`/`warn`/`pct`).

- [ ] **Step 3: Rewrite the route**

Replace the entire contents of `src/app/api/usage/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getApiUsageToday, getConfig } from "@/lib/db";
import { getActiveModel, getRateLimitState } from "@/lib/resume";

const WARN_THRESHOLD = 0.8;
const DEFAULT_DAILY_TOKEN_LIMIT = 100_000;

export async function GET() {
  try {
    const model = getActiveModel();
    const key = model?.usageKey ?? "";
    const usage = getApiUsageToday();
    const tokens = usage.tokensByModel[key] ?? 0;
    const calls = usage.counts[key] ?? 0;
    const dailyLimit =
      Number(getConfig("daily_token_limit")) || DEFAULT_DAILY_TOKEN_LIMIT;
    const pct = dailyLimit > 0 ? tokens / dailyLimit : 0;
    const rl = getRateLimitState();
    return NextResponse.json({
      model: key,
      tokens,
      calls,
      dailyLimit,
      pct,
      warn: pct >= WARN_THRESHOLD,
      rateLimited: rl.rateLimited,
      retryAt: rl.retryAt,
    });
  } catch {
    return NextResponse.json({
      model: "",
      tokens: 0,
      calls: 0,
      dailyLimit: DEFAULT_DAILY_TOKEN_LIMIT,
      pct: 0,
      warn: false,
      rateLimited: false,
      retryAt: 0,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/usage-route.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/usage/route.ts tests/usage-route.test.ts
git commit -m "feat: usage API returns daily token gauge payload"
```

---

### Task 5: Configurable daily token limit in Settings

**Files:**
- Modify: `src/app/api/settings/route.ts` (after the `setConfig("phone", ...)` block)
- Modify: `src/app/settings/page.tsx` (pass `dailyTokenLimit` prop)
- Modify: `src/app/settings/SettingsClient.tsx` (props + input before the Master Resume group)
- Test: `tests/settings-route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/settings-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, getConfig } from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  process.env.JOBBOT_ENV_PATH = "/tmp/jobbot-test.env";
  initDb();
});

describe("/api/settings daily_token_limit", () => {
  it("persists a positive daily_token_limit", async () => {
    const form = new FormData();
    form.set("name", "Jane");
    form.set("email", "jane@example.com");
    form.set("phone", "+1 555 000 0000");
    form.set("daily_token_limit", "250000");
    const { POST } = await import("@/app/api/settings/route");
    await POST(new Request("http://localhost/api/settings", { method: "POST", body: form }) as never);
    expect(getConfig("daily_token_limit")).toBe("250000");
  });

  it("ignores a non-positive value", async () => {
    const form = new FormData();
    form.set("name", "Jane");
    form.set("email", "jane@example.com");
    form.set("phone", "+1 555 000 0000");
    form.set("daily_token_limit", "-5");
    const { POST } = await import("@/app/api/settings/route");
    await POST(new Request("http://localhost/api/settings", { method: "POST", body: form }) as never);
    expect(getConfig("daily_token_limit")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/settings-route.test.ts`
Expected: FAIL — the route never reads `daily_token_limit`, so `getConfig` returns `null` in the first test.

- [ ] **Step 3: Persist the limit in the settings route**

In `src/app/api/settings/route.ts`, immediately after the existing `setConfig("phone", phone);` line, add:

```ts
  const dailyTokenLimitRaw = (formData.get("daily_token_limit") as string)?.trim() || "";
  if (dailyTokenLimitRaw) {
    const n = parseInt(dailyTokenLimitRaw, 10);
    if (Number.isFinite(n) && n > 0) setConfig("daily_token_limit", String(n));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/settings-route.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Pass the current value to the client**

In `src/app/settings/page.tsx`, add this prop to the `<SettingsClient ... />` element (alongside `name`, `email`, `phone`):

```tsx
      dailyTokenLimit={getConfig("daily_token_limit") || ""}
```

- [ ] **Step 6: Add the input to SettingsClient**

In `src/app/settings/SettingsClient.tsx`:

1. Add `dailyTokenLimit: string;` to the component's props interface.
2. Add `dailyTokenLimit` to the destructured props in the function signature.
3. Insert this block in the `<form>` immediately **before** the `<label>Master Resume</label>` group (around line 260):

```tsx
          <div className="form-group">
            <label htmlFor="daily-token-limit">Daily token limit</label>
            <input
              type="number"
              id="daily-token-limit"
              name="daily_token_limit"
              min={1}
              defaultValue={dailyTokenLimit || "100000"}
            />
            <p className="form-hint">
              Groq&apos;s free tier is ~100,000 tokens/day. The dashboard gauge and
              auto-stop use this number.
            </p>
          </div>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/settings/route.ts src/app/settings/page.tsx src/app/settings/SettingsClient.tsx tests/settings-route.test.ts
git commit -m "feat: configurable daily token limit in settings"
```

---

### Task 6: Dashboard limit gauge + notifications

**Files:**
- Create: `src/lib/usage-ui.ts`
- Test: `tests/usage-ui.test.ts` (create)
- Modify: `src/app/DashboardClient.tsx` (imports, state, poll effect, render after the `stats-row` block ~line 256)
- Modify: `src/styles/globals.css` (append gauge styles)

- [ ] **Step 1: Write the failing test**

Create `tests/usage-ui.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gaugeLevel } from "@/lib/usage-ui";

describe("gaugeLevel", () => {
  it("is blocked when rate-limited regardless of pct", () => {
    expect(gaugeLevel(0.1, true)).toBe("blocked");
  });
  it("is warn at or above 80%", () => {
    expect(gaugeLevel(0.8, false)).toBe("warn");
    expect(gaugeLevel(0.95, false)).toBe("warn");
  });
  it("is ok below 80%", () => {
    expect(gaugeLevel(0.79, false)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/usage-ui.test.ts`
Expected: FAIL — `@/lib/usage-ui` does not exist.

- [ ] **Step 3: Create the pure helper**

Create `src/lib/usage-ui.ts`:

```ts
export type GaugeLevel = "ok" | "warn" | "blocked";

export function gaugeLevel(pct: number, rateLimited: boolean): GaugeLevel {
  if (rateLimited) return "blocked";
  if (pct >= 0.8) return "warn";
  return "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/usage-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the gauge into DashboardClient**

In `src/app/DashboardClient.tsx`:

Add to the imports at the top:

```tsx
import { gaugeLevel } from "@/lib/usage-ui";
```

Inside the component, near the other `useState` declarations, add:

```tsx
  interface UsageState {
    tokens: number;
    dailyLimit: number;
    pct: number;
    warn: boolean;
    rateLimited: boolean;
    retryAt: number;
  }
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const warnedRef = useRef(false);

  const enableAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setAlertsEnabled(perm === "granted");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const u: UsageState = await fetch("/api/usage").then((r) => r.json());
        if (cancelled) return;
        setUsage(u);
        if (u.warn && !warnedRef.current) {
          warnedRef.current = true;
          if (
            alertsEnabled &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification("JobBot", {
              body: `${Math.round(u.pct * 100)}% of your daily ${u.dailyLimit.toLocaleString()} token limit used.`,
            });
          }
        }
        if (!u.warn) warnedRef.current = false;
      } catch {
        // retry next tick
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [alertsEnabled]);
```

Insert this JSX immediately **after** the closing `</div>` of the `{/* Stats Row */}` block (after line ~256, before `{/* Campaign Controls */}`):

```tsx
      {/* Daily API limit gauge */}
      {usage && (
        <div className={`limit-gauge ${gaugeLevel(usage.pct, usage.rateLimited)}`}>
          <div className="limit-gauge-head">
            <span>
              Daily API usage ({usage.tokens.toLocaleString()} /{" "}
              {usage.dailyLimit.toLocaleString()} tokens)
            </span>
            <span>{Math.round(usage.pct * 100)}%</span>
          </div>
          <div className="limit-gauge-track">
            <div
              className="limit-gauge-fill"
              style={{ width: `${Math.min(usage.pct * 100, 100)}%` }}
            />
          </div>
          {usage.rateLimited && usage.retryAt > Date.now() && (
            <p className="limit-gauge-note">
              ⚠ Rate-limited — runs auto-stopped. Resets ~
              {new Date(usage.retryAt).toLocaleTimeString()}.
            </p>
          )}
          {typeof window !== "undefined" &&
            "Notification" in window &&
            !alertsEnabled && (
              <button
                type="button"
                className="limit-gauge-alerts"
                onClick={enableAlerts}
              >
                Enable alerts
              </button>
            )}
        </div>
      )}
```

- [ ] **Step 6: Add gauge styles**

Append to `src/styles/globals.css`:

```css
/* Daily API limit gauge */
.limit-gauge {
  margin: 1rem 0;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  background: var(--clr-surface, #1b1b1f);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.limit-gauge-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}
.limit-gauge-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.limit-gauge-fill {
  height: 100%;
  background: var(--clr-accent, #4f8cff);
  transition: width 0.4s ease;
}
.limit-gauge.warn .limit-gauge-fill {
  background: #f5a623;
}
.limit-gauge.blocked .limit-gauge-fill {
  background: var(--clr-danger, #e5484d);
}
.limit-gauge-note {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--clr-danger, #e5484d);
}
.limit-gauge-alerts {
  margin-top: 0.5rem;
  font-size: 0.78rem;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: inherit;
  border-radius: 6px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
}
```

- [ ] **Step 7: Typecheck + run the full unit suite**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/usage-ui.ts tests/usage-ui.test.ts src/app/DashboardClient.tsx src/styles/globals.css
git commit -m "feat: dashboard daily-limit gauge with alerts"
```

---

### Task 7: E2E — gauge renders on the dashboard

**Files:**
- Modify: `tests/e2e/app.spec.ts` (append a test)

- [ ] **Step 1: Add the E2E test**

Append to `tests/e2e/app.spec.ts` (match the file's existing `test`/`expect` import style):

```ts
test("dashboard shows the daily API usage gauge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Daily API usage/)).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `npx playwright test tests/e2e/app.spec.ts`
Expected: PASS — `/api/usage` always returns a payload (tokens default 0 with no active model), so the gauge renders deterministically.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "test: e2e coverage for daily-limit gauge"
```

---

### Task 8: Real-key end-to-end verification (mandatory)

Per project rule: never claim done without exercising the real Groq path. This task is manual verification, not code.

- [ ] **Step 1: Configure a real key**

Put a working key in `.env` (`GROQ_API_KEY=...`) and set Settings → active provider to Groq. Optionally set a low `daily_token_limit` (e.g. `3000`) to make the gauge move visibly.

- [ ] **Step 2: Run the app and start a short campaign**

Run: `npm run dev` then open `http://localhost:3000`, start a campaign with one title/location. Watch the gauge: `tokens` should increase by real per-call counts (not by 1s) as fit analysis runs.

- [ ] **Step 3: Verify the warning fires**

With a low limit, confirm the gauge turns amber at ≥80% and — if "Enable alerts" was clicked and permission granted — a desktop notification appears once.

- [ ] **Step 4: Verify auto-stop**

Drive usage to the cap (or wait for a real daily 429). Confirm: the campaign flips to `stopped` with `stop_reason = "rate_limited"`, the gauge shows the red "runs auto-stopped" note, and fit-retries stay paused. Confirm a *transient* (sub-5-minute) limit does **not** stop the campaign — it pauses and resumes.

- [ ] **Step 5: Record the result**

Note the observed token counts and behaviors in the PR description.

---

## Self-Review

- **Spec coverage:** token tracking (Task 1–2), tiered auto-stop (Task 3), usage API (Task 4), configurable cap (Task 5), gauge + gesture-gated desktop/in-app notification (Task 6), E2E (Task 7), real-key smoke (Task 8). All spec sections map to a task. ✅
- **Placeholders:** none — every code step shows full code and exact commands. ✅
- **Type consistency:** `ApiUsageToday {counts, tokensByModel}` produced in Task 1 and consumed in Tasks 3–4; `incrementApiUsage(modelKey, tokens=0)` matches `trackUsage`/`maybeStopForDailyExhaustion` callers; `LlmResult {text, tokens}` consistent across `callers`/`withValidation`/`callProvider`; usage payload fields (`tokens`,`dailyLimit`,`pct`,`warn`,`rateLimited`,`retryAt`) identical in route (Task 4) and `UsageState` (Task 6); `gaugeLevel(pct, rateLimited)` signature matches its call site. ✅
