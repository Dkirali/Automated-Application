import { describe, it, expect } from "vitest";
import { isAuthwallUrl } from "@/lib/scraper";

describe("isAuthwallUrl", () => {
  it("detects LinkedIn authwall / login / signup / checkpoint redirects", () => {
    expect(isAuthwallUrl("https://www.linkedin.com/authwall?trk=jobs")).toBe(true);
    expect(
      isAuthwallUrl("https://www.linkedin.com/login?session_redirect=%2Fjobs")
    ).toBe(true);
    expect(isAuthwallUrl("https://www.linkedin.com/uas/login")).toBe(true);
    expect(isAuthwallUrl("https://www.linkedin.com/signup/cold-join")).toBe(true);
    expect(
      isAuthwallUrl("https://www.linkedin.com/checkpoint/challenge/verify")
    ).toBe(true);
  });

  it("treats an authenticated jobs-search URL as NOT an authwall", () => {
    expect(
      isAuthwallUrl(
        "https://www.linkedin.com/jobs/search/?keywords=engineer&location=Remote"
      )
    ).toBe(false);
    expect(isAuthwallUrl("https://www.linkedin.com/feed/")).toBe(false);
  });
});
