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
