import { describe, it, expect } from "vitest";
import { StopSignal, classifyStopSignal } from "@/lib/safety";

describe("classifyStopSignal", () => {
  it("maps known signals", () => {
    expect(classifyStopSignal("captcha")).toBe(StopSignal.CAPTCHA);
    expect(classifyStopSignal("login_redirect")).toBe(StopSignal.SESSION_EXPIRED);
    expect(classifyStopSignal("rate_limit")).toBe(StopSignal.RATE_LIMITED);
    expect(classifyStopSignal("repeated_failures")).toBe(StopSignal.REPEATED_FAILURES);
    expect(classifyStopSignal("account_restricted")).toBe(StopSignal.ACCOUNT_RESTRICTED);
  });

  it("returns null for unknown signals", () => {
    expect(classifyStopSignal("unknown")).toBeNull();
  });
});
