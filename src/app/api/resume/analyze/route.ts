import { NextRequest, NextResponse } from "next/server";
import { statSync } from "fs";
import { getConfig, setConfig } from "@/lib/db";
import {
  readResumeTextAsync,
  extractMasterFactsSmart,
  getActiveModel,
  RateLimitError,
} from "@/lib/resume";
import { auditResume, suggestRoles, candidateName } from "@/lib/resume-doctor";

export const dynamic = "force-dynamic";

const CACHE_KEY = "resume_analysis_cache";

// Cache key changes when the resume file changes, so a new upload re-analyzes.
function fileTag(path: string): string {
  try {
    return `${path}:${statSync(path).mtimeMs}`;
  } catch {
    return path;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const masterPath = getConfig("master_resume_path");
  if (!masterPath) {
    return NextResponse.json({ ok: false, reason: "no_master_resume" }, { status: 400 });
  }
  if (!getActiveModel()) {
    return NextResponse.json({ ok: false, reason: "no_provider" }, { status: 400 });
  }

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const tag = fileTag(masterPath);

  // Serve the cached analysis unless the file changed or a refresh was requested.
  if (!refresh) {
    const cachedRaw = getConfig(CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached.tag === tag && cached.payload?.ok) {
          return NextResponse.json({ ...cached.payload, cached: true });
        }
      } catch {
        // fall through and recompute
      }
    }
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
    const [audit, roles] = await Promise.all([
      auditResume(resumeText),
      suggestRoles(resumeText, facts),
    ]);
    const payload = {
      ok: true as const,
      name: candidateName(resumeText, facts) ?? null,
      resumeName: masterPath.split("/").pop() ?? null,
      audit,
      roles,
    };
    setConfig(CACHE_KEY, JSON.stringify({ tag, payload }));
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, reason: "rate_limited", retryAt: e.retryAt },
        { status: 429 }
      );
    }
    console.error("[resume/analyze] failed:", e);
    return NextResponse.json({ ok: false, reason: "analysis_failed" }, { status: 500 });
  }
}
