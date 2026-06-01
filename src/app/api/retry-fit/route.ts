import { NextRequest, NextResponse } from "next/server";
import { getConn, getConfig, updateApplication } from "@/lib/db";
import {
  analyzeFitScores,
  clearRateLimit,
  generateFitRationale,
  getRateLimitState,
  RateLimitError,
} from "@/lib/resume";

let _running = false;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (_running) {
    return NextResponse.json({ started: false, reason: "already_running" });
  }

  // `?force=1` clears any cached back-off and tries anyway. Useful when
  // Groq's reported retry-after over-estimated and the API is actually live.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (force) clearRateLimit();

  const rl = getRateLimitState();
  if (rl.rateLimited) {
    return NextResponse.json({
      started: false,
      reason: "rate_limited",
      retryAt: rl.retryAt,
      message: rl.message,
    });
  }

  const masterPath = getConfig("master_resume_path");
  if (!masterPath) {
    return NextResponse.json({ started: false, reason: "no_master_resume" });
  }

  // A job is "stale" if it lacks either the score (Stage A) or the rationale
  // text (Stage B). Each stage can fail independently — we retry only what
  // is actually missing, never overwriting a successful stage.
  const stale = getConn()
    .prepare(
      `SELECT id, job_description, fit_score, fit_summary FROM applications
       WHERE status IN ('pending','reviewed')
         AND (fit_score IS NULL OR fit_summary IS NULL)
         AND job_description IS NOT NULL
         AND job_description != ''`
    )
    .all() as {
    id: number;
    job_description: string;
    fit_score: number | null;
    fit_summary: string | null;
  }[];

  if (!stale.length) {
    return NextResponse.json({ started: false, reason: "none_pending" });
  }

  _running = true;

  (async () => {
    try {
      for (const job of stale) {
        // Stage A — scores. Skip if we already have a fit_score.
        if (job.fit_score === null) {
          try {
            const scores = await analyzeFitScores(job.job_description, masterPath);
            updateApplication(job.id, "pending", {
              fitScore: scores.fitScore,
              keywordScore: scores.keywordScore,
              hardreqScore: scores.hardreqScore,
              parseabilityScore: scores.parseabilityScore,
              requirementsJson: JSON.stringify(scores.requirements),
            });
          } catch (e) {
            if (e instanceof RateLimitError) {
              console.error(`[retry-fit] rate-limited — stopping; retry after ${new Date(e.retryAt).toISOString()}`);
              return; // bail out of the whole loop, dashboard will back off
            }
            console.error(`[retry-fit] Job ${job.id} scores failed:`, e);
            // Don't continue to rationale if scores failed — the score is the
            // headline number the user sees first.
            continue;
          }
        }

        // Stage B — rationale. Skip if we already have it.
        if (job.fit_summary === null) {
          try {
            const rationale = await generateFitRationale(job.job_description, masterPath);
            updateApplication(job.id, "pending", {
              fitSummary: rationale.raw,
              jdSummary: rationale.jdSummary,
            });
          } catch (e) {
            if (e instanceof RateLimitError) {
              console.error(`[retry-fit] rate-limited — stopping; retry after ${new Date(e.retryAt).toISOString()}`);
              return;
            }
            console.error(`[retry-fit] Job ${job.id} rationale failed:`, e);
          }
        }
      }
    } finally {
      _running = false;
    }
  })();

  return NextResponse.json({ started: true, count: stale.length });
}

export async function GET(): Promise<NextResponse> {
  // Lets the dashboard cheap-check whether a retry is currently in progress
  // and whether the LLM is currently rate-limited so it can back off polling.
  const rl = getRateLimitState();
  return NextResponse.json({
    running: _running,
    rateLimited: rl.rateLimited,
    retryAt: rl.retryAt,
    message: rl.message,
  });
}
