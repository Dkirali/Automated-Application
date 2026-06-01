import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, setConfig } from "@/lib/db";
import { getActiveModel, getFastModel } from "@/lib/resume";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
});

describe("per-task model routing", () => {
  it("routes groq fit work to llama-3.1-8b, distinct from the default 70b", () => {
    setConfig("active_provider", "groq");
    expect(getActiveModel()?.modelId).toBe("llama-3.3-70b-versatile");

    const fast = getFastModel();
    expect(fast?.modelId).toBe("llama-3.1-8b-instant");
    expect(fast?.usageKey).toBe("groq/llama-3.1-8b");
    // Same credentials/provider — only the model id differs.
    expect(fast?.envKey).toBe("GROQ_API_KEY");
    expect(fast?.provider).toBe("groq");
  });

  it("uses a Haiku-tier fast model for anthropic", () => {
    setConfig("active_provider", "anthropic");
    expect(getFastModel()?.modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("returns null when no provider is active", () => {
    expect(getFastModel()).toBeNull();
  });
});
