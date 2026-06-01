import { describe, it, expect } from "vitest";
import { classifyEasyApply } from "@/lib/scraper";

// Signals taken verbatim from real LinkedIn DOM snapshots.
describe("classifyEasyApply", () => {
  it("Easy Apply: linkedin-bug icon (Tıkla Gelsin / Jobgether cases)", () => {
    expect(
      classifyEasyApply({
        ariaLabel: "LinkedIn Apply to Senior Product Manager at Tıkla Gelsin",
        hasLinkedinBug: true,
        hasExternalIcon: false,
        role: "",
      })
    ).toBe(true);
  });

  it("External: link-external icon + 'on company website' (Canonical case)", () => {
    expect(
      classifyEasyApply({
        ariaLabel: "Apply to Technical Product Manager on company website",
        hasLinkedinBug: false,
        hasExternalIcon: true,
        role: "link",
      })
    ).toBe(false);
  });

  it("Easy Apply via aria text even if the icon flag is missed", () => {
    expect(
      classifyEasyApply({
        ariaLabel: "LinkedIn Apply to AI Product Manager / Owner at Jobgether",
        hasLinkedinBug: false,
        hasExternalIcon: false,
        role: "",
      })
    ).toBe(true);
  });

  it("External wins even with a stray easy hint when 'on company website'", () => {
    expect(
      classifyEasyApply({
        ariaLabel: "Easy apply on company website",
        hasLinkedinBug: false,
        hasExternalIcon: true,
        role: "link",
      })
    ).toBe(false);
  });

  it("Ambiguous button → not easy apply", () => {
    expect(
      classifyEasyApply({
        ariaLabel: "Apply",
        hasLinkedinBug: false,
        hasExternalIcon: false,
        role: "",
      })
    ).toBe(false);
  });
});
