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
