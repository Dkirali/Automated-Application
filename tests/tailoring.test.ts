import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  closeConn,
  initDb,
  setConfig,
  getApplication,
  getPendingJobs,
  getConn,
} from "@/lib/db";

// Avoid hitting a real LLM — tailoring success is stubbed.
vi.mock("@/lib/resume", () => ({
  tailorResume: vi.fn(async () => ({
    atsScore: 88,
    originalAtsScore: 60,
    keywordsStr: "react,node",
    docxPath: "/tmp/r.docx",
    modelUsed: "groq/llama-3.3-70b",
  })),
}));

let urlSeq = 0;
function seedJob(): number {
  urlSeq += 1;
  const r = getConn()
    .prepare(
      "INSERT INTO applications (campaign_id,company,title,location,url,job_description,status,created_at) VALUES (1,'C','T','L',?, 'JD text','pending','2026-06-02')"
    )
    .run(`https://example.com/job/${urlSeq}`);
  return Number(r.lastInsertRowid);
}

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
  setConfig("master_resume_path", "/tmp/master.txt");
});

describe("startTailoring", () => {
  it("moves a job to 'tailoring' synchronously, then 'reviewed' on success", async () => {
    const { startTailoring } = await import("@/lib/tailor");
    const id = seedJob();
    startTailoring(id);
    // Synchronous transition before the background tailor resolves.
    expect(getApplication(id)!.status).toBe("tailoring");
    await vi.waitFor(() => expect(getApplication(id)!.status).toBe("reviewed"));
    expect(getApplication(id)!.resume_path).toBe("/tmp/r.docx");
  });

  it("marks the job 'failed' when no master resume is configured", async () => {
    setConfig("master_resume_path", "");
    const { startTailoring } = await import("@/lib/tailor");
    const id = seedJob();
    startTailoring(id);
    await vi.waitFor(() => expect(getApplication(id)!.status).toBe("failed"));
  });
});

describe("getPendingJobs", () => {
  it("includes jobs that are currently tailoring", async () => {
    const { startTailoring } = await import("@/lib/tailor");
    const id = seedJob();
    startTailoring(id);
    expect(getPendingJobs().some((j) => j.id === id)).toBe(true);
  });
});

describe("/api/bulk-retailor", () => {
  it("kicks off tailoring for every selected job", async () => {
    const a = seedJob();
    const b = seedJob();
    const { POST } = await import("@/app/api/bulk-retailor/route");
    const fd = new FormData();
    fd.append("job_ids", String(a));
    fd.append("job_ids", String(b));
    const res = await POST(
      new NextRequest("http://localhost/api/bulk-retailor", { method: "POST", body: fd })
    );
    const body = await res.json();
    expect(body.started).toBe(2);
    // Both jobs left the 'pending' state.
    expect(getApplication(a)!.status).not.toBe("pending");
    expect(getApplication(b)!.status).not.toBe("pending");
  });
});
