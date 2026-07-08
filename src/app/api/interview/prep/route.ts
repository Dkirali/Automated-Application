import { NextRequest, NextResponse } from "next/server";
import { getApplication, getConfig, setInterviewPrep } from "@/lib/db";
import {
  readResumeTextAsync,
  extractMasterFactsSmart,
  getActiveModel,
  RateLimitError,
} from "@/lib/resume";
import { generateInterviewPrep } from "@/lib/interview";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { id } = (await request.json().catch(() => ({}))) as { id?: number };
  if (!id) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const app = getApplication(Number(id));
  if (!app) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  if (!getActiveModel()) {
    return NextResponse.json({ ok: false, reason: "no_provider" }, { status: 400 });
  }

  const masterPath = getConfig("master_resume_path");
  if (!masterPath) {
    return NextResponse.json({ ok: false, reason: "no_master_resume" }, { status: 400 });
  }

  try {
    const resumeText = await readResumeTextAsync(masterPath);
    const facts = await extractMasterFactsSmart(resumeText);
    const prep = await generateInterviewPrep(
      {
        title: (app.title as string) ?? "",
        company: (app.company as string) ?? "",
        jdSummary: (app.jd_summary as string) ?? null,
        jobDescription: (app.job_description as string) ?? null,
      },
      facts
    );
    setInterviewPrep(Number(id), JSON.stringify(prep));
    return NextResponse.json({ ok: true, prep });
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, reason: "rate_limited", retryAt: e.retryAt },
        { status: 429 }
      );
    }
    console.error("[interview/prep] failed:", e);
    return NextResponse.json({ ok: false, reason: "prep_failed" }, { status: 500 });
  }
}
