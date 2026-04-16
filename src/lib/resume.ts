import { readFileSync } from "fs";
import { resolve } from "path";

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

const MANDATORY_CERTIFICATES = [
  "Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks",
  "Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course",
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

export const AVAILABLE_MODELS: Record<string, string> = {
  auto: "Auto (best available)",
  "groq/llama-3.3-70b": "Groq — Llama 3.3 70B",
  "openrouter/gpt-oss-120b": "OpenRouter — GPT-OSS 120B",
  "openrouter/minimax-m2.5": "OpenRouter — MiniMax M2.5",
  "openrouter/free": "OpenRouter — Best Free",
  "anthropic/claude-sonnet": "Anthropic — Claude Sonnet",
};

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
JD_KEYWORDS: keyword1, keyword2, keyword3, ... <8-12 most important ATS/skills keywords from the job posting>`;

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

CERTIFICATES section MUST include these two lines verbatim (plus any others already in the resume):
Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course

LANGUAGES section MUST list every language from GROUND TRUTH, one per line, e.g.:
Turkish – Native
English – Native

Respond in this exact format (no Markdown, no HTML, no extra commentary):
KEYWORDS: keyword1, keyword2, keyword3, ...
RESUME:
[Full rewritten resume as plain text, starting directly with "PROFESSIONAL EXPERIENCE"]`;

// ── Rate limiting ───────────────────────────────────────────────────────

const LLM_MIN_INTERVAL = 4000; // ms between LLM calls
let llmLastCall = 0;

// ── Last model tracking ────────────────────────────────────────────────

let lastModelUsed = "—";

export function getLastModelUsed(): string {
  return lastModelUsed;
}

function setLastModel(name: string): void {
  lastModelUsed = name;
}

function trackUsage(modelKey: string): void {
  try {
    const { incrementApiUsage } = require("./db");
    incrementApiUsage(modelKey);
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

  // 7. Mandatory Udemy certificates present
  for (const cert of MANDATORY_CERTIFICATES) {
    if (!output.includes(cert)) {
      errors.push(`Missing mandatory certificate: ${cert}`);
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

async function callProvider(
  name: string,
  fn: () => Promise<string>
): Promise<string | null> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      console.error(`[LLM] ${name} attempt ${attempt + 1} failed:`, e);
      const errStr = String(e).toLowerCase();
      const isRateLimit =
        errStr.includes("429") ||
        errStr.includes("rate") ||
        errStr.includes("quota") ||
        errStr.includes("resource_exhausted");
      if (isRateLimit) return null;
      if (attempt === maxRetries - 1) return null;
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  return null;
}

async function callLlm(
  prompt: string,
  maxTokens: number = 2048,
  preferredModel: string = "auto",
  validate?: (text: string) => { ok: true } | { ok: false; errors: string[] }
): Promise<string> {
  // Enforce minimum interval
  const now = Date.now();
  const elapsed = now - llmLastCall;
  if (elapsed < LLM_MIN_INTERVAL) {
    await new Promise((r) => setTimeout(r, LLM_MIN_INTERVAL - elapsed));
  }
  llmLastCall = Date.now();

  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const errors: string[] = [];

  // Wrap a raw provider call with validation. On validation failure, throw
  // so the outer callProvider retry/fallthrough treats it as a recoverable error.
  const withValidation = (fn: () => Promise<string>): (() => Promise<string>) => {
    if (!validate) return fn;
    return async () => {
      const text = await fn();
      const result = validate(text);
      if (!result.ok) {
        console.error(
          "[LLM] Validation failed:",
          result.errors.slice(0, 5).join("; ")
        );
        throw new Error(`Validation failed: ${result.errors[0] ?? "unknown"}`);
      }
      return text;
    };
  };

  // Provider helpers — all use temperature 0 + top_p 0.1 for determinism
  const groq = async (): Promise<string> => {
    const Groq = require("groq-sdk");
    const client = new Groq({ apiKey: groqKey });
    const message = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: maxTokens,
      temperature: 0,
      top_p: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    return message.choices[0].message.content;
  };

  const orCall = async (modelId: string): Promise<string> => {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JobBot",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: maxTokens,
        temperature: 0,
        top_p: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${resp.statusText}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`Empty response from ${modelId}`);
    return content;
  };

  const anthropic = async (): Promise<string> => {
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: anthropicKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      temperature: 0,
      top_p: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    return message.content[0].text;
  };

  // Specific model requested
  if (preferredModel && preferredModel !== "auto") {
    const MODEL_MAP: Record<
      string,
      { label: string; fn: () => Promise<string>; key: string | undefined }
    > = {
      "groq/llama-3.3-70b": { label: "Groq/Llama-3.3-70B", fn: withValidation(groq), key: groqKey },
      "openrouter/gpt-oss-120b": {
        label: "OpenRouter/gpt-oss-120b:free",
        fn: withValidation(() => orCall("openai/gpt-oss-120b:free")),
        key: openrouterKey,
      },
      "openrouter/minimax-m2.5": {
        label: "OpenRouter/minimax-m2.5:free",
        fn: withValidation(() => orCall("minimax/minimax-m2.5:free")),
        key: openrouterKey,
      },
      "openrouter/free": {
        label: "OpenRouter/free",
        fn: withValidation(() => orCall("openrouter/free")),
        key: openrouterKey,
      },
      "anthropic/claude-sonnet": {
        label: "Anthropic/Claude-Sonnet",
        fn: withValidation(anthropic),
        key: anthropicKey,
      },
    };

    const entry = MODEL_MAP[preferredModel];
    if (entry?.key) {
      const result = await callProvider(entry.label, entry.fn);
      if (result !== null) {
        setLastModel(entry.label);
        trackUsage(preferredModel);
        return result;
      }
    }
    throw new Error(`Model ${preferredModel} failed — no API key or provider error`);
  }

  // Auto cascade: Groq → OpenRouter → Anthropic
  if (groqKey) {
    const result = await callProvider("Groq/Llama-3.3-70B", withValidation(groq));
    if (result !== null) {
      setLastModel("Groq/Llama-3.3-70B");
      trackUsage("groq/llama-3.3-70b");
      return result;
    }
    errors.push("Groq");
  }

  if (openrouterKey) {
    const orModels = [
      { id: "openai/gpt-oss-120b:free", label: "OpenRouter/gpt-oss-120b:free", key: "openrouter/gpt-oss-120b" },
      { id: "minimax/minimax-m2.5:free", label: "OpenRouter/minimax-m2.5:free", key: "openrouter/minimax-m2.5" },
      { id: "openrouter/free", label: "OpenRouter/free", key: "openrouter/free" },
    ];
    for (const m of orModels) {
      const result = await callProvider(m.label, withValidation(() => orCall(m.id)));
      if (result !== null) {
        setLastModel(m.label);
        trackUsage(m.key);
        return result;
      }
      errors.push(m.label);
    }
  }

  if (anthropicKey) {
    const result = await callProvider("Anthropic/Claude-Sonnet", withValidation(anthropic));
    if (result !== null) {
      setLastModel("Anthropic/Claude-Sonnet");
      trackUsage("anthropic/claude-sonnet");
      return result;
    }
    errors.push("Anthropic");
  }

  if (errors.length) {
    throw new Error(`All LLM providers failed: ${errors.join(", ")}`);
  }
  throw new Error("No API key set — add a Groq, OpenRouter, or Anthropic key in Settings");
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
  existingKeywords?: string[],
  preferredModel: string = "auto"
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

  const responseText = await callLlm(prompt, 3000, preferredModel, (text) => {
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
    modelUsed: getLastModelUsed(),
  };
}

export async function generateFitSummary(
  jobDescription: string,
  masterResumePath: string
): Promise<{
  fitScore: number;
  strengths: string[];
  gaps: string[];
  verdict: string;
  jdSummary: string;
  jdKeywords: string;
  raw: string;
}> {
  const resumeText = await readResumeTextAsync(masterResumePath);

  const raw = await callLlm(
    FIT_PROMPT.replace("{job_description}", jobDescription.slice(0, 4000)).replace(
      "{resume_text}",
      resumeText.slice(0, 3000)
    ),
    512
  );

  return {
    fitScore: parseFitScore(raw),
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
    jdKeywords: parseFitField(raw, "JD_KEYWORDS"),
    raw,
  };
}
