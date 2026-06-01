import { describe, it, expect, beforeEach } from "vitest";
import { closeConn, initDb, getConfig } from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  process.env.JOBBOT_ENV_PATH = "/tmp/jobbot-test.env";
  initDb();
});

describe("/api/settings daily_token_limit", () => {
  it("persists a positive daily_token_limit", async () => {
    const form = new FormData();
    form.set("name", "Jane");
    form.set("email", "jane@example.com");
    form.set("phone", "+1 555 000 0000");
    form.set("daily_token_limit", "250000");
    const { POST } = await import("@/app/api/settings/route");
    await POST(new Request("http://localhost/api/settings", { method: "POST", body: form }) as never);
    expect(getConfig("daily_token_limit")).toBe("250000");
  });

  it("ignores a non-positive value", async () => {
    const form = new FormData();
    form.set("name", "Jane");
    form.set("email", "jane@example.com");
    form.set("phone", "+1 555 000 0000");
    form.set("daily_token_limit", "-5");
    const { POST } = await import("@/app/api/settings/route");
    await POST(new Request("http://localhost/api/settings", { method: "POST", body: form }) as never);
    expect(getConfig("daily_token_limit")).toBeNull();
  });
});
