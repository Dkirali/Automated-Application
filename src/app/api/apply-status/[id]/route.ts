import { NextRequest, NextResponse } from "next/server";
import { getStatus } from "@/lib/apply-status";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const status = getStatus(Number(id));
  if (!status) {
    return NextResponse.json({ state: "idle" });
  }
  return NextResponse.json(status);
}
