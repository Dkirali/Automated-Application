import { describe, it, expect } from "vitest";
import { buildSearchUrl, type SearchFilters } from "@/lib/scraper";

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
