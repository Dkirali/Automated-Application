import { NextResponse } from "next/server";
import { getPendingJobs } from "@/lib/db";
import { getStatus } from "@/lib/campaign";

export async function GET() {
  const pending = getPendingJobs();
  // Count fully-analyzed pending jobs so the dashboard can auto-refresh the
  // moment a job's fit analysis completes (scores/summary fill in) — not only
  // when a brand-new job is added.
  const analyzed_count = pending.filter(
    (j) =>
      j.fit_score !== null &&
      j.fit_score !== undefined &&
      j.fit_summary !== null &&
      j.fit_summary !== undefined &&
      j.fit_summary !== ""
  ).length;
  return NextResponse.json({
    status: getStatus(),
    pending_count: pending.length,
    analyzed_count,
  });
}
