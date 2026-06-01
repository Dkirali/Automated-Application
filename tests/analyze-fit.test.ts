import { describe, it, expect } from "vitest";
import { buildFitResult } from "@/lib/resume";

const resume = `Jane Doe
jane@example.com

PROFESSIONAL EXPERIENCE
Acme | New York | Jan 2020 – Dec 2024
Senior Engineer
• Built TypeScript and Node.js services

EDUCATION
MIT | Cambridge | 2014 – 2018
BSc Computer Science

SKILLS
TypeScript, Node.js, React`;

describe("buildFitResult (merged fit parsing)", () => {
  it("builds scores + rationale from one combined JSON object", () => {
    const parsed = {
      required_keywords: ["TypeScript", "Node.js"],
      preferred_keywords: ["React"],
      hard_requirements: [
        { text: "BSc Computer Science", met: true, evidence: "BSc Computer Science" },
      ],
      jd_summary: "Backend engineering role.",
      strengths: ["TypeScript", "Node.js"],
      gaps: ["Kubernetes"],
      verdict: "Strong match — apply.",
    };

    const { scores, rationale } = buildFitResult(parsed, resume);

    // Deterministic scoring still flows from the extracted keywords.
    expect(scores.requirements.required_keywords).toEqual(["TypeScript", "Node.js"]);
    expect(scores.keywordScore).toBeGreaterThan(0);
    expect(scores.fitScore).toBeGreaterThan(0);

    // Rationale fields parsed from the same object.
    expect(rationale.strengths).toEqual(["TypeScript", "Node.js"]);
    expect(rationale.gaps).toEqual(["Kubernetes"]);
    expect(rationale.verdict).toBe("Strong match — apply.");
    expect(rationale.jdSummary).toBe("Backend engineering role.");
    expect(rationale.raw).toContain("VERDICT: Strong match — apply.");
  });

  it("degrades gracefully when the model returns an empty/garbage object", () => {
    const { scores, rationale } = buildFitResult({}, resume);
    expect(scores.requirements.required_keywords).toEqual([]);
    expect(rationale.strengths).toEqual([]);
    expect(rationale.verdict).toBe("");
    // Parseability is computed from the resume itself, so it survives.
    expect(scores.parseabilityScore).toBeGreaterThan(0);
  });
});
