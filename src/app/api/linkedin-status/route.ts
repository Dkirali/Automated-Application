import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { getProfilePath } from "@/lib/scraper";

export async function GET() {
  const cookiesPath = join(getProfilePath(), "Default", "Cookies");
  return NextResponse.json({ connected: existsSync(cookiesPath) });
}
