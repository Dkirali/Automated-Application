import { readFileSync, mkdirSync, writeFileSync, statSync } from "fs";
import { resolve, join } from "path";
import mammoth from "mammoth";
import { getConfig } from "./db";
import {
  blendFitScore,
  calculateHardReqScore,
  calculateKeywordCoverage,
  calculateParseability,
  type HardRequirement,
  type JobRequirements,
} from "./fit-scoring";

// ── Constants ───────────────────────────────────────────────────────────

const RESUMES_DIR = resolve(process.cwd(), "resumes");

const REQUIRED_SECTIONS = [
  "PROFESSIONAL EXPERIENCE",
  "ADDITIONAL EXPERIENCE",
  "EDUCATION",
  "SKILLS",
  "CERTIFICATES",
  "LANGUAGES",
];

export interface CandidateHeader {
  name?: string;
  headline?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
}

export interface RoleFact {
  company: string;
  role: string;
  location: string;
  dates: string;
}

export interface EducationFact {
  school: string;
  degree: string;
  location: string;
  dates: string;
}

export interface MasterResumeFacts {
  roles: RoleFact[];
  additionalRoles: RoleFact[];
  education: EducationFact[];
  languages: string[];
  certificates: string[];
}

function buildContactSkipPatterns(header: CandidateHeader): string[] {
  const parts: string[] = [];
  if (header.name) parts.push(header.name.toLowerCase());
  if (header.email) parts.push(header.email.toLowerCase());
  if (header.phone) {
    // Normalise to digit-only for partial matches
    const digits = header.phone.replace(/\D/g, "");
    if (digits.length >= 4) parts.push(digits.slice(0, Math.min(6, digits.length)));
    parts.push(header.phone.toLowerCase());
  }
  if (header.linkedin) parts.push(header.linkedin.toLowerCase());
  if (header.github) parts.push(header.github.toLowerCase());
  return parts;
}

// ── Active model (configured at onboarding) ────────────────────────────

export type ActiveProvider = "groq" | "anthropic" | "openrouter";

export interface ActiveModel {
  provider: ActiveProvider;
  modelId: string;
  displayName: string;
  envKey: string;
  usageKey: string;
  /** Free-tier tokens-per-minute budget — paces calls to avoid 429s. */
  tpm: number;
}

export const PROVIDER_MODELS: Record<ActiveProvider, ActiveModel> = {
  groq: {
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    displayName: "Groq / Llama 3.3 70B",
    envKey: "GROQ_API_KEY",
    usageKey: "groq/llama-3.3-70b",
    tpm: 12_000,
  },
  anthropic: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    displayName: "Anthropic / Claude Sonnet",
    envKey: "ANTHROPIC_API_KEY",
    usageKey: "anthropic/claude-sonnet",
    tpm: 20_000,
  },
  openrouter: {
    provider: "openrouter",
    modelId: "openai/gpt-oss-120b:free",
    displayName: "OpenRouter / GPT-OSS 120B",
    envKey: "OPENROUTER_API_KEY",
    usageKey: "openrouter/gpt-oss-120b",
    tpm: 20_000,
  },
};

export function getActiveProvider(): ActiveProvider | null {
  const raw = getConfig("active_provider");
  if (raw === "groq" || raw === "anthropic" || raw === "openrouter") return raw;
  return null;
}

export function getActiveModel(): ActiveModel | null {
  const provider = getActiveProvider();
  return provider ? PROVIDER_MODELS[provider] : null;
}

// Smaller, cheaper, higher-quota models for high-volume "cheap" work (fit
// scoring + rationale). Routing these off the flagship model preserves
// tailoring quality while giving the bulk of calls a separate, larger daily
// token budget (TPD is per-model). OpenRouter has no distinct fast tier here,
// so it reuses its default.
export const PROVIDER_FAST_MODELS: Record<ActiveProvider, ActiveModel> = {
  groq: {
    provider: "groq",
    modelId: "llama-3.1-8b-instant",
    displayName: "Groq / Llama 3.1 8B",
    envKey: "GROQ_API_KEY",
    usageKey: "groq/llama-3.1-8b",
    tpm: 6_000,
  },
  anthropic: {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    displayName: "Anthropic / Claude Haiku",
    envKey: "ANTHROPIC_API_KEY",
    usageKey: "anthropic/claude-haiku",
    tpm: 30_000,
  },
  openrouter: PROVIDER_MODELS.openrouter,
};

export function getFastModel(): ActiveModel | null {
  const provider = getActiveProvider();
  return provider ? PROVIDER_FAST_MODELS[provider] : null;
}

const EXTRACTOR_PROMPT = `You are an ATS analyst. Read the job posting and the candidate's resume, then output a strict JSON object — no preamble, no markdown, no commentary.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Output schema (return EXACTLY this shape):
{
  "required_keywords": [string, ...],   // skills/tools/methodologies the JD explicitly requires ("must have", "required", "5+ years of", "Requirements:")
  "preferred_keywords": [string, ...],  // nice-to-haves ("preferred", "bonus", "a plus", "nice to have")
  "hard_requirements": [
    {
      "text": string,        // the requirement as written or paraphrased (e.g. "5+ years of backend engineering", "Bachelor's degree in CS or related")
      "met": boolean,        // whether the candidate's resume satisfies it
      "evidence": string     // short quote/paraphrase from the resume that supports met=true, or empty string when met=false
    }, ...
  ]
}

Rules:
- 5-12 keywords total per list. Pull from the JD verbatim where possible — they are matched against the resume by ATS-style substring.
- Hard requirements are concrete, checkable constraints (years of experience, degrees, certifications, language fluency, legal work authorization, location). Soft preferences go in preferred_keywords instead.
- Set met=true ONLY when the resume provides clear evidence. When in doubt set met=false.
- Output ONLY the JSON object. No \`\`\` fences, no surrounding text.`;

// One call that does BOTH the ATS extraction (for deterministic scoring) and
// the human-readable rationale — used on the fresh-scrape path so each job
// costs one LLM call instead of two. Resumable retries still use the split
// extractJobRequirements / generateFitRationale functions.
const COMBINED_FIT_PROMPT = `You are an ATS analyst and senior recruiter. Read the job posting and the candidate's resume, then output a strict JSON object — no preamble, no markdown, no commentary.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Output schema (return EXACTLY this shape):
{
  "required_keywords": [string, ...],   // skills/tools the JD explicitly requires
  "preferred_keywords": [string, ...],  // nice-to-haves ("preferred", "a plus")
  "hard_requirements": [
    { "text": string, "met": boolean, "evidence": string }
  ],
  "jd_summary": string,                 // 2-3 sentence summary of the role, seniority, focus
  "strengths": [string, ...],           // 2-4 matching skills or experiences
  "gaps": [string, ...],                // 1-3 missing or weak areas (empty array if none)
  "verdict": string                     // one sentence: would you recommend applying? why?
}

Rules:
- 5-12 keywords total per list. Pull from the JD verbatim where possible — they are matched against the resume by ATS-style substring.
- Hard requirements are concrete, checkable constraints (years of experience, degrees, certifications, language fluency, work authorization, location). Soft preferences go in preferred_keywords instead.
- Set met=true ONLY when the resume provides clear evidence. When in doubt set met=false.
- Output ONLY the JSON object. No \`\`\` fences, no surrounding text.`;

const RATIONALE_PROMPT = `You are a senior recruiter writing a short opinion on a candidate's fit for a role. The numeric scoring is already done elsewhere — your job is the human-readable take.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Respond in this exact format (no extra text, no markdown):
JD_SUMMARY: <2-3 sentence summary of the role, seniority level, and key focus areas>
STRENGTHS: <comma-separated list of 2-4 matching skills or experiences>
GAPS: <comma-separated list of 1-3 missing or weak areas, or "None">
VERDICT: <one sentence — would you recommend applying? why?>`;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for reference; superseded by COMBINED_FIT_PROMPT
const _FIT_PROMPT = `You are a senior recruiter evaluating a candidate's fit for a role.

Job Posting:
{job_description}

Candidate Resume:
{resume_text}

Respond in this exact format (no extra text):
FIT_SCORE: <0-100>
STRENGTHS: <comma-separated list of 2-4 matching skills or experiences>
GAPS: <comma-separated list of 1-3 missing skills, or "None">
VERDICT: <one sentence — would you recommend applying? why?>
JD_SUMMARY: <2-3 sentence summary of the role, seniority level, and key focus areas>
JD_KEYWORDS: keyword1, keyword2, keyword3, ... <8-12 most important ATS/skills keywords from the job posting>
SKILLS_MATCH: <0-100>/100
SKILLS_RATIONALE: <one sentence explaining the skills score>
EXPERIENCE_MATCH: <0-100>/100
EXPERIENCE_RATIONALE: <one sentence explaining the experience score>
SENIORITY_MATCH: <0-100>/100
SENIORITY_RATIONALE: <one sentence explaining the seniority score>
TOOLS_MATCH: <0-100>/100
TOOLS_RATIONALE: <one sentence explaining the tools score>`;

const TAILOR_PROMPT = `You are an expert resume writer specialising in ATS optimisation.

Job Posting:
{job_description}

Current Resume:
{resume_text}

GROUND TRUTH (these facts are canonical — you MUST preserve every company, role, date, school, and language EXACTLY as listed; never swap dates between roles; never omit any entry):
{ground_truth}

Task:
1. Extract the 8-12 most important ATS keywords from the job posting (skills, tools, methodologies, titles).
2. Rewrite the experience bullet points to incorporate these keywords where truthful.
   CRITICAL RULES for keyword incorporation:
   - Keywords must appear as PART OF THE NATURAL SENTENCE describing what was done. Good: "Led sprint planning using Agile methodologies". Bad: "Led sprint planning, demonstrating Agile skills".
   - NEVER append keyword labels to the end of a sentence (e.g. "showcasing Operational Efficiency", "utilizing Stakeholder Management", "demonstrating Communication skills"). This reads as spam.
   - NEVER start or end a bullet with a generic phrase like "applying X and Y skills" or "ensuring effective Z". Instead, describe the ACTUAL WORK that used those skills.
   - Each bullet should describe a concrete action and result, not list skill categories.
   - If a keyword cannot be naturally woven into existing content, place it in the SKILLS section instead.
3. Only use the keyword "AI" where it genuinely refers to artificial intelligence concepts. Do NOT treat words like "main", "rain", or "training" as containing the keyword "AI".

FORBIDDEN (the output will be rejected if any of these occur):
- DO NOT add a REFERENCES or REFERENCE section. Never invent referee names.
- DO NOT invent certificates, schools, languages, companies, roles, or dates.
- DO NOT drop ANY company, role, education entry, or language present in GROUND TRUTH.
- DO NOT swap dates between roles. Each company's dates must match GROUND TRUTH verbatim.
- DO NOT use hyphen "-" in date ranges. Always use the en-dash "–".
- DO NOT include the candidate's name, phone, email, LinkedIn, or GitHub — the header is added separately.
- DO NOT invent entirely new roles or technologies not present anywhere in the resume.

REQUIRED OUTPUT STRUCTURE (use these section headings in this exact order, each on its own line, ALL CAPS):
PROFESSIONAL EXPERIENCE
ADDITIONAL EXPERIENCE
EDUCATION
SKILLS
CERTIFICATES
LANGUAGES

Per-role format inside PROFESSIONAL EXPERIENCE and ADDITIONAL EXPERIENCE:
Company Name | Location | Start – End
Role Title
• Bullet one
• Bullet two

Per-entry format inside EDUCATION:
School Name | Location | Start – End
Degree / Program

CERTIFICATES section MUST list every certificate present in the candidate's master resume verbatim (one per line). Do NOT add certificates the candidate does not hold.

LANGUAGES section MUST list every language from GROUND TRUTH, one per line, in the form:
<Language Name> – <Proficiency Level>

Respond in this exact format (no Markdown, no HTML, no extra commentary):
KEYWORDS: keyword1, keyword2, keyword3, ...
RESUME:
[Full rewritten resume as plain text, starting directly with "PROFESSIONAL EXPERIENCE"]`;

// ── Rate limiting ───────────────────────────────────────────────────────

// Groq free tier is 30 req/min = 1 every 2 s, applied per model. 2000 ms keeps
// us under the limit. Tracked per-model (see llmG.__jobbot_last_call) so that a
// slow flagship tailoring call doesn't delay fast fit-scoring calls.
const LLM_MIN_INTERVAL = 2000;

function trackUsage(usageKey: string, tokens: number = 0): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { incrementApiUsage } = require("./db"); // lazy: avoids circular import (db ← resume ← db)
    incrementApiUsage(usageKey, tokens);
  } catch {
    // non-critical
  }
}

// ── Pure parsing functions ──────────────────────────────────────────────

export function matchesKeyword(kw: string, text: string): boolean {
  const kwLower = kw.toLowerCase();
  const textLower = text.toLowerCase();
  if (kwLower.length <= 4) {
    return new RegExp(`\\b${escapeRegex(kwLower)}\\b`).test(textLower);
  }
  return textLower.includes(kwLower);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractKeywordsFromResponse(responseText: string): string[] {
  const match = responseText.match(/KEYWORDS:\s*([^\n]+)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function extractResumeFromResponse(responseText: string): string {
  const match = responseText.match(/RESUME:\s*\n([\s\S]*)/);
  return match ? match[1].trim() : "";
}

export function calculateAtsScore(keywords: string[], resumeText: string): number {
  if (!keywords.length) return 0;
  const matched = keywords.filter((kw) => matchesKeyword(kw, resumeText)).length;
  return Math.round((matched / keywords.length) * 100);
}

export function parseFitScore(text: string): number {
  const m = text.match(/FIT_SCORE:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function parseFitField(text: string, field: string): string {
  const m = text.match(new RegExp(`${field}:\\s*([^\\n]+)`));
  return m ? m[1].trim() : "";
}

export interface FitCategory {
  key: "SKILLS" | "EXPERIENCE" | "SENIORITY" | "TOOLS";
  label: string;
  score: number; // 0–100, clamped
  rationale: string;
}

const FIT_CATEGORY_KEYS = ["SKILLS", "EXPERIENCE", "SENIORITY", "TOOLS"] as const;
const FIT_CATEGORY_LABELS: Record<FitCategory["key"], string> = {
  SKILLS: "Skills",
  EXPERIENCE: "Experience",
  SENIORITY: "Seniority",
  TOOLS: "Tools",
};

export function parseFitCategories(raw: string): FitCategory[] {
  const out: FitCategory[] = [];
  for (const key of FIT_CATEGORY_KEYS) {
    const scoreM = raw.match(new RegExp(`${key}_MATCH:\\s*(-?\\d+)\\s*/\\s*100`, "i"));
    if (!scoreM) continue;
    const rationaleM = raw.match(new RegExp(`${key}_RATIONALE:\\s*([^\\n]+)`, "i"));
    const n = parseInt(scoreM[1], 10);
    out.push({
      key,
      label: FIT_CATEGORY_LABELS[key],
      score: Math.max(0, Math.min(100, isNaN(n) ? 0 : n)),
      rationale: rationaleM ? rationaleM[1].trim() : "",
    });
  }
  return out;
}

export function stripMarkdown(text: string): string {
  let result = text;
  // Remove headers
  result = result.replace(/^#{1,3}\s+/gm, "");
  // Remove bold
  result = result.replace(/\*\*(.*?)\*\*/g, "$1");
  // Remove italic
  result = result.replace(/\*(.*?)\*/g, "$1");
  // Remove blockquotes
  result = result.replace(/^>\s*/gm, "");
  return result;
}

export function normalizeDashes(text: string): string {
  // Month + year range: "Sep 2021 - Jan 2026" → "Sep 2021 – Jan 2026"
  let result = text.replace(
    /\b([A-Z][a-z]{2}\s\d{4})\s-\s([A-Z][a-z]{2}\s\d{4})\b/g,
    "$1 – $2"
  );
  // Year-only range: "2020 - 2021" → "2020 – 2021"
  result = result.replace(/\b(\d{4})\s-\s(\d{4})\b/g, "$1 – $2");
  return result;
}

// ── Master resume parsing & validation ─────────────────────────────────

function findSectionBounds(
  lines: string[],
  sectionName: string
): { start: number; end: number } | null {
  const lower = sectionName.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === lower) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim().toLowerCase();
    if (
      REQUIRED_SECTIONS.some((s) => s.toLowerCase() === t) ||
      t === "additional experience"
    ) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// Match "RoleLocation | Dates" (mammoth-extracted, no space between role and city)
// or "Role | Location | Dates" (pipe-separated)
function parseRoleLine(
  line: string
): { role: string; location: string; dates: string } | null {
  // Tab-separated (mammoth DOCX extraction): "Role\tLocation | Dates"
  const tabbed = line.match(/^([^\t]+)\t(.+?)\s\|\s(.+)$/);
  if (tabbed) {
    return {
      role: tabbed[1].trim(),
      location: tabbed[2].trim(),
      dates: tabbed[3].trim(),
    };
  }
  // Try triple-pipe first: "Role | Location | Dates"
  const triple = line.match(/^(.+?)\s\|\s(.+?)\s\|\s(.+)$/);
  if (triple) {
    return {
      role: triple[1].trim(),
      location: triple[2].trim(),
      dates: triple[3].trim(),
    };
  }
  // Concatenated: "Role<LocationCity, Country> | Dates"
  const concat = line.match(
    /^(.+?)([A-Z][a-zñáéíóú]+(?:[\s‑-][A-Z][a-zñáéíóú]+)*,\s[A-Z][a-zñáéíóú]+(?:\s[A-Z][a-zñáéíóú]+)*)\s\|\s(.+)$/
  );
  if (concat) {
    return {
      role: concat[1].trim(),
      location: concat[2].trim(),
      dates: concat[3].trim(),
    };
  }
  return null;
}

function parseRolesFromSection(sectionLines: string[]): RoleFact[] {
  const out: RoleFact[] = [];
  let pendingCompany: string | null = null;
  for (const raw of sectionLines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const parsed = parseRoleLine(line);
    if (parsed && pendingCompany) {
      out.push({
        company: pendingCompany,
        role: parsed.role,
        location: parsed.location,
        dates: parsed.dates,
      });
      pendingCompany = null;
      continue;
    }
    if (parsed && !pendingCompany) {
      // Orphan role line without a preceding company — skip
      continue;
    }
    // Not a role line → treat as a potential company heading
    // (but skip bullets and generic body lines starting with lowercase)
    if (line.startsWith("•") || line.startsWith("-") || line.startsWith("–")) {
      continue;
    }
    // First char must be uppercase to be a company name
    if (line[0] && line[0] === line[0].toUpperCase()) {
      pendingCompany = line;
    }
  }
  return out;
}

export function parseCandidateHeader(
  masterText: string,
  facts: MasterResumeFacts
): CandidateHeader {
  const lines = masterText.split("\n");

  // Isolate the pre-section header block (everything before the first known section)
  let endIdx = lines.length;
  const sectionPatterns = [
    ...REQUIRED_SECTIONS,
    "Additional Experience",
    "Education",
    "Skills",
    "Certificates",
    "Languages",
  ];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (sectionPatterns.some((s) => s.toLowerCase() === t.toLowerCase())) {
      endIdx = i;
      break;
    }
  }
  const headerBlock = lines.slice(0, endIdx).join("\n");

  const header: CandidateHeader = {};

  // Email
  const emailMatch = headerBlock.match(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/);
  if (emailMatch) header.email = emailMatch[0];

  // LinkedIn (capture "linkedin.com/in/<handle>")
  const liMatch = headerBlock.match(/linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  if (liMatch) header.linkedin = liMatch[0];

  // GitHub (capture "github.com/<handle>")
  const ghMatch = headerBlock.match(/github\.com\/[A-Za-z0-9_-]+/i);
  if (ghMatch) header.github = ghMatch[0];

  // Phone: look for a run of digits / spaces / dashes / parens / + with ≥7 digits
  const phoneMatch = headerBlock.match(
    /(?:\+?\d[\d\s\-().]{6,}\d)/
  );
  if (phoneMatch) {
    // Trim any trailing punctuation bullets
    header.phone = phoneMatch[0].replace(/[•·\s]+$/g, "").trim();
  }

  // Name: first non-empty line in the header block that is NOT the contact line
  // (contact lines contain email / phone / linkedin / github) and is not the headline row.
  const headerLines = headerBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const firstRoleTitle = facts.roles[0]?.role;
  for (const line of headerLines) {
    const low = line.toLowerCase();
    const isContactLine =
      (header.email && low.includes(header.email.toLowerCase())) ||
      (header.linkedin && low.includes(header.linkedin.toLowerCase())) ||
      (header.github && low.includes(header.github.toLowerCase())) ||
      /\d{3}/.test(line); // has 3+ consecutive digits → likely phone line
    if (isContactLine) continue;
    if (firstRoleTitle && line === firstRoleTitle) continue;
    header.name = line;
    break;
  }

  // Headline: most recent role (first entry in PROFESSIONAL EXPERIENCE)
  if (facts.roles.length > 0) {
    header.headline = facts.roles[0].role;
  }

  return header;
}

export function extractMasterFacts(masterText: string): MasterResumeFacts {
  const lines = masterText.split("\n");

  const prof = findSectionBounds(lines, "PROFESSIONAL EXPERIENCE");
  const additionalHeadings = ["ADDITIONAL EXPERIENCE", "Additional Experience"];
  let additional: { start: number; end: number } | null = null;
  for (const h of additionalHeadings) {
    additional = findSectionBounds(lines, h);
    if (additional) break;
  }
  const edu = findSectionBounds(lines, "EDUCATION");
  const langs = findSectionBounds(lines, "LANGUAGES");
  const certs = findSectionBounds(lines, "CERTIFICATES");

  const roles = prof
    ? parseRolesFromSection(lines.slice(prof.start, prof.end))
    : [];
  const additionalRoles = additional
    ? parseRolesFromSection(lines.slice(additional.start, additional.end))
    : [];

  const education: EducationFact[] = [];
  if (edu) {
    let pendingSchool: string | null = null;
    for (const raw of lines.slice(edu.start, edu.end)) {
      const line = raw.trim();
      if (!line) continue;
      const parsed = parseRoleLine(line);
      if (parsed && pendingSchool) {
        education.push({
          school: pendingSchool,
          degree: parsed.role,
          location: parsed.location,
          dates: parsed.dates,
        });
        pendingSchool = null;
        continue;
      }
      if (line[0] && line[0] === line[0].toUpperCase()) {
        pendingSchool = line;
      }
    }
  }

  // Languages are validated strictly (each must survive into the tailored
  // resume), so we must only collect genuine language entries. PDF parsing of
  // multi-column resumes concatenates adjacent headings (e.g. a literal
  // "CertificatesInternships" line) and scatters certificates/dates into the
  // LANGUAGES section, so a naive "first token before a dash" grab pulls in
  // garbage that then fails validation forever. Require the canonical
  // "<Language> – <Proficiency>" shape with a known proficiency word.
  const PROFICIENCY =
    /^(native|bilingual|fluent|proficient|professional|full professional|working|limited|conversational|advanced|upper[- ]?intermediate|intermediate|pre[- ]?intermediate|elementary|beginner|basic|mother tongue|[abc][12])\b/i;
  const languages: string[] = [];
  if (langs) {
    for (const raw of lines.slice(langs.start, langs.end)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/[–-]/);
      if (parts.length < 2) continue; // needs "<name> - <proficiency>"
      const name = parts[0].trim();
      const proficiency = parts.slice(1).join("-").trim();
      // A real language name: alphabetic, no digits/colons, not a heading glob.
      if (!name || name.length > 30 || /[0-9:]/.test(name)) continue;
      if (!/^[A-Za-z][A-Za-z ()'.]*$/.test(name)) continue;
      if (!PROFICIENCY.test(proficiency)) continue;
      languages.push(name);
    }
  }

  const certificates: string[] = [];
  if (certs) {
    for (const raw of lines.slice(certs.start, certs.end)) {
      const line = raw.trim();
      if (!line) continue;
      certificates.push(line);
    }
  }

  return { roles, additionalRoles, education, languages, certificates };
}

// Line-based parsing (extractMasterFacts) breaks on multi-column PDFs that
// flatten into scrambled text — roles come back empty, leaving the tailoring
// LLM with no ground truth (it then mismatches titles/companies/dates). This
// extracts the same facts via one fast-model call, which is layout-agnostic.
// Cached per resume text; falls back to the regex parser on any failure.
const FACTS_PROMPT = `Extract structured facts from the resume below. Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "roles": [{"company": "", "role": "", "location": "", "dates": ""}],
  "additionalRoles": [{"company": "", "role": "", "location": "", "dates": ""}],
  "education": [{"school": "", "degree": "", "location": "", "dates": ""}],
  "languages": [""],
  "certificates": [""]
}
Rules:
- Copy companies, job titles, schools, and date ranges EXACTLY as written. Never invent, merge, or swap them.
- "roles" = primary professional positions, ordered most-recent first. "additionalRoles" = internships / short-term / volunteer roles.
- Keep each role's company, title, and dates together as they appear in the resume.
- "languages" = spoken/human languages only (e.g. English, Turkish). EXCLUDE programming languages and tools.
- Use an empty array for any absent section.

RESUME:
{resume_text}`;

const factsCache = new Map<string, MasterResumeFacts>();

interface RawRole { company?: unknown; role?: unknown; location?: unknown; dates?: unknown }
function coerceRoles(arr: unknown): RoleFact[] {
  if (!Array.isArray(arr)) return [];
  const out: RoleFact[] = [];
  for (const r of arr as RawRole[]) {
    const company = String(r?.company ?? "").trim();
    const role = String(r?.role ?? "").trim();
    if (!company && !role) continue;
    out.push({
      company,
      role,
      location: String(r?.location ?? "").trim(),
      dates: String(r?.dates ?? "").trim(),
    });
  }
  return out;
}

export async function extractMasterFactsSmart(
  resumeText: string
): Promise<MasterResumeFacts> {
  const cached = factsCache.get(resumeText);
  if (cached) return cached;
  try {
    const raw = await callLlm(
      FACTS_PROMPT.replace("{resume_text}", resumeText.slice(0, 7000)),
      1500,
      undefined,
      getFastModel() ?? undefined
    );
    const obj = extractJsonObject(raw) as Record<string, unknown> | null;
    if (obj) {
      const facts: MasterResumeFacts = {
        roles: coerceRoles(obj.roles),
        additionalRoles: coerceRoles(obj.additionalRoles),
        education: Array.isArray(obj.education)
          ? (obj.education as RawRole[])
              .map((e) => ({
                school: String(e?.company ?? (e as Record<string, unknown>)?.school ?? "").trim(),
                degree: String(e?.role ?? (e as Record<string, unknown>)?.degree ?? "").trim(),
                location: String(e?.location ?? "").trim(),
                dates: String(e?.dates ?? "").trim(),
              }))
              .filter((e) => e.school || e.degree)
          : [],
        languages: Array.isArray(obj.languages)
          ? (obj.languages as unknown[]).map((l) => String(l).trim()).filter(Boolean)
          : [],
        certificates: Array.isArray(obj.certificates)
          ? (obj.certificates as unknown[]).map((c) => String(c).trim()).filter(Boolean)
          : [],
      };
      // Only trust the LLM result if it found real experience; otherwise the
      // regex fallback is no worse and avoids caching an empty result.
      if (facts.roles.length || facts.additionalRoles.length) {
        factsCache.set(resumeText, facts);
        return facts;
      }
    }
  } catch (err) {
    console.error("[facts] LLM extraction failed, using regex fallback:", err);
  }
  const fallback = extractMasterFacts(resumeText);
  factsCache.set(resumeText, fallback);
  return fallback;
}

export function validateTailoredResume(
  output: string,
  facts: MasterResumeFacts
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const textLower = output.toLowerCase();

  // 1. No REFERENCES section
  if (/^\s*REFERENCES?\s*$/im.test(output)) {
    errors.push("Fabricated REFERENCES section detected");
  }

  // 2. All companies from main + additional roles present
  const allRoles = [...facts.roles, ...facts.additionalRoles];
  for (const r of allRoles) {
    if (!textLower.includes(r.company.toLowerCase())) {
      errors.push(`Missing company: ${r.company}`);
    }
  }

  // 3. Dates appear on same line as their company (guards against swaps)
  const lines = output.split("\n");
  for (const r of allRoles) {
    const companyLower = r.company.toLowerCase();
    const datesLower = r.dates.toLowerCase();
    const hit = lines.some((l) => {
      const ll = l.toLowerCase();
      return ll.includes(companyLower) && ll.includes(datesLower);
    });
    if (!hit) {
      errors.push(
        `Dates mismatch for ${r.company}: expected "${r.dates}" on same line`
      );
    }
  }

  // 4. Education schools present
  for (const e of facts.education) {
    if (!textLower.includes(e.school.toLowerCase())) {
      errors.push(`Missing school: ${e.school}`);
    }
  }

  // 5. Languages present
  for (const lang of facts.languages) {
    if (!textLower.includes(lang.toLowerCase())) {
      errors.push(`Missing language: ${lang}`);
    }
  }

  // 6. Required section headings present
  for (const section of REQUIRED_SECTIONS) {
    const re = new RegExp(`^\\s*${section}\\s*$`, "im");
    if (!re.test(output)) {
      errors.push(`Missing section heading: ${section}`);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

// ── Resume reading ──────────────────────────────────────────────────────

// Parsing the master resume (PDF/DOCX especially) is expensive, and it's the
// same file for every job in a campaign — fit analysis previously re-read and
// re-parsed it once per scored job. Memoize by path + mtime so a re-saved
// resume still invalidates the cache.
const resumeTextCache = new Map<string, string>();

export async function readResumeTextAsync(filePath: string): Promise<string> {
  let cacheKey = filePath;
  try {
    cacheKey = `${filePath}:${statSync(filePath).mtimeMs}`;
  } catch {
    // stat failed (missing file) — fall through; parseResumeText surfaces it.
  }
  const cached = resumeTextCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const text = await parseResumeText(filePath);
  resumeTextCache.set(cacheKey, text);
  return text;
}

async function parseResumeText(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop();
  if (ext === "txt") {
    return readFileSync(filePath, "utf-8").trim();
  }
  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value as string).trim();
  }
  if (ext === "pdf") {
    // pdf-parse has a bug where require() tries to load a test file.
    // Import the core module directly to avoid it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse/lib/pdf-parse"); // lazy: avoids pdf-parse test-file side-effect on load
    const buffer = readFileSync(filePath);
    const data = await pdfParse(buffer);
    return (data.text as string).trim();
  }
  throw new Error(`Unsupported resume format: .${ext}`);
}

// ── LLM Provider Calls ─────────────────────────────────────────────────

// A throwable error class that callers (retry-fit, campaign worker) can
// recognize to back off properly instead of treating rate limits like
// generic provider failures.
export class RateLimitError extends Error {
  retryAt: number; // unix ms
  rawMessage: string;
  constructor(retryAtMs: number, rawMessage: string) {
    super(`Rate-limited until ${new Date(retryAtMs).toISOString()}: ${rawMessage}`);
    this.name = "RateLimitError";
    this.retryAt = retryAtMs;
    this.rawMessage = rawMessage;
  }
}

// Module-level rate-limit state. Stashed on globalThis so HMR doesn't fork it.
interface LlmGlobals {
  __jobbot_rate_limit_until: number;
  __jobbot_rate_limit_msg: string;
  __jobbot_token_windows?: Record<string, TokenWindowEntry[]>;
  // Per-model serialization lock + last-call timestamp, keyed by usageKey, so
  // models (fast fit-scoring vs flagship tailoring) pace independently.
  __jobbot_tpm_locks?: Record<string, Promise<void>>;
  __jobbot_last_call?: Record<string, number>;
}
const llmG = globalThis as unknown as LlmGlobals;
if (llmG.__jobbot_rate_limit_until === undefined) llmG.__jobbot_rate_limit_until = 0;
if (llmG.__jobbot_rate_limit_msg === undefined) llmG.__jobbot_rate_limit_msg = "";

// ── Tokens-per-minute (TPM) pacing ──────────────────────────────────────
// Groq's free tier caps tokens/minute low (~6k for 8b-instant). The fixed 2s
// request spacing bounds requests/min but NOT tokens/min, so bursts of ~2k-token
// fit calls trip 429s. We pace against a rolling 60s per-model token budget.
const TOKEN_WINDOW_MS = 60_000;

export interface TokenWindowEntry {
  t: number;
  tokens: number;
}

// Pure: tokens spent within the trailing window ending at `now`.
export function tokensUsedInWindow(
  window: TokenWindowEntry[],
  now: number,
  windowMs: number = TOKEN_WINDOW_MS
): number {
  let sum = 0;
  for (const e of window) if (now - e.t < windowMs) sum += e.tokens;
  return sum;
}

// Pure: would adding `est` tokens keep the trailing window within `tpm`?
export function hasTokenBudget(
  window: TokenWindowEntry[],
  now: number,
  tpm: number,
  est: number,
  windowMs: number = TOKEN_WINDOW_MS
): boolean {
  return tokensUsedInWindow(window, now, windowMs) + est <= tpm;
}

function getTokenWindow(key: string): TokenWindowEntry[] {
  if (!llmG.__jobbot_token_windows) llmG.__jobbot_token_windows = {};
  if (!llmG.__jobbot_token_windows[key]) llmG.__jobbot_token_windows[key] = [];
  return llmG.__jobbot_token_windows[key];
}

// Reserve `est` tokens against the model's per-minute budget, waiting if the
// trailing-60s window is full. Serialized through a promise-chain lock so
// concurrent callers (the scraper fires fit analyses without awaiting) pace
// against one shared budget. Returns the window entry so the caller can
// reconcile the estimate to actual usage once the response lands.
async function reserveTokenBudget(
  key: string,
  tpm: number,
  est: number
): Promise<TokenWindowEntry> {
  if (!llmG.__jobbot_tpm_locks) llmG.__jobbot_tpm_locks = {};
  const prev = llmG.__jobbot_tpm_locks[key] ?? Promise.resolve();
  let release!: () => void;
  llmG.__jobbot_tpm_locks[key] = new Promise<void>((r) => (release = r));
  await prev.catch(() => {});
  try {
    const window = getTokenWindow(key);
    for (;;) {
      const now = Date.now();
      const live = window.filter((e) => now - e.t < TOKEN_WINDOW_MS);
      window.length = 0;
      window.push(...live);
      // Always let a call through when the window is empty, otherwise a single
      // call larger than the whole budget would deadlock.
      if (window.length === 0 || hasTokenBudget(window, now, tpm, est)) {
        const entry: TokenWindowEntry = { t: now, tokens: est };
        window.push(entry);
        return entry;
      }
      const oldest = window.reduce((m, e) => Math.min(m, e.t), now);
      const waitMs = Math.min(
        TOKEN_WINDOW_MS,
        Math.max(250, TOKEN_WINDOW_MS - (now - oldest) + 50)
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  } finally {
    release();
  }
}

export function getRateLimitState(): { rateLimited: boolean; retryAt: number; message: string } {
  return {
    rateLimited: Date.now() < llmG.__jobbot_rate_limit_until,
    retryAt: llmG.__jobbot_rate_limit_until,
    message: llmG.__jobbot_rate_limit_msg,
  };
}

// Groq's free-tier daily token cap; used when the user hasn't set one.
export const DEFAULT_DAILY_TOKEN_LIMIT = 100_000;

// A daily-quota exhaustion looks like a long retry-after (resets at UTC
// midnight) or usage already at/over the cap. A short minute-window blip is
// neither — we leave those to the existing pause/auto-resume behavior.
// Groq's per-minute windows clear in under ~2 min; a daily-quota reset is
// hours away, so a retry-after >= 5 min signals daily (not minute) exhaustion.
export const DAILY_STOP_THRESHOLD_MS = 5 * 60_000;

export function isDailyExhaustion(
  retryAtMs: number,
  usedTokens: number,
  dailyLimit: number,
  now: number = Date.now()
): boolean {
  return retryAtMs - now >= DAILY_STOP_THRESHOLD_MS || usedTokens >= dailyLimit;
}

// Lazily require db/campaign to avoid a circular import (matches trackUsage).
function maybeStopForDailyExhaustion(retryAtMs: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getApiUsageToday, getConfig, getActiveCampaign, updateCampaignStatus } = require("./db"); // lazy: avoids circular import (db ← resume ← db)
    const model = getActiveModel();
    let usedTokens = 0;
    let dailyLimit = DEFAULT_DAILY_TOKEN_LIMIT;
    if (model) {
      const usage = getApiUsageToday();
      usedTokens = usage.tokensByModel?.[model.usageKey] ?? 0;
      dailyLimit = Number(getConfig("daily_token_limit")) || DEFAULT_DAILY_TOKEN_LIMIT;
    }
    if (!isDailyExhaustion(retryAtMs, usedTokens, dailyLimit)) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stopCampaign } = require("./campaign"); // lazy: avoids circular import (campaign ← resume ← campaign)
    stopCampaign();
    const campaign = getActiveCampaign();
    if (campaign) updateCampaignStatus(campaign.id, "stopped", "rate_limited");
  } catch {
    // Never let a stop failure mask the original RateLimitError.
  }
}

function setRateLimited(retryAtMs: number, message: string): void {
  // Take the later of the two — never reduce the back-off window.
  if (retryAtMs > llmG.__jobbot_rate_limit_until) {
    llmG.__jobbot_rate_limit_until = retryAtMs;
    llmG.__jobbot_rate_limit_msg = message;
  }
  maybeStopForDailyExhaustion(retryAtMs);
}

// Clear the cached back-off — used when the user explicitly wants to retry
// despite the server still being in its back-off window (Groq's published
// retry-after often over-estimates, so a manual force-retry is useful).
export function clearRateLimit(): void {
  llmG.__jobbot_rate_limit_until = 0;
  llmG.__jobbot_rate_limit_msg = "";
}

// Groq's 429 body looks like:
//   "Please try again in 37m22.944s"  (sometimes 12.5s, sometimes 2.7s)
// Parse to milliseconds.
function parseRetryAfterMs(message: string): number | null {
  const m = message.match(/try again in\s+(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!m) return null;
  const mins = m[1] ? parseInt(m[1], 10) : 0;
  const secs = m[2] ? parseFloat(m[2]) : 0;
  const total = (mins * 60 + secs) * 1000;
  return total > 0 ? total : null;
}

// Short rate-limit windows (a few seconds) — sleep and retry inline.
// Anything longer than this gets bubbled up as a RateLimitError so the
// caller can give up cleanly and the dashboard can back off polling.
const RATE_LIMIT_INLINE_THRESHOLD_MS = 30_000;

interface LlmResult {
  text: string;
  tokens: number;
}

// Normalizes a provider's completion object to a single token count.
// Groq + OpenRouter expose usage.total_tokens; Anthropic splits in/out.
export function extractTokenCount(provider: ActiveProvider, raw: unknown): number {
  const usage = (raw as {
    usage?: { total_tokens?: number; input_tokens?: number; output_tokens?: number };
  })?.usage;
  if (!usage) return 0;
  if (provider === "anthropic") {
    return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }
  return usage.total_tokens ?? 0;
}

async function callProvider(
  name: string,
  fn: () => Promise<LlmResult>
): Promise<LlmResult | null> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      console.error(`[LLM] ${name} attempt ${attempt + 1} failed:`, e);
      const errStr = String(e);
      const errLow = errStr.toLowerCase();
      const isRateLimit =
        errLow.includes("429") ||
        errLow.includes("rate_limit") ||
        errLow.includes("rate limit") ||
        errLow.includes("quota") ||
        errLow.includes("resource_exhausted");

      if (isRateLimit) {
        const waitMs = parseRetryAfterMs(errStr);
        if (waitMs !== null && waitMs <= RATE_LIMIT_INLINE_THRESHOLD_MS) {
          console.error(`[LLM] ${name} rate-limited — sleeping ${waitMs} ms`);
          await new Promise((r) => setTimeout(r, waitMs + 500));
          continue; // retry within the loop
        }
        // Long wait OR couldn't parse — register and bail out fast.
        const retryAt = Date.now() + (waitMs ?? 60_000);
        setRateLimited(retryAt, errStr.slice(0, 200));
        throw new RateLimitError(retryAt, errStr.slice(0, 200));
      }
      if (attempt === maxRetries - 1) return null;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return null;
}

async function callLlm(
  prompt: string,
  maxTokens: number = 2048,
  validate?: (text: string) => { ok: true } | { ok: false; errors: string[] },
  modelOverride?: ActiveModel
): Promise<string> {
  // Already-known rate limit — skip the call so we don't burn time and
  // pile up identical 429s. Surfaces as a RateLimitError so callers can
  // distinguish "give me a few minutes" from "real provider failure".
  const rl = getRateLimitState();
  if (rl.rateLimited) {
    throw new RateLimitError(rl.retryAt, rl.message);
  }

  const model = modelOverride ?? getActiveModel();
  if (!model) {
    throw new Error(
      "No active provider configured. Complete onboarding to pick a provider."
    );
  }

  const apiKey = process.env[model.envKey];
  if (!apiKey) {
    throw new Error(
      `Active provider is ${model.provider} but ${model.envKey} is not set.`
    );
  }

  // Enforce minimum request interval, per model, so the flagship and fast
  // models don't serialize against each other's spacing.
  if (!llmG.__jobbot_last_call) llmG.__jobbot_last_call = {};
  const last = llmG.__jobbot_last_call[model.usageKey] ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < LLM_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, LLM_MIN_INTERVAL - elapsed));
  }
  llmG.__jobbot_last_call[model.usageKey] = Date.now();

  // Pace against the model's per-minute token budget. Estimate = prompt tokens
  // (~chars/4) + the max output, so we reserve conservatively and reconcile to
  // the real count once the response lands.
  const estTokens = Math.ceil(prompt.length / 4) + maxTokens;
  const reservation = await reserveTokenBudget(model.usageKey, model.tpm, estTokens);

  const withValidation = (
    fn: () => Promise<LlmResult>
  ): (() => Promise<LlmResult>) => {
    if (!validate) return fn;
    return async () => {
      const result = await fn();
      const check = validate(result.text);
      if (!check.ok) {
        console.error(
          "[LLM] Validation failed:",
          check.errors.slice(0, 5).join("; ")
        );
        throw new Error(`Validation failed: ${check.errors[0] ?? "unknown"}`);
      }
      return result;
    };
  };

  const callers: Record<ActiveProvider, () => Promise<LlmResult>> = {
    groq: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Groq = require("groq-sdk"); // lazy: SDK only loaded when groq provider is active
      const client = new Groq({ apiKey });
      const message = await client.chat.completions.create({
        model: model.modelId,
        max_tokens: maxTokens,
        temperature: 0,
        top_p: 0.1,
        messages: [{ role: "user", content: prompt }],
      });
      return { text: message.choices[0].message.content, tokens: extractTokenCount("groq", message) };
    },
    anthropic: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const anthropicSdk = require("@anthropic-ai/sdk"); // lazy: SDK only loaded when anthropic provider is active
      const Anthropic = anthropicSdk.default || anthropicSdk;
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: model.modelId,
        max_tokens: maxTokens,
        temperature: 0,
        top_p: 0.1,
        messages: [{ role: "user", content: prompt }],
      });
      return { text: message.content[0].text, tokens: extractTokenCount("anthropic", message) };
    },
    openrouter: async () => {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
          "X-Title": "JobBot",
        },
        body: JSON.stringify({
          model: model.modelId,
          max_tokens: maxTokens,
          temperature: 0,
          top_p: 0.1,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!resp.ok) {
        throw new Error(`OpenRouter ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`Empty response from ${model.modelId}`);
      return { text: content, tokens: extractTokenCount("openrouter", data) };
    },
  };

  const result = await callProvider(
    model.displayName,
    withValidation(callers[model.provider])
  );

  if (result === null) {
    throw new Error(`${model.displayName} failed after retries.`);
  }

  // Reconcile the reservation estimate to the real token count.
  if (result.tokens > 0) reservation.tokens = result.tokens;
  trackUsage(model.usageKey, result.tokens);
  return result.text;
}

// ── DOCX generation ───────────────────────────────────────────────────

function isAllCapsSection(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/[a-z]/.test(t)
    && !t.startsWith("•") && !t.startsWith("-") && !t.startsWith("–");
}

// Detect "Company | Location | Date" or "Role\tLocation | Date" patterns
function isCompanyOrRoleLine(line: string): { company?: string; role?: string; locationDate?: string } | null {
  // "Company Name | Location | Dates" or "Company Name"
  const pipeMatch = line.match(/^(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
  if (pipeMatch) {
    return { company: pipeMatch[1].trim(), locationDate: `${pipeMatch[2].trim()} | ${pipeMatch[3].trim()}` };
  }
  return null;
}

async function writeTailoredDocx(
  text: string,
  outputPath: string,
  header: CandidateHeader
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const docxModule = require("docx"); // lazy: docx package only needed at write time, avoids heavy load on import
  const { Document, Packer, Paragraph, TextRun, AlignmentType, TabStopType } = docxModule;

  // Type scale matched to the Doruk_Kirali_Head_of_Product.docx template.
  const FONT = "Calibri";
  const SIZE_NAME = 36;       // 18pt
  const SIZE_SUBTITLE = 24;   // 12pt
  const SIZE_CONTACT = 18;    // 9pt
  const SIZE_SECTION = 22;    // 11pt (bold section headings)
  const SIZE_META = 20;       // 10pt (company, role title, location/date)
  const SIZE_TEXT = 22;       // 11pt (bullets and section body lines)
  const SIZE_COMPANY = 20;    // 10pt
  // Content width with the template's 0.75" L/R margins: 12240 - 2*1080 = 10080.
  const RIGHT_TAB = 10080;    // right-aligned tab position in twips

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  // ── Header: Name (if present) ──
  if (header.name) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: header.name, bold: true, size: SIZE_NAME, font: FONT })],
    }));
  }

  // ── Header: Headline from most recent role (if any) ──
  if (header.headline) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: header.headline, bold: true, size: SIZE_SUBTITLE, font: FONT })],
    }));
  }

  // ── Header: Contact line (only fields that exist, bullet-separated) ──
  const contactParts: string[] = [];
  if (header.phone) contactParts.push(header.phone);
  if (header.email) contactParts.push(header.email);
  if (header.linkedin) contactParts.push(header.linkedin);
  if (header.github) contactParts.push(header.github);
  if (contactParts.length) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({
        text: contactParts.join(" \u2022 "),
        size: SIZE_CONTACT, font: FONT, color: "555555",
      })],
    }));
  }

  // ── Parse body ──
  const contactSkipPatterns = buildContactSkipPatterns(header);
  const lines = text.split("\n");
  let i = 0;

  // Skip lines that are the candidate name/contact (LLM sometimes repeats them)
  while (i < lines.length) {
    const t = lines[i].trim().toLowerCase();
    if (
      !t ||
      contactSkipPatterns.some((p) => t.includes(p)) ||
      (header.name && t === header.name.toLowerCase())
    ) {
      i++;
      continue;
    }
    break;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    i++;

    // Empty line → small spacer
    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [] }));
      continue;
    }

    // ALL CAPS → section heading (bold, with bottom border effect via spacing)
    if (isAllCapsSection(trimmed)) {
      children.push(new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [new TextRun({ text: trimmed, bold: true, size: SIZE_SECTION, font: FONT })],
      }));
      continue;
    }

    // "Company | Location | Dates" line
    const parsed = isCompanyOrRoleLine(trimmed);
    if (parsed && parsed.company) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 20 },
        children: [new TextRun({ text: parsed.company, size: SIZE_COMPANY, font: FONT })],
      }));

      // Next line is likely the role title — peek ahead
      if (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("•") && !lines[i].trim().startsWith("-") && !isAllCapsSection(lines[i].trim())) {
        const roleLine = lines[i].trim();
        i++;
        // Role with tab-aligned location/date
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: roleLine, bold: true, size: SIZE_META, font: FONT }),
            new TextRun({ text: `\t${parsed.locationDate}`, size: SIZE_META, font: FONT, color: "555555" }),
          ],
        }));
      } else {
        // No separate role line — put location on same line
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: parsed.company, bold: true, size: SIZE_META, font: FONT }),
            new TextRun({ text: `\t${parsed.locationDate}`, size: SIZE_META, font: FONT, color: "555555" }),
          ],
        }));
      }
      continue;
    }

    // Bullet points (• or -)
    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("–")) {
      const bulletText = trimmed.replace(/^[•\-–]\s*/, "");
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 40 },
        children: [new TextRun({ text: bulletText, size: SIZE_TEXT, font: FONT })],
      }));
      continue;
    }

    // Regular paragraph
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: trimmed, size: SIZE_TEXT, font: FONT })],
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          // Match template: 0.5" top/bottom, 0.75" left/right (US Letter).
          margin: { top: 720, right: 1080, bottom: 720, left: 1080 },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outputPath, buffer);
}

// ── Public functions ────────────────────────────────────────────────────

function renderGroundTruth(facts: MasterResumeFacts): string {
  const lines: string[] = [];
  lines.push("Professional Experience:");
  for (const r of facts.roles) {
    lines.push(`  • ${r.company} | ${r.location} | ${r.dates} — Role: ${r.role}`);
  }
  if (facts.additionalRoles.length) {
    lines.push("Additional Experience:");
    for (const r of facts.additionalRoles) {
      lines.push(
        `  • ${r.company} | ${r.location} | ${r.dates} — Role: ${r.role}`
      );
    }
  }
  if (facts.education.length) {
    lines.push("Education:");
    for (const e of facts.education) {
      lines.push(
        `  • ${e.school} | ${e.location} | ${e.dates} — Program: ${e.degree}`
      );
    }
  }
  if (facts.languages.length) {
    lines.push(`Languages: ${facts.languages.join(", ")}`);
  }
  return lines.join("\n");
}

// Build the resume header from saved config (authoritative) instead of
// re-parsing it out of the master PDF, which flattens unreliably (often losing
// the contact line and truncating the name). The headline is the candidate's
// most recent role title from their experience — "the latest title they have".
function buildHeaderFromConfig(facts: MasterResumeFacts): CandidateHeader {
  const clean = (v: string | null): string | undefined => {
    const t = (v ?? "").trim();
    return t || undefined;
  };
  return {
    name: clean(getConfig("name")),
    headline: latestRoleTitle(facts),
    phone: clean(getConfig("phone")),
    email: clean(getConfig("email")),
    linkedin: clean(getConfig("linkedin")),
    github: clean(getConfig("github")),
  };
}

// The candidate's most recent role title. Resumes list experience newest-first,
// so the first parsed role is normally the latest; fall back across sections.
export function latestRoleTitle(facts: MasterResumeFacts): string | undefined {
  const role = facts.roles[0]?.role || facts.additionalRoles[0]?.role || "";
  return role.trim() || undefined;
}

// Derive the candidate's latest title from the (clean) tailored resume text:
// the role whose date range ends latest. Master-PDF parsing is unreliable on
// multi-column layouts (roles often come back empty), so we read the generated
// output, where each experience entry is "Company | Location | Dates" followed
// by the role title on the next line.
export function deriveLatestTitle(tailoredText: string): string | undefined {
  const lines = tailoredText.split("\n").map((l) => l.trim());
  let best: { title: string; end: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const parsed = isCompanyOrRoleLine(lines[i]);
    if (!parsed?.locationDate) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const title = lines[j] || "";
    if (!title || /^[•\-–]/.test(title) || isAllCapsSection(title)) continue;
    const ld = parsed.locationDate;
    const end = /present|current|now|ongoing/i.test(ld)
      ? 9999
      : Math.max(0, ...(ld.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number));
    if (!best || end > best.end) best = { title, end };
  }
  return best?.title;
}

export async function tailorResume(
  jobId: number,
  jobDescription: string,
  masterResumePath: string,
  existingKeywords?: string[]
): Promise<{
  keywords: string[];
  keywordsStr: string;
  atsScore: number;
  originalAtsScore: number;
  tailoredText: string;
  docxPath: string;
  pdfPath: string | null;
  modelUsed: string;
}> {
  const resumeText = await readResumeTextAsync(masterResumePath);
  const facts = await extractMasterFactsSmart(resumeText);
  const header = buildHeaderFromConfig(facts);
  const groundTruth = renderGroundTruth(facts);

  const prompt = TAILOR_PROMPT
    .replace("{job_description}", jobDescription)
    .replace("{resume_text}", resumeText)
    .replace("{ground_truth}", groundTruth);

  const responseText = await callLlm(prompt, 3000, (text) => {
    const extracted = extractResumeFromResponse(text) || text;
    return validateTailoredResume(normalizeDashes(extracted), facts);
  });

  const keywords = existingKeywords ?? extractKeywordsFromResponse(responseText);
  let tailoredText = extractResumeFromResponse(responseText);
  if (!tailoredText) tailoredText = resumeText;
  tailoredText = normalizeDashes(tailoredText);

  // Headline = the candidate's latest title. Prefer deriving from the tailored
  // output (reliable) and fall back to whatever the master parse yielded.
  header.headline = deriveLatestTitle(tailoredText) ?? header.headline;

  const atsScore = calculateAtsScore(keywords, tailoredText);
  const originalAtsScore = calculateAtsScore(
    keywords,
    await readResumeTextAsync(masterResumePath)
  );

  const jobDir = join(RESUMES_DIR, String(jobId));
  mkdirSync(jobDir, { recursive: true });

  const txtPath = join(jobDir, "tailored.txt");
  writeFileSync(txtPath, tailoredText, "utf-8");

  const docxPath = join(jobDir, "tailored.docx");
  await writeTailoredDocx(tailoredText, docxPath, header);

  return {
    keywords,
    keywordsStr: keywords.join(", "),
    atsScore,
    originalAtsScore,
    tailoredText,
    docxPath,
    pdfPath: null,
    modelUsed: getActiveModel()?.displayName ?? "unknown",
  };
}

function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toHardRequirements(value: unknown): HardRequirement[] {
  if (!Array.isArray(value)) return [];
  const out: HardRequirement[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.text !== "string") continue;
    out.push({
      text: r.text.trim(),
      met: r.met === true,
      evidence: typeof r.evidence === "string" ? r.evidence.trim() : "",
    });
  }
  return out;
}

export async function extractJobRequirements(
  jobDescription: string,
  resumeText: string
): Promise<JobRequirements> {
  const prompt = EXTRACTOR_PROMPT
    .replace("{job_description}", jobDescription.slice(0, 4000))
    .replace("{resume_text}", resumeText.slice(0, 3000));
  // Routed to the cheaper, higher-quota model — extraction is keyword-pulling,
  // not the quality-critical résumé rewrite.
  const raw = await callLlm(prompt, 1200, undefined, getFastModel() ?? undefined);
  const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!parsed) {
    return { required_keywords: [], preferred_keywords: [], hard_requirements: [] };
  }
  return {
    required_keywords: toStringArray(parsed.required_keywords),
    preferred_keywords: toStringArray(parsed.preferred_keywords),
    hard_requirements: toHardRequirements(parsed.hard_requirements),
  };
}

export interface FitScores {
  fitScore: number;
  keywordScore: number;
  hardreqScore: number;
  parseabilityScore: number;
  requirements: JobRequirements;
  matchedRequiredKeywords: string[];
  missedRequiredKeywords: string[];
  matchedPreferredKeywords: string[];
  missedPreferredKeywords: string[];
  jdKeywords: string;
}

export interface FitRationale {
  strengths: string[];
  gaps: string[];
  verdict: string;
  jdSummary: string;
  raw: string;
}

export interface FitResult extends FitScores, FitRationale {
  categories: FitCategory[];
}

// Stage A — fast: 1 LLM call + deterministic scoring. Resolves in ~2-4 s.
export async function analyzeFitScores(
  jobDescription: string,
  masterResumePath: string
): Promise<FitScores> {
  const resumeText = await readResumeTextAsync(masterResumePath);
  const requirements = await extractJobRequirements(jobDescription, resumeText);

  const coverage = calculateKeywordCoverage(
    requirements.required_keywords,
    requirements.preferred_keywords,
    resumeText
  );
  const hardreqScore = calculateHardReqScore(requirements.hard_requirements);
  const parseabilityScore = calculateParseability(resumeText);
  const fitScore = blendFitScore(coverage.score, hardreqScore, parseabilityScore);

  const jdKeywords = [
    ...requirements.required_keywords,
    ...requirements.preferred_keywords,
  ].join(", ");

  return {
    fitScore,
    keywordScore: coverage.score,
    hardreqScore,
    parseabilityScore,
    requirements,
    matchedRequiredKeywords: coverage.requiredHits,
    missedRequiredKeywords: coverage.requiredMisses,
    matchedPreferredKeywords: coverage.preferredHits,
    missedPreferredKeywords: coverage.preferredMisses,
    jdKeywords,
  };
}

// Pure: turn a parsed combined-fit JSON object + the resume text into both the
// deterministic scores and the rationale. Extracted so the (fragile) parsing
// of the merged response is unit-testable without an LLM call, and so it
// degrades gracefully when fields are missing.
export function buildFitResult(
  parsed: Record<string, unknown>,
  resumeText: string
): { scores: FitScores; rationale: FitRationale } {
  const requirements: JobRequirements = {
    required_keywords: toStringArray(parsed.required_keywords),
    preferred_keywords: toStringArray(parsed.preferred_keywords),
    hard_requirements: toHardRequirements(parsed.hard_requirements),
  };
  const coverage = calculateKeywordCoverage(
    requirements.required_keywords,
    requirements.preferred_keywords,
    resumeText
  );
  const hardreqScore = calculateHardReqScore(requirements.hard_requirements);
  const parseabilityScore = calculateParseability(resumeText);
  const fitScore = blendFitScore(coverage.score, hardreqScore, parseabilityScore);
  const jdKeywords = [
    ...requirements.required_keywords,
    ...requirements.preferred_keywords,
  ].join(", ");

  const scores: FitScores = {
    fitScore,
    keywordScore: coverage.score,
    hardreqScore,
    parseabilityScore,
    requirements,
    matchedRequiredKeywords: coverage.requiredHits,
    missedRequiredKeywords: coverage.requiredMisses,
    matchedPreferredKeywords: coverage.preferredHits,
    missedPreferredKeywords: coverage.preferredMisses,
    jdKeywords,
  };

  const strengths = toStringArray(parsed.strengths);
  const gaps = toStringArray(parsed.gaps);
  const verdict = typeof parsed.verdict === "string" ? parsed.verdict : "";
  const jdSummary = typeof parsed.jd_summary === "string" ? parsed.jd_summary : "";
  const raw = `JD_SUMMARY: ${jdSummary}\nSTRENGTHS: ${strengths.join(", ")}\nGAPS: ${
    gaps.length ? gaps.join(", ") : "None"
  }\nVERDICT: ${verdict}`;
  const rationale: FitRationale = { strengths, gaps, verdict, jdSummary, raw };

  return { scores, rationale };
}

// Fresh-scrape fit analysis: ONE LLM call returns both the ATS extraction
// (deterministic scoring) and the rationale text — half the per-job calls of
// analyzeFitScores + generateFitRationale (which stay for resumable retries).
export async function analyzeFit(
  jobDescription: string,
  masterResumePath: string
): Promise<{ scores: FitScores; rationale: FitRationale }> {
  const resumeText = await readResumeTextAsync(masterResumePath);
  const prompt = COMBINED_FIT_PROMPT
    .replace("{job_description}", jobDescription.slice(0, 4000))
    .replace("{resume_text}", resumeText.slice(0, 3000));
  const raw = await callLlm(prompt, 1400, undefined, getFastModel() ?? undefined);
  const parsed = (extractJsonObject(raw) as Record<string, unknown> | null) ?? {};
  return buildFitResult(parsed, resumeText);
}

// Stage B — slower: rationale text only. Resolves in another ~2-3 s.
// Independent of Stage A so they can pipeline across many jobs.
export async function generateFitRationale(
  jobDescription: string,
  masterResumePath: string
): Promise<FitRationale> {
  const resumeText = await readResumeTextAsync(masterResumePath);
  const rationalePrompt = RATIONALE_PROMPT
    .replace("{job_description}", jobDescription.slice(0, 4000))
    .replace("{resume_text}", resumeText.slice(0, 3000));
  const raw = await callLlm(rationalePrompt, 512, undefined, getFastModel() ?? undefined);
  return {
    raw,
    strengths: parseFitField(raw, "STRENGTHS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    gaps: parseFitField(raw, "GAPS")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    verdict: parseFitField(raw, "VERDICT"),
    jdSummary: parseFitField(raw, "JD_SUMMARY"),
  };
}

// Compatibility wrapper for call sites that want both. New code should
// prefer Stage A + Stage B so the score lands in the DB before the
// rationale completes.
export async function generateFitSummary(
  jobDescription: string,
  masterResumePath: string
): Promise<FitResult> {
  const scores = await analyzeFitScores(jobDescription, masterResumePath);
  const rationale = await generateFitRationale(jobDescription, masterResumePath);
  return { ...scores, ...rationale, categories: [] };
}
