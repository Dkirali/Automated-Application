import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { getApplication } from "@/lib/db";
import { readResumeTextAsync } from "@/lib/resume";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const app = getApplication(Number(id));
  if (!app || !app.resume_path || !existsSync(app.resume_path)) {
    return NextResponse.json({ text: "", keywords: [] });
  }

  const text = await readResumeTextAsync(app.resume_path);
  const kwRaw = app.keywords || "";
  const keywords = kwRaw
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);
  return NextResponse.json({ text, keywords });
}
