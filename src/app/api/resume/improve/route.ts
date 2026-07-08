import { NextResponse } from "next/server";
import { resolve } from "path";
import { mkdirSync } from "fs";
import { getConfig, setConfig } from "@/lib/db";
import {
  readResumeTextAsync,
  extractMasterFactsSmart,
  parseCandidateHeader,
  writeTailoredDocx,
  getActiveModel,
  RateLimitError,
} from "@/lib/resume";
import { improveResume } from "@/lib/resume-doctor";

export const dynamic = "force-dynamic";

const RESUMES_DIR = process.env.JOBBOT_RESUMES_DIR
  ? resolve(process.env.JOBBOT_RESUMES_DIR)
  : resolve(process.cwd(), "resumes");

export async function POST(): Promise<NextResponse> {
  const masterPath = getConfig("master_resume_path");
  if (!masterPath) {
    return NextResponse.json({ ok: false, reason: "no_master_resume" }, { status: 400 });
  }
  if (!getActiveModel()) {
    return NextResponse.json({ ok: false, reason: "no_provider" }, { status: 400 });
  }

  let resumeText: string;
  try {
    resumeText = await readResumeTextAsync(masterPath);
  } catch {
    return NextResponse.json({ ok: false, reason: "resume_unreadable" }, { status: 400 });
  }
  if (!resumeText.trim()) {
    return NextResponse.json({ ok: false, reason: "resume_empty" }, { status: 400 });
  }

  try {
    const facts = await extractMasterFactsSmart(resumeText);
    const header = parseCandidateHeader(resumeText, facts);
    const { text } = await improveResume(resumeText, facts);

    mkdirSync(RESUMES_DIR, { recursive: true });
    const outPath = resolve(RESUMES_DIR, "improved-master.docx");
    await writeTailoredDocx(text, outPath, header);
    setConfig("resume_improved_path", outPath);

    return NextResponse.json({ ok: true, text, filename: "improved-master.docx" });
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, reason: "rate_limited", retryAt: e.retryAt },
        { status: 429 }
      );
    }
    console.error("[resume/improve] failed:", e);
    return NextResponse.json({ ok: false, reason: "improve_failed" }, { status: 500 });
  }
}
