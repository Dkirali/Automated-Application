import { NextRequest, NextResponse } from "next/server";
import { getApplication, getConfig, markApplied, updateApplication } from "@/lib/db";
import { submitApplication } from "@/lib/submitter";
import { isInFlight, setStatus } from "@/lib/apply-status";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  const job = getApplication(appId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (isInFlight(appId)) {
    return NextResponse.json({ ok: false, error: "already_running" }, { status: 409 });
  }

  const masterPath = getConfig("master_resume_path");
  const pdfPath = job.resume_path || masterPath || "";

  setStatus(appId, "starting", "Launching browser…");

  // Fire-and-forget — caller polls /api/apply-status/[id]
  (async () => {
    try {
      const result = await submitApplication(
        job.url,
        pdfPath,
        getConfig("name") || "",
        getConfig("email") || "",
        getConfig("phone") || "",
        (state, message) => setStatus(appId, state, message)
      );

      if (result.outcome === "applied") {
        markApplied(appId);
        setStatus(appId, "applied", "Application sent.");
      } else {
        updateApplication(appId, "failed");
        setStatus(
          appId,
          "failed",
          result.reason ? `Submission failed: ${result.reason}` : "Submission failed.",
          result.reason
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      updateApplication(appId, "failed");
      setStatus(appId, "failed", `Error: ${msg}`, msg);
    }
  })();

  return NextResponse.json({ ok: true, started: true, id: appId });
}
