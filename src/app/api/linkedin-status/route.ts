import { NextResponse } from "next/server";
import { isLinkedinConnected } from "@/lib/linkedin";

export async function GET() {
  return NextResponse.json({ connected: isLinkedinConnected() });
}
