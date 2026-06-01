import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getProfilePath } from "./scraper";

// LinkedIn sets the `li_at` cookie ONLY after a real login. The Chromium
// profile's Cookies file, by contrast, appears the moment the browser touches
// any linkedin.com page — including the anonymous "Join now" authwall — so
// checking for the file's existence reports "connected" for a profile that was
// never logged in (or whose session has since expired). We must look for a
// live `li_at` auth cookie instead.
export function isLinkedinConnected(): boolean {
  const cookiesPath = join(getProfilePath(), "Default", "Cookies");
  if (!existsSync(cookiesPath)) return false;
  try {
    const Database = require("better-sqlite3");
    const db = new Database(cookiesPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare("SELECT expires_utc FROM cookies WHERE name = 'li_at' LIMIT 1")
        .get() as { expires_utc: number } | undefined;
      if (!row) return false;
      // expires_utc: microseconds since 1601-01-01 (Chrome epoch); 0 = session.
      if (row.expires_utc === 0) return true;
      const nowChrome = (Date.now() / 1000 + 11644473600) * 1e6;
      return row.expires_utc > nowChrome;
    } finally {
      db.close();
    }
  } catch {
    // Cookies DB locked (a scrape/connect browser is open) or unreadable —
    // fall back to file existence rather than spuriously flipping a live
    // session to "disconnected" mid-campaign.
    return existsSync(cookiesPath);
  }
}

export function disconnectLinkedin(): void {
  rmSync(getProfilePath(), { recursive: true, force: true });
}
