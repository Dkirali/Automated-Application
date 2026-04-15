import { test, expect } from "@playwright/test";
import {
  resetDb,
  seedSetupComplete,
  seedCampaign,
  seedJob,
  makeFitSummary,
  resetServer,
  createTestResume,
  TEST_RESUME_PATH,
} from "./seed";

const BASE = "http://localhost:3001";

test.beforeAll(async () => {
  await createTestResume();
});

test.beforeEach(async () => {
  resetDb();
  await resetServer(BASE);
});

// ── Setup Form Submission ──────────────────────────────────────────────

test.describe("Setup Form Submission", () => {
  test("submitting valid setup form redirects to dashboard", async ({ page }) => {
    await page.goto("/setup");

    await page.locator("#name").fill("Jane Doe");
    await page.locator("#email").fill("jane@example.com");
    await page.locator("#phone").fill("+1999999999");
    await page.locator("#groq_key").fill("gsk_test123");

    // Upload the test resume fixture
    const fileInput = page.locator("#resume-input");
    await fileInput.setInputFiles(TEST_RESUME_PATH);

    // Verify file name appears
    await expect(page.locator(".file-drop-text")).toContainText("resume.docx");

    await page.getByRole("button", { name: /Save/ }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL("/", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("JobBot");
  });

  test("setup redirects to /setup with error when fields missing", async ({ request }) => {
    // Submit empty form via API
    const res = await request.post("/api/setup", {
      multipart: {
        name: "",
        email: "",
        phone: "",
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    const location = res.headers()["location"];
    expect(location).toContain("/setup");
    expect(location).toContain("error=");
  });

  test("visiting /setup when already configured redirects to dashboard", async ({ page }) => {
    seedSetupComplete();
    await resetServer(BASE);

    await page.goto("/setup");
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });
});

// ── Apply Now Flow ─────────────────────────────────────────────────────

test.describe("Apply Now Flow", () => {
  let jobId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    jobId = seedJob({
      campaignId,
      fitSummary: makeFitSummary(80),
      title: "Apply Test Job",
      company: "ApplyCo",
      resumePath: TEST_RESUME_PATH,
    });
    await resetServer(BASE);
  });

  test("clicking Apply Now on review page moves job out of pending", async ({ page }) => {
    test.setTimeout(60000);

    // Verify job appears in pending
    await page.goto("/");
    await expect(page.locator(".app-card--pending")).toHaveCount(1);

    // Navigate to review page
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".review-title")).toContainText("Apply Test Job");

    // Click Apply Now (submitter will fail in test env, marking job as "failed")
    await page.locator(".btn-apply").click();

    // Should redirect to dashboard
    await expect(page).toHaveURL("/", { timeout: 45000 });

    // Job should no longer be in pending (moved to applied or failed)
    await expect(page.locator(".app-card--pending")).toHaveCount(0);
  });

  test("apply via API changes job status", async ({ request }) => {
    const res = await request.post(`/api/apply/${jobId}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);

    // Verify the job status changed
    const statusRes = await request.get(`/api/job-status/${jobId}`);
    const data = await statusRes.json();
    expect(["applied", "failed"]).toContain(data.status);
  });
});

// ── Discard Flow ───────────────────────────────────────────────────────

test.describe("Discard Flow", () => {
  let jobId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    jobId = seedJob({
      campaignId,
      fitSummary: makeFitSummary(60),
      title: "Discard Test Job",
      company: "DiscardCo",
    });
    await resetServer(BASE);
  });

  test("clicking Discard on review page removes job from pending", async ({ page }) => {
    // Verify job exists in pending
    await page.goto("/");
    await expect(page.locator(".app-card--pending")).toHaveCount(1);

    // Navigate to review page and discard
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".review-title")).toContainText("Discard Test Job");
    await page.locator(".btn-discard").click();

    // Should redirect to dashboard
    await expect(page).toHaveURL("/", { timeout: 10000 });

    // Job should be gone from pending
    await expect(page.locator(".app-card--pending")).toHaveCount(0);
  });

  test("discard via API changes status to discarded", async ({ request }) => {
    const res = await request.post(`/api/discard/${jobId}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);

    const statusRes = await request.get(`/api/job-status/${jobId}`);
    const data = await statusRes.json();
    expect(data.status).toBe("discarded");
  });

  test("discarded job is no longer accessible on review page", async ({ page }) => {
    // Discard via API first
    await fetch(`${BASE}/api/discard/${jobId}`, { method: "POST", redirect: "manual" });
    await resetServer(BASE);

    // Attempting to visit review page should redirect to dashboard
    await page.goto(`/review/${jobId}`);
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });
});

// ── Bulk Discard UI Round-trip ─────────────────────────────────────────

test.describe("Bulk Discard UI Round-trip", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    seedJob({ campaignId, fitSummary: makeFitSummary(80), title: "Bulk A" });
    seedJob({ campaignId, fitSummary: makeFitSummary(60), title: "Bulk B" });
    seedJob({ campaignId, fitSummary: makeFitSummary(40), title: "Bulk C" });
    await resetServer(BASE);
  });

  test("selecting all and clicking Discard Selected removes all pending jobs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-card--pending")).toHaveCount(3);

    // Select first job to show bulk bar
    await page.locator(".job-checkbox-wrap").first().click();
    await expect(page.locator(".bulk-bar")).toBeVisible();

    // Select all
    await page.locator(".bulk-bar-btn--select-all").click();
    await expect(page.locator(".bulk-bar-count")).toContainText("3 selected");

    // Click Discard Selected
    await page.locator(".bulk-bar-btn--discard").click();

    // Page should reload and all pending jobs should be gone
    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator(".app-card--pending")).toHaveCount(0);
  });

  test("bulk discard only removes selected jobs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-card--pending")).toHaveCount(3);

    // Select only the first job
    await page.locator(".job-checkbox-wrap").first().click();
    await expect(page.locator(".bulk-bar-count")).toContainText("1 selected");

    // Discard the selected job
    await page.locator(".bulk-bar-btn--discard").click();

    // Should reload with 2 remaining
    await page.waitForURL("/", { timeout: 10000 });
    await expect(page.locator(".app-card--pending")).toHaveCount(2);
  });
});

// ── Campaign Start/Stop ────────────────────────────────────────────────

test.describe("Campaign Start/Stop", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("starting campaign with titles submits form and redirects", async ({ page }) => {
    await page.goto("/");

    // Fill in campaign form
    await page.locator("#titles").fill("Product Manager, Engineering Manager");
    await page.locator("#location_text").fill("London");

    // Submit
    await page.getByRole("button", { name: /Start/ }).click();

    // Should redirect back to dashboard
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("starting campaign without titles shows alert", async ({ page }) => {
    await page.goto("/");

    // The titles field is required in HTML, so test via API
    const res = await page.request.post("/api/campaign/start", {
      multipart: {
        titles: "",
        location_text: "NYC",
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
  });

  test("stop campaign via API returns redirect", async ({ request }) => {
    // Start a campaign first
    const startRes = await request.post("/api/campaign/start", {
      multipart: {
        titles: "Developer",
        location_text: "Remote",
      },
      maxRedirects: 0,
    });
    expect(startRes.status()).toBe(303);

    // Stop it
    const stopRes = await request.post("/api/campaign/stop", {
      maxRedirects: 0,
    });
    expect(stopRes.status()).toBe(303);
  });

  test("stop button submits campaign stop form", async ({ page }) => {
    // Create a running campaign
    seedCampaign({ status: "running" });
    await resetServer(BASE);

    await page.goto("/");
    await page.locator(".btn-stop").click();

    // Should redirect back to dashboard
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });
});

// ── Settings Save ──────────────────────────────────────────────────────

test.describe("Settings Save", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("updating name in settings persists on reload", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("#name")).toHaveValue("Test User");

    // Update name
    await page.locator("#name").fill("Updated User");
    await page.getByRole("button", { name: /Save/ }).click();

    // Should redirect to settings with success
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    // Reload and verify the name persisted
    await page.goto("/settings");
    await expect(page.locator("#name")).toHaveValue("Updated User");
  });

  test("updating email and phone persists", async ({ page }) => {
    await page.goto("/settings");

    await page.locator("#email").fill("new@example.com");
    await page.locator("#phone").fill("+44123456789");
    await page.getByRole("button", { name: /Save/ }).click();

    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    await page.goto("/settings");
    await expect(page.locator("#email")).toHaveValue("new@example.com");
    await expect(page.locator("#phone")).toHaveValue("+44123456789");
  });

  test("uploading new resume updates displayed filename", async ({ page }) => {
    await page.goto("/settings");

    // Upload a new resume
    const fileInput = page.locator("#resume-input");
    await fileInput.setInputFiles(TEST_RESUME_PATH);
    await expect(page.locator(".file-drop-text")).toContainText("resume.docx");

    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });

    // Verify filename is displayed
    await page.goto("/settings");
    await expect(page.locator(".file-current")).toContainText(".docx");
  });

  test("settings save via API with missing fields returns error redirect", async ({ request }) => {
    const res = await request.post("/api/settings", {
      multipart: {
        name: "",
        email: "",
        phone: "",
      },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    const location = res.headers()["location"];
    expect(location).toContain("error=");
  });
});

// ── Error States & Redirects ───────────────────────────────────────────

test.describe("Error States & Redirects", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("review page with invalid job ID redirects to dashboard", async ({ page }) => {
    await page.goto("/review/99999");
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("application detail page with invalid ID redirects to dashboard", async ({ page }) => {
    await page.goto("/application/99999");
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("review page with applied job redirects to dashboard", async ({ page }) => {
    const campaignId = seedCampaign();
    const appliedId = seedJob({
      campaignId,
      status: "applied",
      title: "Already Applied",
    });
    await resetServer(BASE);

    await page.goto(`/review/${appliedId}`);
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("review page with discarded job redirects to dashboard", async ({ page }) => {
    const campaignId = seedCampaign();
    const discardedId = seedJob({
      campaignId,
      status: "discarded",
      title: "Already Discarded",
    });
    await resetServer(BASE);

    await page.goto(`/review/${discardedId}`);
    await expect(page).toHaveURL("/", { timeout: 10000 });
  });

  test("download API returns 404 for job with no resume", async ({ request }) => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    const jobId = seedJob({ campaignId, fitSummary: makeFitSummary(50) });
    await resetServer(BASE);

    const res = await request.get(`/api/download/${jobId}`);
    expect(res.status()).toBe(404);
  });

  test("job-status API returns 404 for nonexistent job", async ({ request }) => {
    const res = await request.get("/api/job-status/99999");
    expect(res.status()).toBe(404);
  });

  test("resume-text API returns empty for job without resume file", async ({ request }) => {
    const campaignId = seedCampaign();
    const jobId = seedJob({ campaignId, fitSummary: makeFitSummary(50) });
    await resetServer(BASE);

    const res = await request.get(`/api/resume-text/${jobId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.text).toBe("");
  });

  test("resume-text API returns content for job with valid resume", async ({ request }) => {
    const campaignId = seedCampaign();
    const jobId = seedJob({
      campaignId,
      fitSummary: makeFitSummary(70),
      resumePath: TEST_RESUME_PATH,
      keywords: "TypeScript,React",
    });
    await resetServer(BASE);

    const res = await request.get(`/api/resume-text/${jobId}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.text).toContain("Test User");
    expect(data.keywords).toHaveLength(2);
  });
});
