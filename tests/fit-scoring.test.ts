import { describe, it, expect } from "vitest";
import {
  calculateParseability,
  calculateKeywordCoverage,
  calculateHardReqScore,
  blendFitScore,
  type HardRequirement,
} from "@/lib/fit-scoring";

describe("calculateParseability", () => {
  it("returns 100 for a resume with all required sections, contact, and parseable dates", () => {
    const resume = `Jane Doe
jane@example.com • +1 555 000 0000 • linkedin.com/in/janedoe

PROFESSIONAL EXPERIENCE
Acme | New York | Jan 2020 – Dec 2024
Senior Engineer
• Led things

EDUCATION
MIT | Cambridge | 2014 – 2018
BSc Computer Science

SKILLS
TypeScript, Node.js

CERTIFICATES
AWS Solutions Architect

LANGUAGES
English – Native`;
    expect(calculateParseability(resume)).toBe(100);
  });

  it("docks points for missing required section headings", () => {
    const partial = `Jane Doe
jane@example.com

PROFESSIONAL EXPERIENCE
Acme | NYC | Jan 2020 – Dec 2024
Engineer
• Stuff`;
    expect(calculateParseability(partial)).toBeLessThan(100);
  });

  it("docks points for missing email", () => {
    const noEmail = `Jane Doe
+1 555 000 0000

PROFESSIONAL EXPERIENCE
EDUCATION
SKILLS
CERTIFICATES
LANGUAGES`;
    const withEmail = `Jane Doe
jane@example.com

PROFESSIONAL EXPERIENCE
EDUCATION
SKILLS
CERTIFICATES
LANGUAGES`;
    expect(calculateParseability(noEmail)).toBeLessThan(calculateParseability(withEmail));
  });

  it("returns 0 for empty input", () => {
    expect(calculateParseability("")).toBe(0);
  });
});

describe("calculateKeywordCoverage", () => {
  const resume = "Led Python and TypeScript projects on AWS. Built React components.";

  it("scores 100 when all required and preferred keywords match", () => {
    const r = calculateKeywordCoverage(["Python", "AWS"], ["React"], resume);
    expect(r.score).toBe(100);
    expect(r.requiredHits).toEqual(["Python", "AWS"]);
    expect(r.preferredHits).toEqual(["React"]);
  });

  it("weights required keywords 2x", () => {
    // 1 of 2 required hit + 0 of 1 preferred = (2·1 + 0) / (2·2 + 1) = 2/5 = 40
    const r = calculateKeywordCoverage(["Python", "Kubernetes"], ["Helm"], resume);
    expect(r.score).toBe(40);
    expect(r.requiredHits).toEqual(["Python"]);
    expect(r.requiredMisses).toEqual(["Kubernetes"]);
  });

  it("returns 0 when no required and no preferred keywords are given", () => {
    const r = calculateKeywordCoverage([], [], resume);
    expect(r.score).toBe(0);
  });

  it("handles only preferred keywords (no required) without dividing by zero", () => {
    const r = calculateKeywordCoverage([], ["React", "Vue"], resume);
    // 1 of 2 preferred = (0 + 1) / (0 + 2) = 50
    expect(r.score).toBe(50);
  });

  it("is case-insensitive on matching", () => {
    const r = calculateKeywordCoverage(["python"], [], "I love PYTHON.");
    expect(r.score).toBe(100);
  });
});

describe("calculateHardReqScore", () => {
  it("returns 100 when every requirement is met", () => {
    const reqs: HardRequirement[] = [
      { text: "5+ years Python", met: true },
      { text: "BSc in CS", met: true },
    ];
    expect(calculateHardReqScore(reqs)).toBe(100);
  });

  it("returns 0 when none are met", () => {
    const reqs: HardRequirement[] = [
      { text: "5+ years Python", met: false },
      { text: "BSc in CS", met: false },
    ];
    expect(calculateHardReqScore(reqs)).toBe(0);
  });

  it("returns the rounded percentage met", () => {
    const reqs: HardRequirement[] = [
      { text: "A", met: true },
      { text: "B", met: true },
      { text: "C", met: false },
    ];
    expect(calculateHardReqScore(reqs)).toBe(67);
  });

  it("returns 100 when there are no hard requirements (don't penalize)", () => {
    expect(calculateHardReqScore([])).toBe(100);
  });
});

describe("blendFitScore", () => {
  it("applies the 0.5/0.3/0.2 weighting", () => {
    expect(blendFitScore(100, 100, 100)).toBe(100);
    expect(blendFitScore(0, 0, 0)).toBe(0);
    // 0.5*80 + 0.3*60 + 0.2*40 = 40 + 18 + 8 = 66
    expect(blendFitScore(80, 60, 40)).toBe(66);
  });

  it("clamps inputs to 0-100", () => {
    expect(blendFitScore(150, -10, 50)).toBe(blendFitScore(100, 0, 50));
  });

  it("rounds to an integer", () => {
    // 0.5*33 + 0.3*33 + 0.2*33 = 33.0
    expect(blendFitScore(33, 33, 33)).toBe(33);
    // 0.5*33 + 0.3*66 + 0.2*99 = 16.5 + 19.8 + 19.8 = 56.1 → 56
    expect(blendFitScore(33, 66, 99)).toBe(56);
  });
});
