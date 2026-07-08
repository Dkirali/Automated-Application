import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { getConfig } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const path = getConfig("resume_improved_path");
  if (!path || !existsSync(path)) {
    return NextResponse.json({ ok: false, reason: "not_generated" }, { status: 404 });
  }
  const buf = readFileSync(path);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="improved-master.docx"',
    },
  });
}
