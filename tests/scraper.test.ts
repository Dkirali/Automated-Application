import { describe, it, expect } from "vitest";
import { buildSearchUrl, isEasyApplyText, type SearchFilters } from "@/lib/scraper";

describe("buildSearchUrl", () => {
  it("builds basic search URL", () => {
    const url = buildSearchUrl(["Software Engineer"], { location_text: "New York" });
    expect(url).toContain("linkedin.com/jobs/search/");
    expect(url).toContain("keywords=Software+Engineer");
    expect(url).toContain("location=New+York");
  });

  it("joins multiple titles with OR", () => {
    const url = buildSearchUrl(["Dev", "Engineer"], {});
    expect(url).toContain("keywords=Dev+OR+Engineer");
  });

  it("includes work type filter", () => {
    const url = buildSearchUrl(["Dev"], { work_types: ["1", "2"] });
    expect(url).toContain("f_WT=1%2C2");
  });

  it("includes experience level filter", () => {
    const url = buildSearchUrl(["Dev"], { experience_levels: ["3", "4"] });
    expect(url).toContain("f_E=3%2C4");
  });

  it("includes date posted filter", () => {
    const url = buildSearchUrl(["Dev"], { date_posted: "r604800" });
    expect(url).toContain("f_TPR=r604800");
  });

  it("includes pagination start", () => {
    const url = buildSearchUrl(["Dev"], {}, 25);
    expect(url).toContain("start=25");
  });
});

describe("isEasyApplyText", () => {
  it("matches exact Easy Apply", () => {
    expect(isEasyApplyText("Easy Apply")).toBe(true);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(isEasyApplyText("  easy apply  ")).toBe(true);
    expect(isEasyApplyText("EASY APPLY")).toBe(true);
    expect(isEasyApplyText("\n\tEasy Apply\n")).toBe(true);
  });

  it("matches when an icon glyph precedes the label", () => {
    expect(isEasyApplyText("⚡ Easy Apply")).toBe(true);
    expect(isEasyApplyText("Easy Apply ↗")).toBe(true);
  });

  it("rejects plain Apply (external apply button)", () => {
    expect(isEasyApplyText("Apply")).toBe(false);
    expect(isEasyApplyText("  APPLY  ")).toBe(false);
  });

  it("rejects unrelated button text", () => {
    expect(isEasyApplyText("Apply on company site")).toBe(false);
    expect(isEasyApplyText("Save")).toBe(false);
    expect(isEasyApplyText("")).toBe(false);
  });

  it("rejects substring false-positives like 'Easy Applying'", () => {
    expect(isEasyApplyText("Easy Applying")).toBe(false);
  });
});
