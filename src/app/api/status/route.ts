import { NextResponse } from "next/server";
import { getPendingJobs } from "@/lib/db";
import { getStatus } from "@/lib/campaign";

export async function GET() {
  const pending = getPendingJobs();
  return NextResponse.json({
    status: getStatus(),
    pending_count: pending.length,
  });
}
