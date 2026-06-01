import { matchesKeyword } from "./resume";

export interface HardRequirement {
  text: string;
  met: boolean;
  evidence?: string;
}

export interface JobRequirements {
  required_keywords: string[];
  preferred_keywords: string[];
  hard_requirements: HardRequirement[];
}

export interface KeywordCoverage {
  score: number;
  requiredHits: string[];
  requiredMisses: string[];
  preferredHits: string[];
  preferredMisses: string[];
}

// Sections an ATS-friendly master resume should have. ADDITIONAL EXPERIENCE
// is intentionally excluded — many candidates only have one experience section.
const REQUIRED_SECTIONS = [
  "PROFESSIONAL EXPERIENCE",
  "EDUCATION",
  "SKILLS",
  "CERTIFICATES",
  "LANGUAGES",
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(\+\d[\d\s().-]{6,}\d)/;
const PROFILE_RE = /(linkedin\.com\/in\/|github\.com\/)\S+/i;
// Matches "2020 – 2024", "Jan 2020 – Dec 2024", "Sep 2021 – Present"
const DATE_RANGE_RE =
  /\b(?:[A-Z][a-z]{2,9}\s+)?\d{4}\s*[–-]\s*(?:[A-Z][a-z]{2,9}\s+)?(?:\d{4}|Present|Current)\b/;

const PARSEABILITY_WEIGHTS = {
  sections: 60, // 10 per section, 6 sections
  email: 10,
  phone: 5,
  profile: 5,
  date: 10,
  header: 10,
};

export function calculateParseability(resumeText: string): number {
  const text = resumeText || "";
  if (!text.trim()) return 0;

  let score = 0;

  // Sections — 10 each
  const sectionPoints = PARSEABILITY_WEIGHTS.sections / REQUIRED_SECTIONS.length;
  for (const section of REQUIRED_SECTIONS) {
    const re = new RegExp(`^\\s*${section}\\s*$`, "im");
    if (re.test(text)) score += sectionPoints;
  }

  if (EMAIL_RE.test(text)) score += PARSEABILITY_WEIGHTS.email;
  if (PHONE_RE.test(text)) score += PARSEABILITY_WEIGHTS.phone;
  if (PROFILE_RE.test(text)) score += PARSEABILITY_WEIGHTS.profile;
  if (DATE_RANGE_RE.test(text)) score += PARSEABILITY_WEIGHTS.date;

  // Header: first non-empty line looks like a name (2-4 capitalized words)
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";
  if (/^[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3}$/.test(firstLine)) {
    score += PARSEABILITY_WEIGHTS.header;
  }

  return Math.round(score);
}

export function calculateKeywordCoverage(
  required: string[],
  preferred: string[],
  resumeText: string
): KeywordCoverage {
  const requiredHits: string[] = [];
  const requiredMisses: string[] = [];
  const preferredHits: string[] = [];
  const preferredMisses: string[] = [];

  for (const kw of required) {
    (matchesKeyword(kw, resumeText) ? requiredHits : requiredMisses).push(kw);
  }
  for (const kw of preferred) {
    (matchesKeyword(kw, resumeText) ? preferredHits : preferredMisses).push(kw);
  }

  const numerator = 2 * requiredHits.length + preferredHits.length;
  const denominator = 2 * required.length + preferred.length;
  const score = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

  return { score, requiredHits, requiredMisses, preferredHits, preferredMisses };
}

export function calculateHardReqScore(reqs: HardRequirement[]): number {
  if (reqs.length === 0) return 100;
  const met = reqs.filter((r) => r.met).length;
  return Math.round((met / reqs.length) * 100);
}

const BLEND_WEIGHTS = { keyword: 0.5, hardreq: 0.3, parseability: 0.2 };

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function blendFitScore(
  keyword: number,
  hardreq: number,
  parseability: number
): number {
  return Math.round(
    BLEND_WEIGHTS.keyword * clamp(keyword) +
      BLEND_WEIGHTS.hardreq * clamp(hardreq) +
      BLEND_WEIGHTS.parseability * clamp(parseability)
  );
}
