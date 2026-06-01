import { describe, it, expect } from "vitest";
import { tokensUsedInWindow, hasTokenBudget } from "@/lib/resume";

describe("tokens-per-minute budget", () => {
  const now = 1_000_000;
  const window = [
    { t: now - 70_000, tokens: 5000 }, // expired (older than 60s)
    { t: now - 30_000, tokens: 2000 },
    { t: now - 5_000, tokens: 1500 },
  ];

  it("sums only tokens within the trailing 60s window", () => {
    expect(tokensUsedInWindow(window, now)).toBe(3500); // excludes the expired 5000
  });

  it("allows a call that fits under the per-minute cap", () => {
    expect(hasTokenBudget(window, now, 6000, 2000)).toBe(true); // 3500 + 2000 <= 6000
  });

  it("rejects a call that would exceed the cap", () => {
    expect(hasTokenBudget(window, now, 6000, 3000)).toBe(false); // 3500 + 3000 > 6000
  });

  it("treats exactly-at-cap as allowed", () => {
    expect(hasTokenBudget(window, now, 6000, 2500)).toBe(true); // 3500 + 2500 == 6000
  });

  it("an empty window has full budget", () => {
    expect(tokensUsedInWindow([], now)).toBe(0);
    expect(hasTokenBudget([], now, 6000, 5999)).toBe(true);
  });
});
