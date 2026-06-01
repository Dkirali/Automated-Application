import { readFileSync } from "fs";
import { resolve } from "path";
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
}

export const PROVIDER_MODELS: Record<ActiveProvider, ActiveModel> = {
  groq: {
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    displayName: "Groq / Llama 3.3 70B",
    envKey: "GROQ_API_KEY",
    usageKey: "groq/llama-3.3-70b",
  },
  anthropic: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    displayName: "Anthropic / Claude Sonnet",
    envKey: "ANTHROPIC_API_KEY",
    usageKey: "anthropic/claude-sonnet",
  },
  openrouter: {
    provider: "openrouter",
    modelId: "openai/gpt-oss-120b:free",
    displayName: "OpenRouter / GPT-OSS 120B",
    envKey: "OPENROUTER_API_KEY",
    usageKey: "openrouter/gpt-oss-120b",
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

const FIT_PROMPT = `You are a senior recruiter evaluating a candidate's fit for a role.

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

// Groq free tier is 30 req/min = 1 every 2 s. 2000 ms keeps us under the
// limit while doubling throughput vs. the previous 4 s.
const LLM_MIN_INTERVAL = 2000;
let llmLastCall = 0;

function trackUsage(usageKey: string, tokens: number = 0): void {
  try {
    const { incrementApiUsage } = require("./db");
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

  const languages: string[] = [];
  if (langs) {
    for (const raw of lines.slice(langs.start, langs.end)) {
      const line = raw.trim();
      if (!line) continue;
      const lang = line.split(/[–\-]/)[0].trim();
      if (lang) languages.push(lang);
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

export async function readResumeTextAsync(filePath: string): Promise<string> {
  const ext = filePath.toLowerCase().split(".").pop();
  if (ext === "txt") {
    const { readFileSync } = require("fs");
    return readFileSync(filePath, "utf-8").trim();
  }
  if (ext === "docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value as string).trim();
  }
  if (ext === "doc") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value as string).trim();
  }
  if (ext === "pdf") {
    // pdf-parse has a bug where require() tries to load a test file.
    // Import the core module directly to avoid it.
    const pdfParse = require("pdf-parse/lib/pdf-parse");
    const { readFileSync } = require("fs");
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
interface LlmGlobals { __jobbot_rate_limit_until: number; __jobbot_rate_limit_msg: string }
const llmG = globalThis as unknown as LlmGlobals;
if (llmG.__jobbot_rate_limit_until === undefined) llmG.__jobbot_rate_limit_until = 0;
if (llmG.__jobbot_rate_limit_msg === undefined) llmG.__jobbot_rate_limit_msg = "";

export function getRateLimitState(): { rateLimited: boolean; retryAt: number; message: string } {
  return {
    rateLimited: Date.now() < llmG.__jobbot_rate_limit_until,
    retryAt: llmG.__jobbot_rate_limit_until,
    message: llmG.__jobbot_rate_limit_msg,
  };
}

function setRateLimited(retryAtMs: number, message: string): void {
  // Take the later of the two — never reduce the back-off window.
  if (retryAtMs > llmG.__jobbot_rate_limit_until) {
    llmG.__jobbot_rate_limit_until = retryAtMs;
    llmG.__jobbot_rate_limit_msg = message;
  }
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
  validate?: (text: string) => { ok: true } | { ok: false; errors: string[] }
): Promise<string> {
  // Already-known rate limit — skip the call so we don't burn time and
  // pile up identical 429s. Surfaces as a RateLimitError so callers can
  // distinguish "give me a few minutes" from "real provider failure".
  const rl = getRateLimitState();
  if (rl.rateLimited) {
    throw new RateLimitError(rl.retryAt, rl.message);
  }
  // Enforce minimum interval
  const now = Date.now();
  const elapsed = now - llmLastCall;
  if (elapsed < LLM_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, LLM_MIN_INTERVAL - elapsed));
  }
  llmLastCall = Date.now();

  const model = getActiveModel();
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
      const Groq = require("groq-sdk");
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
      const Anthropic =
        require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
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
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType,
    TabStopPosition, TabStopType,
  } = require("docx");
  const { writeFileSync } = require("fs");

  const FONT = "Calibri";
  const SIZE_NAME = 28;       // 14pt
  const SIZE_SUBTITLE = 22;   // 11pt
  const SIZE_CONTACT = 18;    // 9pt
  const SIZE_SECTION = 22;    // 11pt
  const SIZE_BODY = 20;       // 10pt
  const SIZE_COMPANY = 21;    // 10.5pt
  const RIGHT_TAB = 9500;     // right-aligned tab position in twips

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
            new TextRun({ text: roleLine, bold: true, size: SIZE_BODY, font: FONT }),
            new TextRun({ text: `\t${parsed.locationDate}`, size: SIZE_BODY, font: FONT, color: "555555" }),
          ],
        }));
      } else {
        // No separate role line — put location on same line
        children.push(new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
          spacing: { after: 60 },
          children: [
            new TextRun({ text: parsed.company, bold: true, size: SIZE_BODY, font: FONT }),
            new TextRun({ text: `\t${parsed.locationDate}`, size: SIZE_BODY, font: FONT, color: "555555" }),
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
        children: [new TextRun({ text: bulletText, size: SIZE_BODY, font: FONT })],
      }));
      continue;
    }

    // Regular paragraph
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: trimmed, size: SIZE_BODY, font: FONT })],
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
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
  const facts = extractMasterFacts(resumeText);
  const header = parseCandidateHeader(resumeText, facts);
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

  const atsScore = calculateAtsScore(keywords, tailoredText);
  const originalAtsScore = calculateAtsScore(
    keywords,
    await readResumeTextAsync(masterResumePath)
  );

  const { mkdirSync, writeFileSync } = require("fs");
  const { join } = require("path");
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
  const raw = await callLlm(prompt, 1200);
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
  const raw = await callLlm(rationalePrompt, 512);
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
