import { redirect } from "next/navigation";
import { getApplication, getConfig } from "@/lib/db";
import {
  parseFitScore,
  parseFitField,
  parseFitCategories,
  readResumeTextAsync,
  type FitCategory,
} from "@/lib/resume";
import {
  calculateKeywordCoverage,
  type JobRequirements,
} from "@/lib/fit-scoring";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tailoring?: string }>;
}

function safeParseRequirements(json: string | null | undefined): JobRequirements | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return {
      required_keywords: Array.isArray(o.required_keywords) ? o.required_keywords : [],
      preferred_keywords: Array.isArray(o.preferred_keywords) ? o.preferred_keywords : [],
      hard_requirements: Array.isArray(o.hard_requirements) ? o.hard_requirements : [],
    };
  } catch {
    return null;
  }
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const appId = Number(id);
  const job = getApplication(appId);

  if (!job || !["pending", "reviewed", "failed"].includes(job.status)) {
    redirect("/");
  }

  const raw = job.fit_summary || "";
  const requirements = safeParseRequirements(job.requirements_json);

  // v2 columns when available, otherwise fall back to parsing the legacy raw text
  const storedFit = typeof job.fit_score === "number" ? job.fit_score : null;
  const fit_score = storedFit ?? parseFitScore(raw);

  let categories: FitCategory[] = [];
  let matchedRequired: string[] = [];
  let missedRequired: string[] = [];
  let matchedPreferred: string[] = [];
  let missedPreferred: string[] = [];

  if (requirements && job.keyword_score !== null && job.keyword_score !== undefined) {
    // v2 — recompute hits/misses from the master resume so we can render
    // matched/missed chips. Keyword score itself is the stored value.
    const masterPath = getConfig("master_resume_path");
    if (masterPath) {
      try {
        const resumeText = await readResumeTextAsync(masterPath);
        const coverage = calculateKeywordCoverage(
          requirements.required_keywords,
          requirements.preferred_keywords,
          resumeText
        );
        matchedRequired = coverage.requiredHits;
        missedRequired = coverage.requiredMisses;
        matchedPreferred = coverage.preferredHits;
        missedPreferred = coverage.preferredMisses;
      } catch {
        // file gone or unreadable — leave hit/miss lists empty
      }
    }

    const reqStr = `${requirements.required_keywords.length} required keywords · ${requirements.preferred_keywords.length} preferred`;
    const hardMet = requirements.hard_requirements.filter((r) => r.met).length;
    const hardStr =
      requirements.hard_requirements.length === 0
        ? "No hard requirements detected"
        : `${hardMet} of ${requirements.hard_requirements.length} met`;

    categories = [
      {
        key: "SKILLS",
        label: "Keyword Coverage",
        score: job.keyword_score ?? 0,
        rationale: reqStr,
      },
      {
        key: "EXPERIENCE",
        label: "Hard Requirements",
        score: job.hardreq_score ?? 0,
        rationale: hardStr,
      },
      {
        key: "SENIORITY",
        label: "Resume Parseability",
        score: job.parseability_score ?? 0,
        rationale: "ATS structure: sections, contact, dates",
      },
    ];
  } else {
    // Legacy row — keep the old sub-categories
    categories = parseFitCategories(raw);
  }

  const fit = {
    fit_score,
    strengths: parseFitField(raw, "STRENGTHS").split(",").map((s: string) => s.trim()).filter(Boolean),
    gaps: parseFitField(raw, "GAPS").split(",").map((g: string) => g.trim()).filter(Boolean),
    verdict: parseFitField(raw, "VERDICT") || raw,
    jd_summary: job.jd_summary,
    jd_keywords: job.keywords,
    categories,
    requirements,
    matchedRequired,
    missedRequired,
    matchedPreferred,
    missedPreferred,
  };

  const tailoringInProgress = !!sp.tailoring;

  return (
    <ReviewClient
      job={job}
      fit={fit}
      tailoringInProgress={tailoringInProgress}
    />
  );
}
