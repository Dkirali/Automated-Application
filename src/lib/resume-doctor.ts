// Resume Doctor (Pillar 1): validate & improve a resume against ATS + general
// standards, and suggest matching roles. Reuses the existing LLM + scoring stack.
import {
  callLlm,
  extractJsonObject,
  getFastModel,
  parseCandidateHeader,
  type MasterResumeFacts,
} from "./resume";
import { calculateParseability } from "./fit-scoring";

export type Severity = "high" | "medium" | "low";

export interface ResumeFinding {
  severity: Severity;
  category: string; // e.g. "Impact", "Action verbs", "Formatting"
  issue: string; // what's wrong
  fix: string; // concrete, actionable suggestion
}

export interface ResumeAudit {
  atsParseability: number; // deterministic 0–100 (ATS-friendliness of structure)
  standardsScore: number; // LLM 0–100 (writing/impact/quality)
  overall: number; // blended 0–100
  wordCount: number;
  strengths: string[];
  findings: ResumeFinding[]; // prioritized, most severe first
}

export interface RoleSuggestion {
  title: string;
  seniority: string; // e.g. "Senior", "Lead", "Mid-level"
  matchStrength: "strong" | "moderate" | "stretch";
  rationale: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const AUDIT_PROMPT = `You are a professional resume reviewer and ATS expert. Audit the RESUME below against general resume best practices (quantified impact, strong action verbs, concise bullets, clear sections, appropriate length, consistent formatting, no fluff) and ATS-friendliness.

Return ONLY a JSON object, no prose, in exactly this shape:
{
  "standardsScore": <integer 0-100 overall quality>,
  "strengths": ["short strength", ...],   // 2-5 items
  "findings": [
    { "severity": "high|medium|low", "category": "<short category>", "issue": "<what's weak>", "fix": "<specific, actionable rewrite guidance>" }
  ]                                          // 4-10 items, most important first
}

Be specific and actionable in each "fix" (name the section/bullet and how to improve it). Do not invent facts about the candidate.

RESUME:
"""
{resume}
"""`;

const ROLES_PROMPT = `You are a career advisor. Based on the candidate FACTS and RESUME below, suggest job titles this candidate is well-positioned to apply for right now.

Return ONLY a JSON object, no prose, in exactly this shape:
{
  "roles": [
    { "title": "<job title>", "seniority": "<e.g. Senior / Lead / Mid-level>", "matchStrength": "strong|moderate|stretch", "rationale": "<one sentence tied to their background>" }
  ]                                          // 5-8 roles, strongest first
}

Base titles on the candidate's actual experience and seniority. "stretch" = a reasonable next step up. Do not invent experience.

FACTS:
{facts}

RESUME (first part):
"""
{resume}
"""`;

function isJson(text: string): { ok: true } | { ok: false; errors: string[] } {
  return extractJsonObject(text) ? { ok: true } : { ok: false, errors: ["not JSON"] };
}

function factsSummary(facts: MasterResumeFacts): string {
  const roles = [...facts.roles, ...facts.additionalRoles]
    .map((r) => `- ${r.role} @ ${r.company} (${r.dates})`)
    .join("\n");
  const edu = facts.education.map((e) => `- ${e.degree} @ ${e.school}`).join("\n");
  return [
    `Roles:\n${roles || "(none parsed)"}`,
    `Education:\n${edu || "(none parsed)"}`,
    facts.languages.length ? `Languages: ${facts.languages.join(", ")}` : "",
    facts.certificates.length ? `Certificates: ${facts.certificates.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Audit a resume: deterministic ATS parseability + an LLM standards review,
 * blended into an overall score with a prioritized fix list.
 */
export async function auditResume(resumeText: string): Promise<ResumeAudit> {
  const atsParseability = calculateParseability(resumeText);
  const wordCount = (resumeText.match(/\S+/g) || []).length;

  const prompt = AUDIT_PROMPT.replace("{resume}", resumeText.slice(0, 8000));
  const raw = await callLlm(prompt, 1500, isJson, getFastModel() ?? undefined);
  const parsed = (extractJsonObject(raw) ?? {}) as {
    standardsScore?: number;
    strengths?: string[];
    findings?: ResumeFinding[];
  };

  const standardsScore = clampScore(parsed.standardsScore, 0);
  const findings = (parsed.findings ?? [])
    .filter((f) => f && f.issue && f.fix)
    .sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
    );
  const strengths = (parsed.strengths ?? []).filter(Boolean).slice(0, 5);

  // Blend: structure (parseability) 40% + writing quality 60%.
  const overall = Math.round(0.4 * atsParseability + 0.6 * standardsScore);

  return { atsParseability, standardsScore, overall, wordCount, strengths, findings };
}

/**
 * Suggest job titles the candidate is well-positioned for, ranked strongest-first.
 */
export async function suggestRoles(
  resumeText: string,
  facts: MasterResumeFacts
): Promise<RoleSuggestion[]> {
  const prompt = ROLES_PROMPT.replace("{facts}", factsSummary(facts)).replace(
    "{resume}",
    resumeText.slice(0, 5000)
  );
  const raw = await callLlm(prompt, 900, isJson, getFastModel() ?? undefined);
  const parsed = (extractJsonObject(raw) ?? {}) as { roles?: RoleSuggestion[] };
  const rank = { strong: 0, moderate: 1, stretch: 2 } as const;
  return (parsed.roles ?? [])
    .filter((r) => r && r.title)
    .sort((a, b) => (rank[a.matchStrength] ?? 3) - (rank[b.matchStrength] ?? 3))
    .slice(0, 8);
}

/** Header contact fields, reused for display (name/email/etc.). */
export function candidateName(resumeText: string, facts: MasterResumeFacts): string | undefined {
  return parseCandidateHeader(resumeText, facts).name;
}

function clampScore(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}
