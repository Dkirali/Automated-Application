import { NextRequest, NextResponse } from "next/server";
import { startTailoring } from "@/lib/tailor";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  if (!startTailoring(appId)) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }
  return NextResponse.json({ ok: true, id: appId });
}
