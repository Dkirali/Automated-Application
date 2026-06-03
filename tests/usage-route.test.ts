import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, setConfig, getConfig, incrementApiUsage, getApiUsageTotalsToday } from "@/lib/db";
import { getRateLimitState, clearRateLimit } from "@/lib/resume";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
  setConfig("active_provider", "groq");
  // Reset the in-memory back-off so rate-limit tests don't bleed across runs.
  clearRateLimit();
});

describe("getApiUsageTotalsToday", () => {
  it("sums tokens and calls across all models for today", () => {
    incrementApiUsage("groq/llama-3.3-70b", 1000);
    incrementApiUsage("groq/llama-3.1-8b", 2000);
    incrementApiUsage("groq/llama-3.1-8b", 500);
    const totals = getApiUsageTotalsToday();
    expect(totals.tokens).toBe(3500);
    expect(totals.calls).toBe(3);
  });
});

describe("/api/usage", () => {
  it("aggregates tokens across all models (not just the active one)", async () => {
    setConfig("daily_token_limit", "10000");
    // Fit scoring burns the FAST model; tailoring the ACTIVE model.
    incrementApiUsage("groq/llama-3.1-8b", 8000);
    incrementApiUsage("groq/llama-3.3-70b", 500);
    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.tokens).toBe(8500);
    expect(body.calls).toBe(2);
    expect(body.dailyLimit).toBe(10000);
    expect(body.pct).toBeCloseTo(0.85, 2);
    expect(body.warn).toBe(true);
  });

  it("warn=false below 80%", async () => {
    setConfig("daily_token_limit", "10000");
    incrementApiUsage("groq/llama-3.1-8b", 1000);
    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.warn).toBe(false);
  });

  it("daily_token_limit of 0 disables the cap (no warn, pct 0)", async () => {
    setConfig("daily_token_limit", "0");
    incrementApiUsage("groq/llama-3.1-8b", 99999);
    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.dailyLimit).toBe(0);
    expect(body.pct).toBe(0);
    expect(body.warn).toBe(false);
  });
});

describe("rate-limit reset persistence", () => {
  it("rehydrates a persisted reset from DB after a restart", async () => {
    // Simulate a prior process having registered a daily back-off.
    const future = Date.now() + 60 * 60_000;
    setConfig("rate_limit_reset_at", String(future));
    setConfig("rate_limit_msg", "try again in 60m");

    const rl = getRateLimitState();
    expect(rl.rateLimited).toBe(true);
    expect(rl.retryAt).toBe(future);
    expect(rl.message).toContain("try again");

    const { GET } = await import("@/app/api/usage/route");
    const body = await (await GET()).json();
    expect(body.rateLimited).toBe(true);
    expect(body.resetAt).toBe(future);
  });

  it("clearRateLimit clears both memory and persisted state", () => {
    setConfig("rate_limit_reset_at", String(Date.now() + 60 * 60_000));
    getRateLimitState(); // hydrate into memory
    clearRateLimit();
    expect(getRateLimitState().rateLimited).toBe(false);
    expect(getConfig("rate_limit_reset_at")).toBe("0");
  });

  it("ignores a persisted reset that is already in the past", () => {
    setConfig("rate_limit_reset_at", String(Date.now() - 1000));
    expect(getRateLimitState().rateLimited).toBe(false);
  });
});
