import { describe, it, expect } from "vitest";
import { extractTokenCount } from "@/lib/resume";
import { isDailyExhaustion, DAILY_STOP_THRESHOLD_MS } from "@/lib/resume";

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
