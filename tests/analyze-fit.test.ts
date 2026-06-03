import { describe, it, expect } from "vitest";
import { buildFitResult, mapBatchFitResponse } from "@/lib/resume";

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

describe("mapBatchFitResponse (batch fit parsing)", () => {
  const batchRaw = JSON.stringify([
    {
      index: 0,
      required_keywords: ["TypeScript", "Node.js"],
      preferred_keywords: ["React"],
      hard_requirements: [],
      jd_summary: "Backend role.",
      strengths: ["TypeScript"],
      gaps: [],
      verdict: "Apply.",
    },
    {
      index: 1,
      required_keywords: ["Python"],
      preferred_keywords: [],
      hard_requirements: [],
      jd_summary: "Data role.",
      strengths: [],
      gaps: ["Python"],
      verdict: "Maybe.",
    },
  ]);

  it("maps each array element to its job by declared index", () => {
    const results = mapBatchFitResponse(batchRaw, 2, resume);
    expect(results).toHaveLength(2);
    expect(results[0]?.scores.requirements.required_keywords).toEqual(["TypeScript", "Node.js"]);
    expect(results[0]?.rationale.verdict).toBe("Apply.");
    expect(results[1]?.scores.requirements.required_keywords).toEqual(["Python"]);
    expect(results[1]?.rationale.jdSummary).toBe("Data role.");
  });

  it("tolerates code fences and reordered indices", () => {
    const reordered = "```json\n" + JSON.stringify([
      { index: 1, required_keywords: ["Python"], jd_summary: "Data role." },
      { index: 0, required_keywords: ["TypeScript"], jd_summary: "Backend role." },
    ]) + "\n```";
    const results = mapBatchFitResponse(reordered, 2, resume);
    expect(results[0]?.scores.requirements.required_keywords).toEqual(["TypeScript"]);
    expect(results[1]?.scores.requirements.required_keywords).toEqual(["Python"]);
  });

  it("a missing entry degrades to null without poisoning the others", () => {
    // Only job 0 came back; job 1 is omitted entirely.
    const partial = JSON.stringify([
      { index: 0, required_keywords: ["TypeScript"], jd_summary: "Backend role.", verdict: "Apply." },
    ]);
    const results = mapBatchFitResponse(partial, 2, resume);
    expect(results[0]?.rationale.verdict).toBe("Apply.");
    expect(results[1]).toBeNull();
  });

  it("returns all-null when the response isn't a parseable array", () => {
    const results = mapBatchFitResponse("the model said no", 3, resume);
    expect(results).toEqual([null, null, null]);
  });
});
