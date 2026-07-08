import { NextRequest, NextResponse } from "next/server";
import { setApplicationNotes } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { id, notes } = (await request.json().catch(() => ({}))) as {
    id?: number;
    notes?: string;
  };
  if (!id) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  setApplicationNotes(Number(id), notes ?? "");
  return NextResponse.json({ ok: true });
}
