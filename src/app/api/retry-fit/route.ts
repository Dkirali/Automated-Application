import { NextResponse } from "next/server";
import { getConn, getConfig, updateApplication } from "@/lib/db";
import { generateFitSummary } from "@/lib/resume";

let _running = false;

export async function POST(): Promise<NextResponse> {
  if (_running) {
    return NextResponse.json({ started: false, reason: "already_running" });
  }

  const masterPath = getConfig("master_resume_path");
  if (!masterPath) {
    return NextResponse.json({ started: false, reason: "no_master_resume" });
  }

  const stale = getConn()
    .prepare(
      `SELECT id, job_description FROM applications
       WHERE status IN ('pending','reviewed')
         AND fit_summary IS NULL
         AND job_description IS NOT NULL
         AND job_description != ''`
    )
    .all() as { id: number; job_description: string }[];

  if (!stale.length) {
    return NextResponse.json({ started: false, reason: "none_pending" });
  }

  _running = true;

  // Run in background
  (async () => {
    try {
      for (const job of stale) {
        try {
          const fit = await generateFitSummary(job.job_description, masterPath);
          updateApplication(job.id, "reviewed", {
            fitSummary: fit.raw,
            jdSummary: fit.jdSummary,
          });
        } catch (e) {
          console.error(`[retry-fit] Job ${job.id} failed:`, e);
        }
      }
    } finally {
      _running = false;
    }
  })();

  return NextResponse.json({ started: true, count: stale.length });
}
