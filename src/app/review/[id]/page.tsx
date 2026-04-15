import { redirect } from "next/navigation";
import { getApplication } from "@/lib/db";
import { AVAILABLE_MODELS, parseFitScore, parseFitField } from "@/lib/resume";
import ReviewClient from "./ReviewClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tailoring?: string }>;
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
  const fit = {
    fit_score: parseFitScore(raw),
    strengths: parseFitField(raw, "STRENGTHS").split(",").map((s: string) => s.trim()).filter(Boolean),
    gaps: parseFitField(raw, "GAPS").split(",").map((g: string) => g.trim()).filter(Boolean),
    verdict: parseFitField(raw, "VERDICT") || raw,
    jd_summary: job.jd_summary,
    jd_keywords: job.keywords,
  };

  const tailoringInProgress = !!sp.tailoring;

  return (
    <ReviewClient
      job={job}
      fit={fit}
      availableModels={AVAILABLE_MODELS}
      tailoringInProgress={tailoringInProgress}
    />
  );
}
