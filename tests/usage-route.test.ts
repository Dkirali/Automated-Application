import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, setConfig, incrementApiUsage, getApiUsageTotalsToday } from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
  setConfig("active_provider", "groq");
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
});
