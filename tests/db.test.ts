import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initDb,
  getConn,
  closeConn,
  setConfig,
  getConfig,
  isSetupComplete,
  createCampaign,
  updateCampaignStatus,
  getActiveCampaign,
  getAllCampaigns,
  insertApplication,
  updateApplication,
  getApplication,
  getPendingJobs,
  getAllApplications,
  markApplied,
  insertManual,
  getManualQueue,
  getSeenUrls,
  incrementApiUsage,
  getApiUsageToday,
} from "@/lib/db";

beforeEach(() => {
  closeConn();
  process.env.JOBBOT_DB = ":memory:";
  initDb();
});

afterEach(() => {
  closeConn();
  delete process.env.JOBBOT_DB;
});

describe("config", () => {
  it("set and get config", () => {
    setConfig("name", "Doruk");
    expect(getConfig("name")).toBe("Doruk");
  });

  it("returns null for missing config", () => {
    expect(getConfig("nonexistent")).toBeNull();
  });

  it("upserts config", () => {
    setConfig("name", "A");
    setConfig("name", "B");
    expect(getConfig("name")).toBe("B");
  });

  it("isSetupComplete returns false when incomplete", () => {
    expect(isSetupComplete()).toBe(false);
  });

  it("isSetupComplete returns true when all fields set", () => {
    setConfig("name", "Doruk");
    setConfig("email", "test@test.com");
    setConfig("phone", "123");
    setConfig("master_resume_path", "/path/to/resume.docx");
    expect(isSetupComplete()).toBe(true);
  });
});

describe("campaigns", () => {
  it("creates a campaign and retrieves it as active", () => {
    const id = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
    expect(id).toBeGreaterThan(0);
    const active = getActiveCampaign();
    expect(active).not.toBeNull();
    expect(active!.name).toBe("Test");
    expect(active!.status).toBe("running");
  });

  it("creates campaign with preferred_model", () => {
    const id = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC", preferredModel: "groq/llama-3.3-70b" });
    const active = getActiveCampaign();
    expect(active!.preferred_model).toBe("groq/llama-3.3-70b");
  });

  it("updates campaign status", () => {
    const id = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
    updateCampaignStatus(id, "stopped", "user_stopped");
    const active = getActiveCampaign();
    expect(active).toBeNull();
  });

  it("getAllCampaigns returns campaigns with counts", () => {
    const id = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
    insertApplication({ campaignId: id, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD text" });
    const campaigns = getAllCampaigns();
    expect(campaigns.length).toBe(1);
    expect(campaigns[0].total_count).toBe(1);
    expect(campaigns[0].pending_count).toBe(1);
  });
});

describe("applications", () => {
  let campaignId: number;

  beforeEach(() => {
    campaignId = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
  });

  it("inserts an application", () => {
    const id = insertApplication({ campaignId, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD" });
    expect(id).toBeGreaterThan(0);
  });

  it("rejects duplicate URLs", () => {
    insertApplication({ campaignId, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD" });
    const id = insertApplication({ campaignId, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD" });
    expect(id).toBeNull();
  });

  it("getApplication retrieves by id", () => {
    const id = insertApplication({ campaignId, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD" })!;
    const app = getApplication(id);
    expect(app).not.toBeNull();
    expect(app!.company).toBe("ACME");
    expect(app!.title).toBe("Dev");
  });

  it("updateApplication updates fields", () => {
    const id = insertApplication({ campaignId, company: "ACME", title: "Dev", location: "NYC", url: "https://example.com/1", jobDescription: "JD" })!;
    updateApplication(id, "reviewed", {
      atsScore: 85,
      resumePath: "/path/to/resume.docx",
      fitSummary: "Good fit",
      modelUsed: "groq",
    });
    const app = getApplication(id);
    expect(app!.status).toBe("reviewed");
    expect(app!.ats_score).toBe(85);
    expect(app!.resume_path).toBe("/path/to/resume.docx");
    expect(app!.fit_summary).toBe("Good fit");
    expect(app!.model_used).toBe("groq");
  });

  it("getPendingJobs returns pending and reviewed", () => {
    const id1 = insertApplication({ campaignId, company: "A", title: "Dev", location: "NYC", url: "https://a.com", jobDescription: "JD" })!;
    const id2 = insertApplication({ campaignId, company: "B", title: "Dev", location: "NYC", url: "https://b.com", jobDescription: "JD" })!;
    updateApplication(id2, "reviewed");
    const pending = getPendingJobs();
    expect(pending.length).toBe(2);
  });

  it("getAllApplications returns applied/failed/discarded", () => {
    const id = insertApplication({ campaignId, company: "A", title: "Dev", location: "NYC", url: "https://a.com", jobDescription: "JD" })!;
    updateApplication(id, "applied");
    const all = getAllApplications();
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("applied");
  });

  it("markApplied sets status and timestamp", () => {
    const id = insertApplication({ campaignId, company: "A", title: "Dev", location: "NYC", url: "https://a.com", jobDescription: "JD" })!;
    markApplied(id);
    const app = getApplication(id);
    expect(app!.status).toBe("applied");
    expect(app!.applied_at).toBeTruthy();
  });
});

describe("manual queue", () => {
  it("inserts and retrieves manual queue entries", () => {
    const campaignId = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
    insertManual(campaignId, "ACME", "Dev", "NYC", "https://manual.com", "not_easy_apply");
    const queue = getManualQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].reason).toBe("not_easy_apply");
  });
});

describe("seen URLs", () => {
  it("returns URLs from both applications and manual queue", () => {
    const campaignId = createCampaign({ name: "Test", titles: "Engineer", locations: "NYC" });
    insertApplication({ campaignId, company: "A", title: "Dev", location: "NYC", url: "https://app.com", jobDescription: "JD" });
    insertManual(campaignId, "B", "Dev", "NYC", "https://manual.com", "reason");
    const seen = getSeenUrls();
    expect(seen.has("https://app.com")).toBe(true);
    expect(seen.has("https://manual.com")).toBe(true);
    expect(seen.size).toBe(2);
  });
});

describe("API usage tracking", () => {
  it("increments usage counter", () => {
    incrementApiUsage("groq/llama-3.3-70b");
    incrementApiUsage("groq/llama-3.3-70b");
    const usage = getApiUsageToday();
    expect(usage["groq/llama-3.3-70b"]).toBe(2);
  });

  it("returns empty object when no usage", () => {
    const usage = getApiUsageToday();
    expect(Object.keys(usage).length).toBe(0);
  });

  it("tracks multiple models separately", () => {
    incrementApiUsage("groq/llama-3.3-70b");
    incrementApiUsage("anthropic/claude-sonnet");
    incrementApiUsage("anthropic/claude-sonnet");
    const usage = getApiUsageToday();
    expect(usage["groq/llama-3.3-70b"]).toBe(1);
    expect(usage["anthropic/claude-sonnet"]).toBe(2);
  });
});
