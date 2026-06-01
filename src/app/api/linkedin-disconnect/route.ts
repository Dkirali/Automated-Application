import { NextResponse } from "next/server";
import { disconnectLinkedin } from "@/lib/linkedin";

export async function POST(): Promise<NextResponse> {
  disconnectLinkedin();
  return NextResponse.json({ ok: true });
}
