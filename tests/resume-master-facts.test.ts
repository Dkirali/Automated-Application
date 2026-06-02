import { describe, it, expect } from "vitest";
import { extractMasterFacts, validateTailoredResume, deriveLatestTitle } from "@/lib/resume";

// Mirrors how pdf-parse flattens a real multi-column resume: the "Languages"
// heading is immediately followed by a concatenated heading glob
// ("CertificatesInternships") and the certificates/education/dates content is
// scattered into the same region. Regression for "Tailoring failed —
// Missing language: CertificatesInternships / CS50:Intro to Computer / April 2018".
const SCRAMBLED_MASTER = [
  "PROFESSIONAL EXPERIENCE",
  "Acme Corp",
  "Product Manager Toronto, Canada Jan 2020 - Present",
  "EDUCATION",
  "University of Guelph",
  "BComm Guelph, Canada 2013 - 2017",
  "LANGUAGES",
  "CertificatesInternships",
  "Turkish  -  Native",
  "English - Native",
  "Python Data Structures",
  "University of Michigan",
  "CS50:Intro to Computer",
  "Science",
  "Harvard",
  "April 2018",
  "Coca - ColaBottling",
  "Toronto, Canada",
  "Jun 2015 - Aug 2015",
].join("\n");

describe("extractMasterFacts — languages", () => {
  it("collects only genuine '<language> - <proficiency>' entries", () => {
    const facts = extractMasterFacts(SCRAMBLED_MASTER);
    expect(facts.languages).toEqual(["Turkish", "English"]);
  });

  it("does not capture headings, course names, or dates as languages", () => {
    const facts = extractMasterFacts(SCRAMBLED_MASTER);
    const joined = facts.languages.join("|");
    expect(joined).not.toMatch(/Certificates|CS50|April|Coca/);
  });
});

describe("validateTailoredResume — languages", () => {
  const facts = {
    roles: [],
    additionalRoles: [],
    education: [],
    languages: ["Turkish", "English"],
    certificates: [],
  };
  const headings = [
    "PROFESSIONAL EXPERIENCE",
    "ADDITIONAL EXPERIENCE",
    "EDUCATION",
    "SKILLS",
    "CERTIFICATES",
    "LANGUAGES",
  ].join("\n");

  it("passes when both languages survive into the output", () => {
    const out = `${headings}\nTurkish - Native\nEnglish - Native`;
    expect(validateTailoredResume(out, facts).ok).toBe(true);
  });

  it("flags a genuinely dropped language", () => {
    const out = `${headings}\nEnglish - Native`;
    const res = validateTailoredResume(out, facts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toContain("Missing language: Turkish");
  });
});

describe("deriveLatestTitle", () => {
  // Real tailored-text shape: "Company | Location | Dates" then the role title.
  const tailored = [
    "PROFESSIONAL EXPERIENCE",
    "Ingram Micro | Toronto, Canada | Dec 2018 – Jan 2021",
    "Product Operations Manager",
    "• did things",
    "Styx Intelligence | Vancouver, Canada | Sep 2021 – Jan 2026",
    "Head of Product",
    "• led things",
    "Mosaic | Toronto, Canada | 2018",
    "Coordinator",
  ].join("\n");

  it("returns the title of the latest-dated role", () => {
    expect(deriveLatestTitle(tailored)).toBe("Head of Product");
  });

  it("treats 'Present' as the most recent", () => {
    const t = [
      "Acme | NY | Jan 2015 – Dec 2030",
      "Old Role",
      "Beta | SF | Mar 2020 – Present",
      "Current Role",
    ].join("\n");
    expect(deriveLatestTitle(t)).toBe("Current Role");
  });
});
