import { NextRequest, NextResponse } from "next/server";
import { TRACKER_STAGES, updateStage, type TrackerStage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { id, stage } = (await request.json().catch(() => ({}))) as {
    id?: number;
    stage?: string;
  };
  if (!id || !stage || !TRACKER_STAGES.includes(stage as TrackerStage)) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  updateStage(Number(id), stage as TrackerStage);
  return NextResponse.json({ ok: true });
}
