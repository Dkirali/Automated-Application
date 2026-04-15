import { NextRequest, NextResponse } from "next/server";
import { getApplication } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getApplication(Number(id));
  if (!job) {
    return NextResponse.json({ status: "unknown" }, { status: 404 });
  }
  return NextResponse.json({ status: job.status });
}
