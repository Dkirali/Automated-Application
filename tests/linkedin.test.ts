import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import Database from "better-sqlite3";
import { isLinkedinConnected } from "@/lib/linkedin";

// Chrome stores cookie expiry as microseconds since 1601-01-01 (0 = session).
const CHROME_EPOCH_OFFSET_S = 11644473600;
function chromeFuture(): number {
  return (Date.now() / 1000 + CHROME_EPOCH_OFFSET_S + 86400) * 1e6;
}
function chromePast(): number {
  return (Date.now() / 1000 + CHROME_EPOCH_OFFSET_S - 86400) * 1e6;
}

let dir: string;

function writeCookies(rows: Array<{ name: string; expires_utc: number }>): void {
  const def = join(dir, "Default");
  mkdirSync(def, { recursive: true });
  const db = new Database(join(def, "Cookies"));
  db.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER)");
  const ins = db.prepare(
    "INSERT INTO cookies (host_key, name, expires_utc) VALUES (?,?,?)"
  );
  for (const r of rows) ins.run(".linkedin.com", r.name, r.expires_utc);
  db.close();
}

beforeEach(() => {
  dir = join(tmpdir(), "jobbot-li-test-" + Math.random().toString(36).slice(2));
  process.env.JOBBOT_PROFILE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.JOBBOT_PROFILE_DIR;
});

describe("isLinkedinConnected", () => {
  it("is false when the profile has no Cookies file at all", () => {
    expect(isLinkedinConnected()).toBe(false);
  });

  it("is false when Cookies exist but there is no li_at (anonymous guest)", () => {
    // Exactly the failing case: LinkedIn's anonymous cookies, no auth cookie.
    writeCookies([
      { name: "bcookie", expires_utc: chromeFuture() },
      { name: "JSESSIONID", expires_utc: 0 },
      { name: "lidc", expires_utc: chromeFuture() },
    ]);
    expect(isLinkedinConnected()).toBe(false);
  });

  it("is true when a non-expired li_at auth cookie is present", () => {
    writeCookies([{ name: "li_at", expires_utc: chromeFuture() }]);
    expect(isLinkedinConnected()).toBe(true);
  });

  it("is true when li_at is a session cookie (expires_utc = 0)", () => {
    writeCookies([{ name: "li_at", expires_utc: 0 }]);
    expect(isLinkedinConnected()).toBe(true);
  });

  it("is false when li_at is present but expired", () => {
    writeCookies([{ name: "li_at", expires_utc: chromePast() }]);
    expect(isLinkedinConnected()).toBe(false);
  });
});
