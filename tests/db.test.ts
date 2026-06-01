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
