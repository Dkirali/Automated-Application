import { describe, it, expect } from "vitest";
import {
  extractKeywordsFromResponse,
  extractResumeFromResponse,
  calculateAtsScore,
  parseFitScore,
  parseFitField,
  stripMarkdown,
  matchesKeyword,
} from "@/lib/resume";

describe("extractKeywordsFromResponse", () => {
  it("extracts comma-separated keywords", () => {
    const response = "KEYWORDS: Python, React, TypeScript, Node.js\nRESUME:\nSome text";
    const keywords = extractKeywordsFromResponse(response);
    expect(keywords).toEqual(["Python", "React", "TypeScript", "Node.js"]);
  });

  it("returns empty array when no KEYWORDS line", () => {
    expect(extractKeywordsFromResponse("No keywords here")).toEqual([]);
  });

  it("trims whitespace from keywords", () => {
    const response = "KEYWORDS:  Python ,  React  ,TypeScript\nRESUME:\ntext";
    const keywords = extractKeywordsFromResponse(response);
    expect(keywords).toEqual(["Python", "React", "TypeScript"]);
  });
});

describe("extractResumeFromResponse", () => {
  it("extracts text after RESUME:", () => {
    const response = "KEYWORDS: Python\nRESUME:\nPROFESSIONAL EXPERIENCE\n- Built things";
    const resume = extractResumeFromResponse(response);
    expect(resume).toBe("PROFESSIONAL EXPERIENCE\n- Built things");
  });

  it("returns empty string when no RESUME:", () => {
    expect(extractResumeFromResponse("Just some text")).toBe("");
  });
});

describe("matchesKeyword", () => {
  it("matches short keywords with word boundaries", () => {
    expect(matchesKeyword("AI", "Built AI models")).toBe(true);
    expect(matchesKeyword("AI", "training systems")).toBe(false);
    expect(matchesKeyword("AI", "MAIN focus")).toBe(false);
  });

  it("matches longer keywords with substring", () => {
    expect(matchesKeyword("TypeScript", "Used TypeScript for frontend")).toBe(true);
    expect(matchesKeyword("React", "Built with React")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(matchesKeyword("python", "PYTHON developer")).toBe(true);
    expect(matchesKeyword("REACT", "react native")).toBe(true);
  });
});

describe("calculateAtsScore", () => {
  it("calculates percentage of matched keywords", () => {
    const keywords = ["Python", "React", "TypeScript", "Node.js"];
    const resume = "Expert in Python and React development";
    expect(calculateAtsScore(keywords, resume)).toBe(50);
  });

  it("returns 0 for empty keywords", () => {
    expect(calculateAtsScore([], "some text")).toBe(0);
  });

  it("returns 100 when all keywords match", () => {
    const keywords = ["Python", "React"];
    const resume = "Python and React developer";
    expect(calculateAtsScore(keywords, resume)).toBe(100);
  });
});

describe("parseFitScore", () => {
  it("extracts score from FIT_SCORE line", () => {
    const text = "FIT_SCORE: 75\nSTRENGTHS: Python, React";
    expect(parseFitScore(text)).toBe(75);
  });

  it("returns 0 when no FIT_SCORE", () => {
    expect(parseFitScore("no score here")).toBe(0);
  });
});

describe("parseFitField", () => {
  it("extracts field value", () => {
    const text = "FIT_SCORE: 75\nSTRENGTHS: Python, React\nGAPS: Docker\nVERDICT: Good fit";
    expect(parseFitField(text, "STRENGTHS")).toBe("Python, React");
    expect(parseFitField(text, "GAPS")).toBe("Docker");
    expect(parseFitField(text, "VERDICT")).toBe("Good fit");
  });

  it("returns empty string when field not found", () => {
    expect(parseFitField("no fields", "STRENGTHS")).toBe("");
  });
});

describe("stripMarkdown", () => {
  it("removes markdown headers", () => {
    expect(stripMarkdown("## Header\nContent")).toBe("Header\nContent");
  });

  it("removes bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
  });

  it("removes italic markers", () => {
    expect(stripMarkdown("*italic text*")).toBe("italic text");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });
});
