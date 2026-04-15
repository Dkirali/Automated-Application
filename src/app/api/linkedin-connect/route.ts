import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { getProfilePath } from "@/lib/scraper";
import { mkdirSync } from "fs";

export async function POST() {
  const profilePath = getProfilePath();
  mkdirSync(profilePath, { recursive: true });

  // Launch in background — don't await
  (async () => {
    const context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      channel: "chrome",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });
    try {
      await page.waitForEvent("close", { timeout: 600_000 });
    } catch {
      // timeout or closed
    }
    await context.close();
  })();

  return NextResponse.json({ ok: true });
}
