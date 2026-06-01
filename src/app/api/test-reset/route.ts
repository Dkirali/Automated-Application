import { NextResponse } from "next/server";
import { closeConn } from "@/lib/db";

export async function POST(): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  closeConn();
  if (process.env.JOBBOT_TEST_MODE === "1") {
    console.log(`[db] test-reset: closed connection`);
  }
  return NextResponse.json({ ok: true });
}
