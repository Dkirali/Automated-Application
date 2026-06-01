import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { getProfilePath } from "@/lib/scraper";
import { isLinkedinConnected } from "@/lib/linkedin";
import { mkdirSync } from "fs";

// Opens a real Chrome window for the user to log in, waits until they close it,
// then VERIFIES that a real LinkedIn session (`li_at`) was actually captured.
// Returns the verified result so the UI never reports "connected" for a window
// that was opened but never logged into. Blocks until the window closes (or a
// 10-minute safety timeout) — the client shows a "waiting" state meanwhile.
export async function POST() {
  const profilePath = getProfilePath();
  mkdirSync(profilePath, { recursive: true });

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
    });
    try {
      // The user logs in, then closes the window to signal they're done.
      await page.waitForEvent("close", { timeout: 600_000 });
    } catch {
      // Timeout — the user left the window open; verify whatever state exists.
    }
  } finally {
    await context.close();
  }

  // Authoritative: only "connected" if a valid li_at cookie landed on disk.
  return NextResponse.json({ connected: isLinkedinConnected() });
}
