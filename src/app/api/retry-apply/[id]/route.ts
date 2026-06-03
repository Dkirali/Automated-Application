import { NextRequest, NextResponse } from "next/server";
import { updateApplication } from "@/lib/db";
import { clearStatus } from "@/lib/apply-status";

// Retry a FAILED application: send it back into the review/apply flow rather
// than duplicating submit logic. Resetting to "reviewed" re-lists it under
// Pending Review (getPendingJobs returns status IN ('pending','reviewed')), and
// clearing the in-memory apply state re-enables the Apply button.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  updateApplication(appId, "reviewed");
  clearStatus(appId);
  return NextResponse.redirect(new URL("/", request.url), 303);
}
