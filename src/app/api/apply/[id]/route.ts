import { NextRequest, NextResponse } from "next/server";
import { getApplication, getConfig, markApplied, updateApplication } from "@/lib/db";
import { submitApplication } from "@/lib/submitter";

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

  const masterPath = getConfig("master_resume_path");
  const pdfPath = job.resume_path || masterPath || "";

  try {
    const submitted = await submitApplication(
      job.url,
      pdfPath,
      getConfig("name") || "",
      getConfig("email") || "",
      getConfig("phone") || ""
    );
    if (submitted) {
      markApplied(appId);
    } else {
      updateApplication(appId, "failed");
    }
  } catch {
    updateApplication(appId, "failed");
  }

  return NextResponse.redirect(new URL("/", request.url), 303);
}
