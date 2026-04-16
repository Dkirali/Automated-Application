import { describe, it, expect } from "vitest";
import {
  extractKeywordsFromResponse,
  extractResumeFromResponse,
  calculateAtsScore,
  parseFitScore,
  parseFitField,
  stripMarkdown,
  matchesKeyword,
  extractMasterFacts,
  validateTailoredResume,
  normalizeDashes,
  parseCandidateHeader,
} from "@/lib/resume";

const MASTER_SAMPLE = `Doruk Kirali
Product Operations Manager
0532 286 04 61 • kiralidoruk@gmail.com

PROFESSIONAL EXPERIENCE

Styx Intelligence
Product Operations ManagerVancouver, Canada | Sep 2021 – Jan 2026
Led product vision.
Ran experiments.

Ingram Micro
Senior Sales Support (Product & Category Management)Toronto, Canada | Dec 2018 – Jan 2021
Owned Dell portfolio.

Mosaic North America
Retail Marketing CoordinatorToronto, Canada | Aug 2018 – Oct 2018
Gathered insights.

Additional Experience

Hometex & Floorex
Sales InternToronto, Canada | Jun 2015 – Aug 2015
Supported vendor acquisition.

Coca‑Cola Bottling
Marketing & Sales InternIstanbul, Turkey | Jun 2014 – Aug 2014
Assisted in product development.

EDUCATION

Brainstation
Web Development BootcampToronto, Canada | 2020 – 2021

University of Guelph
Bachelor of Marketing ManagementGuelph, Canada | 2013 – 2017

SKILLS
Product Vision • Research • Agile

CERTIFICATES
Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course

LANGUAGES
Turkish – Native
English – Native
`;

const VALID_TAILORED = `PROFESSIONAL EXPERIENCE

Styx Intelligence | Vancouver, Canada | Sep 2021 – Jan 2026
Product Operations Manager
• Led product vision and roadmap.

Ingram Micro | Toronto, Canada | Dec 2018 – Jan 2021
Senior Sales Support (Product & Category Management)
• Owned Dell portfolio.

Mosaic North America | Toronto, Canada | Aug 2018 – Oct 2018
Retail Marketing Coordinator
• Gathered insights.

ADDITIONAL EXPERIENCE

Hometex & Floorex | Toronto, Canada | Jun 2015 – Aug 2015
Sales Intern
• Supported vendor acquisition.

Coca‑Cola Bottling | Istanbul, Turkey | Jun 2014 – Aug 2014
Marketing & Sales Intern
• Assisted in product development.

EDUCATION

Brainstation | Toronto, Canada | 2020 – 2021
Web Development Bootcamp

University of Guelph | Guelph, Canada | 2013 – 2017
Bachelor of Marketing Management

SKILLS
Product Vision • Research • Agile

CERTIFICATES
Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course

LANGUAGES
Turkish – Native
English – Native
`;

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

describe("normalizeDashes", () => {
  it("converts hyphens between month-year ranges to en-dashes", () => {
    expect(normalizeDashes("Sep 2021 - Jan 2026")).toBe("Sep 2021 – Jan 2026");
    expect(normalizeDashes("Aug 2018 - Oct 2018")).toBe("Aug 2018 – Oct 2018");
  });

  it("converts hyphens between year-only ranges to en-dashes", () => {
    expect(normalizeDashes("2020 - 2021")).toBe("2020 – 2021");
  });

  it("leaves existing en-dashes untouched", () => {
    expect(normalizeDashes("Sep 2021 – Jan 2026")).toBe("Sep 2021 – Jan 2026");
  });

  it("does not rewrite hyphens outside date patterns", () => {
    expect(normalizeDashes("e-commerce site")).toBe("e-commerce site");
  });
});

describe("extractMasterFacts", () => {
  it("parses all three main roles with correct dates", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    expect(facts.roles).toHaveLength(3);
    expect(facts.roles[0]).toMatchObject({
      company: "Styx Intelligence",
      role: "Product Operations Manager",
      location: "Vancouver, Canada",
      dates: "Sep 2021 – Jan 2026",
    });
    expect(facts.roles[1]).toMatchObject({
      company: "Ingram Micro",
      dates: "Dec 2018 – Jan 2021",
    });
    expect(facts.roles[2]).toMatchObject({
      company: "Mosaic North America",
      dates: "Aug 2018 – Oct 2018",
    });
  });

  it("parses additional-experience roles separately", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    expect(facts.additionalRoles).toHaveLength(2);
    expect(facts.additionalRoles[0].company).toBe("Hometex & Floorex");
    expect(facts.additionalRoles[0].dates).toBe("Jun 2015 – Aug 2015");
    expect(facts.additionalRoles[1].company).toBe("Coca‑Cola Bottling");
  });

  it("parses education entries", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    expect(facts.education).toHaveLength(2);
    expect(facts.education[0].school).toBe("Brainstation");
    expect(facts.education[1].school).toBe("University of Guelph");
  });

  it("parses languages", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    expect(facts.languages).toContain("Turkish");
    expect(facts.languages).toContain("English");
  });

  it("parses tab-separated role lines (mammoth DOCX extraction format)", () => {
    // mammoth extracts tabbed role lines as "Role\tLocation | Dates"
    const tabbedMaster = `Doruk Kirali
Product Operations Manager
0532 286 04 61 • kiralidoruk@gmail.com

PROFESSIONAL EXPERIENCE

Styx Intelligence
Product Operations Manager\tVancouver, Canada | Sep 2021 – Jan 2026
Led product vision.

Ingram Micro
Senior Sales Support (Product & Category Management)\tToronto, Canada | Dec 2018 – Jan 2021
Owned Dell portfolio.

Mosaic North America
Retail Marketing Coordinator\tToronto, Canada | Aug 2018 – Oct 2018
Gathered insights.

Additional Experience

Coca‑Cola Bottling
Marketing & Sales Intern\tIstanbul, Turkey | Jun 2014 – Aug 2014
Assisted.

EDUCATION

Brainstation
Web Development Bootcamp\tToronto, Canada | 2020 – 2021

SKILLS
Product Vision

CERTIFICATES
Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course

LANGUAGES
Turkish
English
`;
    const facts = extractMasterFacts(tabbedMaster);
    expect(facts.roles[0]).toMatchObject({
      company: "Styx Intelligence",
      role: "Product Operations Manager",
      location: "Vancouver, Canada",
      dates: "Sep 2021 – Jan 2026",
    });
    expect(facts.roles[1].role).toBe(
      "Senior Sales Support (Product & Category Management)"
    );
    expect(facts.roles[2].role).toBe("Retail Marketing Coordinator");
    expect(facts.additionalRoles[0].role).toBe("Marketing & Sales Intern");
  });
});

describe("validateTailoredResume", () => {
  it("accepts a well-formed tailored resume", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const result = validateTailoredResume(VALID_TAILORED, facts);
    expect(result.ok).toBe(true);
  });

  it("rejects output with a REFERENCES section", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const withRefs = VALID_TAILORED + "\nREFERENCES\nJim Virgin, Ingram Micro\n";
    const result = validateTailoredResume(withRefs, facts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/REFERENCE/i);
    }
  });

  it("rejects output with swapped dates between roles", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    // swap Ingram and Mosaic dates
    const swapped = VALID_TAILORED
      .replace("Ingram Micro | Toronto, Canada | Dec 2018 – Jan 2021", "Ingram Micro | Toronto, Canada | Aug 2018 – Oct 2018")
      .replace("Mosaic North America | Toronto, Canada | Aug 2018 – Oct 2018", "Mosaic North America | Toronto, Canada | Dec 2018 – Jan 2021");
    const result = validateTailoredResume(swapped, facts);
    expect(result.ok).toBe(false);
  });

  it("rejects output missing a role", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const missing = VALID_TAILORED.replace(/Hometex & Floorex[\s\S]*?Supported vendor acquisition\./, "");
    const result = validateTailoredResume(missing, facts);
    expect(result.ok).toBe(false);
  });

  it("rejects output missing the Languages section", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const noLang = VALID_TAILORED.replace(/LANGUAGES[\s\S]*$/, "");
    const result = validateTailoredResume(noLang, facts);
    expect(result.ok).toBe(false);
  });

  it("rejects output missing both mandatory Udemy certificates", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const noUdemy = VALID_TAILORED.replace(/Udemy[^\n]*\n/g, "");
    const result = validateTailoredResume(noUdemy, facts);
    expect(result.ok).toBe(false);
  });
});

describe("parseCandidateHeader", () => {
  const fullHeaderText = `Jane Doe
Senior Engineer
+1 (555) 123-4567 • jane@example.com • linkedin.com/in/janedoe • github.com/janedoe

PROFESSIONAL EXPERIENCE

Acme Corp
Staff Engineer | San Francisco, USA | Jan 2022 – Dec 2025
Built things.
`;

  it("extracts all contact fields when present", () => {
    const facts = extractMasterFacts(fullHeaderText);
    const header = parseCandidateHeader(fullHeaderText, facts);
    expect(header.name).toBe("Jane Doe");
    expect(header.email).toBe("jane@example.com");
    expect(header.phone).toContain("555");
    expect(header.linkedin).toContain("linkedin.com/in/janedoe");
    expect(header.github).toContain("github.com/janedoe");
  });

  it("derives headline from the most recent role (first in PROFESSIONAL EXPERIENCE)", () => {
    const facts = extractMasterFacts(fullHeaderText);
    const header = parseCandidateHeader(fullHeaderText, facts);
    expect(header.headline).toBe("Staff Engineer");
  });

  it("skips missing optional fields (no phone, no github)", () => {
    const text = `Bob Smith
Manager
bob@example.com • linkedin.com/in/bob

PROFESSIONAL EXPERIENCE

Co
Role | City, Country | Jan 2020 – Dec 2024
Did work.
`;
    const facts = extractMasterFacts(text);
    const header = parseCandidateHeader(text, facts);
    expect(header.name).toBe("Bob Smith");
    expect(header.email).toBe("bob@example.com");
    expect(header.linkedin).toContain("linkedin.com/in/bob");
    expect(header.phone).toBeUndefined();
    expect(header.github).toBeUndefined();
  });

  it("returns undefined headline when no roles exist", () => {
    const text = `Solo Candidate
solo@example.com

EDUCATION

School
Degree | City, Country | 2020 – 2024
`;
    const facts = extractMasterFacts(text);
    const header = parseCandidateHeader(text, facts);
    expect(header.headline).toBeUndefined();
  });

  it("parses the real master-style header (bullet-separated contact line)", () => {
    const facts = extractMasterFacts(MASTER_SAMPLE);
    const header = parseCandidateHeader(MASTER_SAMPLE, facts);
    expect(header.name).toBe("Doruk Kirali");
    expect(header.email).toBe("kiralidoruk@gmail.com");
    expect(header.phone).toBe("0532 286 04 61");
    expect(header.headline).toBe("Product Operations Manager");
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
