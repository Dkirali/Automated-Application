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
