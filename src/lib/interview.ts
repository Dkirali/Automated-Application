// Interview prep (Pillar 3): generate likely interview questions + guidance for
// a tracked application. Uses real web-sourced questions via Exa when EXA_API_KEY
// is set, otherwise falls back to LLM-generated questions from the role + JD.
import {
  callLlm,
  extractJsonObject,
  getActiveModel,
  type MasterResumeFacts,
} from "./resume";

export interface InterviewQuestion {
  q: string;
  why: string; // why they ask it
  answerHint: string; // how this candidate should approach it
}

export interface InterviewPrep {
  questions: InterviewQuestion[];
  tips: string[];
  sourced: boolean; // true when grounded in real web results (Exa)
  sources: string[]; // URLs, when sourced
  generatedAt: string;
}

export interface PrepInput {
  title: string;
  company: string;
  jdSummary?: string | null;
  jobDescription?: string | null;
}

interface ExaResult {
  snippets: string[];
  urls: string[];
}

// Query Exa for real interview questions. Returns null when no key is configured
// so the caller falls back to pure-LLM generation.
async function fetchExaQuestions(
  company: string,
  role: string
): Promise<ExaResult | null> {
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query: `${company} ${role} interview questions candidates were asked`,
        numResults: 6,
        type: "auto",
        contents: { text: { maxCharacters: 1200 } },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { url?: string; text?: string; title?: string }[];
    };
    const results = data.results ?? [];
    return {
      snippets: results.map((r) => (r.text || r.title || "").trim()).filter(Boolean),
      urls: results.map((r) => r.url || "").filter(Boolean),
    };
  } catch {
    return null;
  }
}

function candidateBrief(facts: MasterResumeFacts): string {
  const roles = [...facts.roles, ...facts.additionalRoles]
    .slice(0, 6)
    .map((r) => `${r.role} @ ${r.company}`)
    .join("; ");
  return [
    roles && `Experience: ${roles}`,
    facts.education.length && `Education: ${facts.education.map((e) => e.degree).join(", ")}`,
    facts.languages.length && `Languages: ${facts.languages.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const PREP_PROMPT = `You are an interview coach. Produce interview prep for a candidate interviewing for the role below.

Return ONLY a JSON object, no prose:
{
  "questions": [ { "q": "<question>", "why": "<why interviewers ask it>", "answerHint": "<how THIS candidate should approach it, referencing their background>" } ],  // 6-10 items
  "tips": ["<short prep tip>", ...]   // 3-5 items
}

Mix role-specific behavioral, technical/domain, and company-fit questions. Ground answer hints in the candidate's actual background. Do not invent facts about the candidate or company.

ROLE: {role}
COMPANY: {company}
JOB SUMMARY: {jd}
CANDIDATE:
{candidate}
{sourced}`;

/**
 * Generate interview prep for one application. Web-sources real questions via Exa
 * when available, then has the LLM synthesize a tailored prep sheet.
 */
export async function generateInterviewPrep(
  input: PrepInput,
  facts: MasterResumeFacts
): Promise<InterviewPrep> {
  const exa = await fetchExaQuestions(input.company, input.title);

  const sourcedBlock = exa?.snippets.length
    ? `\nREAL QUESTIONS/NOTES FOUND ON THE WEB (prioritize and adapt these):\n${exa.snippets
        .slice(0, 6)
        .map((s, i) => `${i + 1}. ${s.slice(0, 400)}`)
        .join("\n")}`
    : "";

  const prompt = PREP_PROMPT.replace("{role}", input.title)
    .replace("{company}", input.company)
    .replace("{jd}", (input.jdSummary || input.jobDescription || "n/a").slice(0, 1500))
    .replace("{candidate}", candidateBrief(facts))
    .replace("{sourced}", sourcedBlock);

  const raw = await callLlm(
    prompt,
    1600,
    (t) => (extractJsonObject(t) ? { ok: true } : { ok: false, errors: ["not JSON"] }),
    getActiveModel() ?? undefined
  );
  const parsed = (extractJsonObject(raw) ?? {}) as {
    questions?: InterviewQuestion[];
    tips?: string[];
  };

  return {
    questions: (parsed.questions ?? []).filter((q) => q && q.q).slice(0, 10),
    tips: (parsed.tips ?? []).filter(Boolean).slice(0, 5),
    sourced: !!exa?.snippets.length,
    sources: exa?.urls ?? [],
    // caller stamps a real timestamp (Date is unavailable in some sandboxes here,
    // but this runs in the Node server route where it's fine)
    generatedAt: new Date().toISOString(),
  };
}
