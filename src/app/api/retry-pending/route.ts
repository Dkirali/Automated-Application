import { NextRequest, NextResponse } from "next/server";
import { getPendingJobs, getConfig, updateApplication } from "@/lib/db";
import { tailorResume, generateFitSummary } from "@/lib/resume";

export async function POST(request: NextRequest) {
  const pending = getPendingJobs().filter((j) => j.status === "pending");
  if (!pending.length) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  // Run tailoring in background
  (async () => {
    const masterPath = getConfig("master_resume_path");
    if (!masterPath) return;

    for (const job of pending) {
      const jd = job.job_description || "";
      if (!jd) continue;

      try {
        const tailor = await tailorResume(job.id, jd, masterPath, undefined, "auto");
        updateApplication(job.id, "reviewed", {
          atsScore: tailor.atsScore,
          originalAtsScore: tailor.originalAtsScore,
          keywords: tailor.keywordsStr,
          resumePath: tailor.docxPath,
        });
      } catch {
        updateApplication(job.id, "failed");
        continue;
      }

      try {
        const fit = await generateFitSummary(jd, masterPath);
        updateApplication(job.id, "reviewed", {
          fitSummary: fit.raw,
          jdSummary: fit.jdSummary,
        });
      } catch {
        // non-fatal
      }
    }
  })();

  return NextResponse.redirect(new URL("/", request.url), 303);
}
