import { NextRequest, NextResponse } from "next/server";
import { getApplication, getConfig, getConn, updateApplication } from "@/lib/db";
import { tailorResume } from "@/lib/resume";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  const job = getApplication(appId);
  if (!job) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const formData = await request.formData();
  const preferredModel = (formData.get("model") as string) || "auto";

  // Preserve existing keywords for ATS score stability
  const storedKeywordsStr = job.keywords || "";
  const storedKeywords = storedKeywordsStr
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

  // Reset job state
  updateApplication(appId, "pending");
  const db = getConn();
  db.prepare(
    "UPDATE applications SET resume_path=NULL, ats_score=NULL, original_ats_score=NULL, model_used=NULL WHERE id=?"
  ).run(appId);

  // Run tailoring in background
  (async () => {
    const masterPath = getConfig("master_resume_path");
    const jd = job.job_description || "";
    if (!masterPath || !jd) return;

    try {
      const tailor = await tailorResume(
        appId,
        jd,
        masterPath,
        storedKeywords.length ? storedKeywords : undefined,
        preferredModel,
        job.title
      );
      updateApplication(appId, "reviewed", {
        atsScore: tailor.atsScore,
        originalAtsScore: tailor.originalAtsScore,
        keywords: tailor.keywordsStr,
        resumePath: tailor.docxPath,
        modelUsed: tailor.modelUsed,
      });
    } catch {
      updateApplication(appId, "failed");
    }
  })();

  return NextResponse.json({ ok: true, id: appId });
}
