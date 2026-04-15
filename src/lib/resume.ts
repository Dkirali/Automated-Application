import { readFileSync } from "fs";
import { resolve } from "path";

// ── Constants ───────────────────────────────────────────────────────────

const RESUMES_DIR = resolve(process.cwd(), "resumes");

const CANDIDATE_HEADER = {
  name: "Doruk Kirali",
  phone: "0532 286 04 61",
  email: "kiralidoruk@gmail.com",
  linkedin: "linkedin.com/in/doruk-kirali",
  github: "github.com/Dkirali",
};

const CONTACT_SKIP_PATTERNS = [
  "kiralidoruk@gmail.com",
  "0532",
  "doruk-kirali",
  "dkirali",
  "linkedin.com/in/doruk",
  "github.com/dkirali",
];

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

Task:
1. Extract the 8-12 most important ATS keywords from the job posting (skills, tools, methodologies, titles).
2. Rewrite the resume experience bullet points to incorporate these keywords where truthful.
   CRITICAL RULES for keyword incorporation:
   - Keywords must appear as PART OF THE NATURAL SENTENCE describing what was done. Good: "Led sprint planning using Agile methodologies". Bad: "Led sprint planning, demonstrating Agile skills".
   - NEVER append keyword labels to the end of a sentence (e.g. "showcasing Operational Efficiency", "utilizing Stakeholder Management", "demonstrating Communication skills"). This reads as spam.
   - NEVER start or end a bullet with a generic phrase like "applying X and Y skills" or "ensuring effective Z". Instead, describe the ACTUAL WORK that used those skills.
   - Each bullet should describe a concrete action and result, not list skill categories.
   - If a keyword cannot be naturally woven into existing content, place it in the SKILLS section instead.
3. Do NOT invent experience. Only rephrase existing content to better match the posting.
4. Format the RESUME block as plain text (no Markdown, no HTML):
   - Section headings in ALL CAPS on their own line (e.g. PROFESSIONAL EXPERIENCE, EDUCATION, SKILLS, CERTIFICATES)
   - Each role: "Company Name | Location | Start–End" on one line, then the job title on the next line
   - Use • for main bullet points, - for sub-bullets
   - Do NOT include the candidate name, phone, email, LinkedIn, or GitHub — those are added separately
5. In the CERTIFICATES section, always include these two courses if not already present:
   - Udemy — AI Coder: Vibe Coder to Agentic Engineer in 3 Weeks
   - Udemy — AI Engineer Agentic Track: The Complete Agent & MCP Course
6. You MAY add new bullet points to existing experience roles if the job posting requires a skill the candidate demonstrably has from their history. Do NOT invent entirely new roles or technologies not present anywhere in the resume.
7. Only use the keyword "AI" where it genuinely refers to artificial intelligence concepts. Do NOT treat words like "main", "rain", or "training" as containing the keyword "AI".

Respond in this exact format:
KEYWORDS: keyword1, keyword2, keyword3, ...
RESUME:
[Full rewritten resume as plain text, starting directly with the first section heading]`;

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
  preferredModel: string = "auto"
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

  // Provider helpers
  const groq = async (): Promise<string> => {
    const Groq = require("groq-sdk");
    const client = new Groq({ apiKey: groqKey });
    const message = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: maxTokens,
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
      "groq/llama-3.3-70b": { label: "Groq/Llama-3.3-70B", fn: groq, key: groqKey },
      "openrouter/gpt-oss-120b": {
        label: "OpenRouter/gpt-oss-120b:free",
        fn: () => orCall("openai/gpt-oss-120b:free"),
        key: openrouterKey,
      },
      "openrouter/minimax-m2.5": {
        label: "OpenRouter/minimax-m2.5:free",
        fn: () => orCall("minimax/minimax-m2.5:free"),
        key: openrouterKey,
      },
      "openrouter/free": {
        label: "OpenRouter/free",
        fn: () => orCall("openrouter/free"),
        key: openrouterKey,
      },
      "anthropic/claude-sonnet": {
        label: "Anthropic/Claude-Sonnet",
        fn: anthropic,
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
    const result = await callProvider("Groq/Llama-3.3-70B", groq);
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
      const result = await callProvider(m.label, () => orCall(m.id));
      if (result !== null) {
        setLastModel(m.label);
        trackUsage(m.key);
        return result;
      }
      errors.push(m.label);
    }
  }

  if (anthropicKey) {
    const result = await callProvider("Anthropic/Claude-Sonnet", anthropic);
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

async function writeTailoredDocx(text: string, outputPath: string, jobTitle?: string): Promise<void> {
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

  // ── Header: Name ──
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: CANDIDATE_HEADER.name, bold: true, size: SIZE_NAME, font: FONT })],
  }));

  // ── Header: Job title subtitle ──
  if (jobTitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: jobTitle, bold: true, size: SIZE_SUBTITLE, font: FONT })],
    }));
  }

  // ── Header: Contact line ──
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({
      text: `${CANDIDATE_HEADER.phone} \u2022 ${CANDIDATE_HEADER.email} \u2022 ${CANDIDATE_HEADER.linkedin} \u2022 ${CANDIDATE_HEADER.github}`,
      size: SIZE_CONTACT, font: FONT, color: "555555",
    })],
  }));

  // ── Parse body ──
  const lines = text.split("\n");
  let i = 0;

  // Skip lines that are the candidate name/contact (LLM sometimes repeats them)
  while (i < lines.length) {
    const t = lines[i].trim().toLowerCase();
    if (CONTACT_SKIP_PATTERNS.some((p) => t.includes(p.toLowerCase())) || t === "" || t === CANDIDATE_HEADER.name.toLowerCase()) {
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

export async function tailorResume(
  jobId: number,
  jobDescription: string,
  masterResumePath: string,
  existingKeywords?: string[],
  preferredModel: string = "auto",
  jobTitle?: string
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

  const responseText = await callLlm(
    TAILOR_PROMPT.replace("{job_description}", jobDescription).replace(
      "{resume_text}",
      resumeText
    ),
    2048,
    preferredModel
  );

  const keywords = existingKeywords ?? extractKeywordsFromResponse(responseText);
  let tailoredText = extractResumeFromResponse(responseText);
  if (!tailoredText) tailoredText = resumeText;

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
  await writeTailoredDocx(tailoredText, docxPath, jobTitle);

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
