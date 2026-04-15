import { test, expect } from "@playwright/test";
import {
  resetDb,
  seedSetupComplete,
  seedCampaign,
  seedJob,
  seedManualJob,
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

// ── Setup Flow ──────────────────────────────────────────────────────────

test.describe("Setup Flow", () => {
  test("redirects to /setup when not configured", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup/);
  });

  test("setup page renders form fields", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#phone")).toBeVisible();
    await expect(page.locator("#resume-input")).toBeAttached();
    await expect(page.getByRole("button", { name: /Save/i })).toBeVisible();
  });

  test("shows step dots", async ({ page }) => {
    await page.goto("/setup");
    const dots = page.locator(".step-dot");
    await expect(dots).toHaveCount(5);
    await expect(dots.first()).toHaveClass(/active/);
  });
});

// ── Dashboard Layout ────────────────────────────────────────────────────

test.describe("Dashboard Layout", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("renders topbar with brand and settings link", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("JobBot");
    await expect(page.getByText(/Settings/)).toBeVisible();
  });

  test("shows LinkedIn pill", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".li-pill")).toContainText(/LinkedIn/);
  });

  test("shows stats row with applied, manual, status", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".stat-label").filter({ hasText: "Applied" })).toBeVisible();
    await expect(page.locator(".stat-label").filter({ hasText: "Manual Queue" })).toBeVisible();
    await expect(page.locator(".stat-label").filter({ hasText: "Campaign Status" })).toBeVisible();
  });

  test("shows campaign form with title and location inputs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#titles")).toBeVisible();
    await expect(page.locator("#location_text")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start/ })).toBeVisible();
  });

  test("shows empty state when no applications", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".empty-state")).toContainText("No applications yet");
  });

  test("shows work type chips with defaults", async ({ page }) => {
    await page.goto("/");
    const remote = page.locator("#wt2");
    const hybrid = page.locator("#wt3");
    await expect(remote).toBeChecked();
    await expect(hybrid).toBeChecked();
  });

  test("shows model selector with auto as default", async ({ page }) => {
    await page.goto("/");
    const auto = page.locator("input[name='preferred_model'][value='auto']");
    await expect(auto).toBeChecked();
  });
});

// ── Pending Jobs & Fit Badges ───────────────────────────────────────────

test.describe("Pending Jobs", () => {
  let campaignId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    campaignId = seedCampaign();
    await resetServer(BASE);
  });

  test("shows pending section with job cards", async ({ page }) => {
    seedJob({ campaignId, fitSummary: makeFitSummary(85), title: "React Dev" });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".section-title--pending")).toContainText("Pending Review");
    await expect(page.locator(".app-card--pending")).toHaveCount(1);
    await expect(page.locator(".app-card-title")).toContainText("React Dev");
  });

  test("shows fit badge with correct class for high score", async ({ page }) => {
    seedJob({ campaignId, fitSummary: makeFitSummary(85) });
    await resetServer(BASE);

    await page.goto("/");
    const badge = page.locator(".fit-badge");
    await expect(badge).toContainText("85% fit");
    await expect(badge).toHaveClass(/fit-badge--high/);
  });

  test("shows fit badge with medium class", async ({ page }) => {
    seedJob({ campaignId, fitSummary: makeFitSummary(55) });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".fit-badge")).toHaveClass(/fit-badge--medium/);
  });

  test("shows fit badge with low class", async ({ page }) => {
    seedJob({ campaignId, fitSummary: makeFitSummary(25) });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".fit-badge")).toHaveClass(/fit-badge--low/);
  });

  test("shows analyzing message when no fit summary", async ({ page }) => {
    seedJob({ campaignId });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".app-card-verdict")).toContainText("Analyzing fit");
  });

  test("shows ATS before/after bars when tailored", async ({ page }) => {
    seedJob({
      campaignId,
      fitSummary: makeFitSummary(70),
      atsScore: 82,
      originalAtsScore: 55,
      resumePath: TEST_RESUME_PATH,
      modelUsed: "groq/llama-3.3-70b",
    });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".ats-dual-label").filter({ hasText: "Before" })).toBeVisible();
    await expect(page.locator(".ats-dual-label").filter({ hasText: "After" })).toBeVisible();
  });

  test("shows tailored model badge", async ({ page }) => {
    seedJob({
      campaignId,
      fitSummary: makeFitSummary(70),
      resumePath: TEST_RESUME_PATH,
      modelUsed: "groq/llama-3.3-70b",
    });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".tailored-model-badge")).toContainText("groq/llama-3.3-70b");
  });

  test("shows untailored badge when no resume", async ({ page }) => {
    seedJob({ campaignId, fitSummary: makeFitSummary(70) });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".untailored-badge")).toContainText("Not tailored");
  });
});

// ── Sorting & Filtering ────────────────────────────────────────────────

test.describe("Sorting & Filtering", () => {
  let campaignId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    campaignId = seedCampaign();

    seedJob({ campaignId, fitSummary: makeFitSummary(90), title: "High Fit", resumePath: TEST_RESUME_PATH });
    seedJob({ campaignId, fitSummary: makeFitSummary(30), title: "Low Fit" });
    seedJob({ campaignId, fitSummary: makeFitSummary(60), title: "Mid Fit" });
    await resetServer(BASE);
  });

  test("sort buttons are visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sort-btn").filter({ hasText: "Fit ↓" })).toBeVisible();
    await expect(page.locator(".sort-btn").filter({ hasText: "Fit ↑" })).toBeVisible();
    await expect(page.locator(".sort-btn").filter({ hasText: "Newest" })).toBeVisible();
  });

  test("Fit ↓ is default active sort", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sort-btn.active")).toContainText("Fit ↓");
  });

  test("sort Fit ↑ reverses order", async ({ page }) => {
    await page.goto("/");
    await page.locator(".sort-btn").filter({ hasText: "Fit ↑" }).click();
    const titles = await page.locator(".app-card-title").allTextContents();
    expect(titles[0]).toBe("Low Fit");
  });

  test("filter buttons are visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".filter-btn").filter({ hasText: "All" })).toBeVisible();
    await expect(page.locator(".filter-btn").filter({ hasText: /^Tailored$/ })).toBeVisible();
    await expect(page.locator(".filter-btn").filter({ hasText: "Not Tailored" })).toBeVisible();
  });

  test("filter Tailored shows only tailored jobs", async ({ page }) => {
    await page.goto("/");
    await page.locator(".filter-btn").filter({ hasText: /^Tailored$/ }).click();
    const cards = page.locator(".app-card--pending");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator(".app-card-title")).toContainText("High Fit");
  });

  test("filter Not Tailored shows untailored jobs", async ({ page }) => {
    await page.goto("/");
    await page.locator(".filter-btn").filter({ hasText: "Not Tailored" }).click();
    const cards = page.locator(".app-card--pending");
    await expect(cards).toHaveCount(2);
  });
});

// ── Pagination ──────────────────────────────────────────────────────────

test.describe("Pagination", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    for (let i = 0; i < 30; i++) {
      seedJob({
        campaignId,
        title: `Job ${i + 1}`,
        fitSummary: makeFitSummary(50 + i),
        company: `Company ${i + 1}`,
      });
    }
    await resetServer(BASE);
  });

  test("shows 20 jobs by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-card--pending")).toHaveCount(20);
  });

  test("page indicator shows 1 / 2", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".page-indicator").first()).toContainText("1 / 2");
  });

  test("prev button is disabled on page 1", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".prev-btn").first()).toBeDisabled();
  });

  test("next button navigates to page 2", async ({ page }) => {
    await page.goto("/");
    await page.locator(".next-btn").first().click();
    await expect(page.locator(".page-indicator").first()).toContainText("2 / 2");
    await expect(page.locator(".app-card--pending")).toHaveCount(10);
  });

  test("page size 40 shows all 30 on one page", async ({ page }) => {
    await page.goto("/");
    await page.locator(".page-size-btn").filter({ hasText: "40" }).first().click();
    await expect(page.locator(".app-card--pending")).toHaveCount(30);
    await expect(page.locator(".page-indicator").first()).toContainText("1 / 1");
  });
});

// ── Bulk Actions ────────────────────────────────────────────────────────

test.describe("Bulk Actions", () => {
  let campaignId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    campaignId = seedCampaign();
    seedJob({ campaignId, fitSummary: makeFitSummary(80), title: "Job A" });
    seedJob({ campaignId, fitSummary: makeFitSummary(60), title: "Job B" });
    seedJob({ campaignId, fitSummary: makeFitSummary(40), title: "Job C" });
    await resetServer(BASE);
  });

  test("clicking checkbox shows bulk bar", async ({ page }) => {
    await page.goto("/");
    await page.locator(".job-checkbox-wrap").first().click();
    await expect(page.locator(".bulk-bar")).toBeVisible();
    await expect(page.locator(".bulk-bar-count")).toContainText("1 selected");
  });

  test("select all selects all visible jobs", async ({ page }) => {
    await page.goto("/");
    await page.locator(".job-checkbox-wrap").first().click();
    await page.locator(".bulk-bar-btn--select-all").click();
    await expect(page.locator(".bulk-bar-count")).toContainText("3 selected");
  });

  test("deselecting hides bulk bar", async ({ page }) => {
    await page.goto("/");
    await page.locator(".job-checkbox-wrap").first().click();
    await expect(page.locator(".bulk-bar")).toBeVisible();
    await page.locator(".job-checkbox-wrap").first().click();
    await expect(page.locator(".bulk-bar")).not.toBeVisible();
  });
});

// ── Fit Modal ───────────────────────────────────────────────────────────

test.describe("Fit Modal", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    seedJob({
      campaignId,
      fitSummary: makeFitSummary(75),
      title: "Modal Test Job",
      keywords: "TypeScript,React,Node.js",
    });
    await resetServer(BASE);
  });

  test("clicking fit badge opens modal", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fit-badge").click();
    await expect(page.locator("#fit-modal")).toBeVisible();
    await expect(page.locator(".fit-modal-title")).toContainText("Fit Analysis");
  });

  test("modal shows score, strengths, and verdict", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fit-badge").click();
    await expect(page.locator(".score-val")).toContainText("75");
    await expect(page.locator(".fit-chip-strength")).toHaveCount(3);
    await expect(page.locator(".fit-modal-verdict")).toContainText("Good match");
  });

  test("modal shows JD keywords", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fit-badge").click();
    await expect(page.locator(".fit-kw-chip")).toHaveCount(3);
  });

  test("close button dismisses modal", async ({ page }) => {
    await page.goto("/");
    await page.locator(".fit-badge").click();
    await expect(page.locator("#fit-modal")).toBeVisible();
    await page.locator(".fit-modal-close").click();
    await expect(page.locator("#fit-modal")).not.toBeVisible();
  });
});

// ── Campaign History ────────────────────────────────────────────────────

test.describe("Campaign History", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    const c1 = seedCampaign({ titles: "Frontend Dev", status: "stopped" });
    const c2 = seedCampaign({ titles: "Backend Dev", status: "stopped" });
    seedJob({ campaignId: c1, status: "applied", title: "Applied Job" });
    seedJob({ campaignId: c1, status: "discarded", title: "Discarded Job" });
    await resetServer(BASE);
  });

  test("shows campaign history section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".campaign-history-summary")).toContainText("Campaign History");
  });

  test("expanding history shows campaign rows", async ({ page }) => {
    await page.goto("/");
    await page.locator(".campaign-history-summary").click();
    await expect(page.locator(".campaign-row")).toHaveCount(2);
  });

  test("campaign row shows stats", async ({ page }) => {
    await page.goto("/");
    await page.locator(".campaign-history-summary").click();
    const row = page.locator(".campaign-row").first();
    await expect(row.locator(".campaign-stat--applied")).toBeVisible();
  });
});

// ── Manual Queue ────────────────────────────────────────────────────────

test.describe("Manual Queue", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    seedManualJob(campaignId, { company: "ManualCorp", title: "PM Role" });
    await resetServer(BASE);
  });

  test("shows manual queue section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".manual-queue-title")).toContainText("Manual Queue");
  });

  test("manual job shows apply manually badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".badge-manual")).toContainText("Apply Manually");
  });
});

// ── Review Page ─────────────────────────────────────────────────────────

test.describe("Review Page", () => {
  let jobId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    jobId = seedJob({
      campaignId,
      fitSummary: makeFitSummary(78),
      title: "Product Manager",
      company: "TechCorp",
      atsScore: 80,
      originalAtsScore: 55,
      resumePath: TEST_RESUME_PATH,
      modelUsed: "groq/llama-3.3-70b",
      jobDescription: "Looking for a PM with 5 years experience.",
      keywords: "product,strategy,roadmap",
      jdSummary: "PM role focused on product strategy.",
    });
    await resetServer(BASE);
  });

  test("renders review page with job title", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".review-title")).toContainText("Product Manager");
    await expect(page.locator(".review-meta")).toContainText("TechCorp");
  });

  test("shows ATS rings", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".ats-ring-wrap--original")).toBeVisible();
    await expect(page.locator(".ats-ring-wrap--tailored")).toBeVisible();
  });

  test("shows fit bar with strengths and verdict", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".fit-chip--strength")).toHaveCount(3);
    await expect(page.locator(".fit-verdict")).toContainText("Good match");
  });

  test("shows job brief panel with JD summary", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".jd-summary-text")).toContainText("PM role focused on product strategy");
  });

  test("shows JD keyword chips", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".jd-keyword-chip")).toHaveCount(3);
  });

  test("shows resume panel with model badge", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".panel-label")).toContainText("TAILORED RESUME");
    await expect(page.locator(".tailored-model-badge")).toContainText("groq/llama-3.3-70b");
  });

  test("shows action buttons: apply, discard, back", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".btn-apply")).toContainText("Apply Now");
    await expect(page.locator(".btn-discard")).toContainText("Discard");
    await expect(page.locator(".btn-back-dash")).toContainText("Dashboard");
  });

  test("shows full JD toggle", async ({ page }) => {
    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".jd-full-toggle summary")).toContainText("Show full description");
  });
});

// ── Review Page: Untailored ─────────────────────────────────────────────

test.describe("Review Page - Untailored", () => {
  test("shows not tailored message with retailor button", async ({ page }) => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    const jobId = seedJob({
      campaignId,
      fitSummary: makeFitSummary(60),
      title: "Design Lead",
    });
    await resetServer(BASE);

    await page.goto(`/review/${jobId}`);
    await expect(page.locator(".resume-not-tailored-msg")).toContainText("not tailored");
    await expect(page.locator(".btn-retailor")).toBeVisible();
  });
});

// ── Detail Page (Applied) ───────────────────────────────────────────────

test.describe("Detail Page", () => {
  let appId: number;

  test.beforeEach(async () => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    appId = seedJob({
      campaignId,
      status: "applied",
      title: "Senior Dev",
      company: "BigCorp",
      atsScore: 90,
      originalAtsScore: 60,
      jobDescription: "Full stack role",
      jdSummary: "Full stack developer needed.",
      keywords: "react,node,typescript",
    });
    await resetServer(BASE);
  });

  test("renders detail page with title", async ({ page }) => {
    await page.goto(`/application/${appId}`);
    await expect(page.locator(".review-title")).toContainText("Senior Dev");
    await expect(page.locator(".review-meta")).toContainText("BigCorp");
  });

  test("shows ATS comparison rings", async ({ page }) => {
    await page.goto(`/application/${appId}`);
    await expect(page.locator(".ats-ring-wrap--original")).toBeVisible();
    await expect(page.locator(".ats-ring-wrap--tailored")).toBeVisible();
  });

  test("shows back link to dashboard", async ({ page }) => {
    await page.goto(`/application/${appId}`);
    await expect(page.locator(".back-link")).toContainText("JobBot");
  });
});

// ── Settings Page ───────────────────────────────────────────────────────

test.describe("Settings Page", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("renders settings form with prefilled values", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("h2")).toContainText("Settings");
    await expect(page.locator("#name")).toHaveValue("Test User");
    await expect(page.locator("#email")).toHaveValue("test@example.com");
    await expect(page.locator("#phone")).toHaveValue("+1234567890");
  });

  test("shows current resume filename", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".file-current")).toContainText("resume.docx");
  });

  test("has back link to dashboard", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".back-link")).toContainText("Dashboard");
  });

  test("has save button", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /Save/ })).toBeVisible();
  });
});

// ── Navigation ──────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("dashboard settings link navigates to settings", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Settings").first().click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("settings back link navigates to dashboard", async ({ page }) => {
    await page.goto("/settings");
    await page.locator(".back-link").click();
    await expect(page).toHaveURL("/");
  });

  test("review card link navigates to review page", async ({ page }) => {
    const campaignId = seedCampaign();
    seedJob({ campaignId, fitSummary: makeFitSummary(70), title: "Nav Test" });
    await resetServer(BASE);

    await page.goto("/");
    await page.locator(".app-card-inner").first().click();
    await expect(page).toHaveURL(/\/review\/\d+/);
  });
});

// ── API Routes ──────────────────────────────────────────────────────────

test.describe("API Routes", () => {
  test.beforeEach(async () => {
    seedSetupComplete();
    await resetServer(BASE);
  });

  test("GET /api/status returns status", async ({ request }) => {
    const res = await request.get("/api/status");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("status");
  });

  test("GET /api/usage returns usage data", async ({ request }) => {
    const res = await request.get("/api/usage");
    expect(res.ok()).toBeTruthy();
  });

  test("POST /api/retry-fit returns response", async ({ request }) => {
    const res = await request.post("/api/retry-fit");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("started");
  });

  test("POST /api/campaign/stop returns redirect", async ({ request }) => {
    const res = await request.post("/api/campaign/stop", {
      maxRedirects: 0,
    });
    // Should redirect (303) even if no campaign is running
    expect([200, 303]).toContain(res.status());
  });

  test("GET /api/linkedin-status returns status", async ({ request }) => {
    const res = await request.get("/api/linkedin-status");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("connected");
  });

  test("POST /api/bulk-discard discards selected jobs", async ({ request }) => {
    const campaignId = seedCampaign();
    const id1 = seedJob({ campaignId, fitSummary: makeFitSummary(50) });
    const id2 = seedJob({ campaignId, fitSummary: makeFitSummary(40) });
    await resetServer(BASE);

    const res = await request.post("/api/bulk-discard", {
      multipart: {
        job_ids: String(id1),
      },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ── Applications List ───────────────────────────────────────────────────

test.describe("Applications List", () => {
  test("shows applied applications in the list", async ({ page }) => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    seedJob({ campaignId, status: "applied", title: "Applied Role", company: "AppliedCo" });
    seedJob({ campaignId, status: "applied", title: "Another Applied", company: "Corp2" });
    await resetServer(BASE);

    await page.goto("/");
    const section = page.locator(".section-title").filter({ hasText: "Applications" });
    await expect(section).toBeVisible();
    // Applied jobs have badge-applied class
    await expect(page.locator(".badge-applied")).toHaveCount(2);
  });

  test("applied app shows checkmark badge", async ({ page }) => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    seedJob({ campaignId, status: "applied", title: "Applied One" });
    await resetServer(BASE);

    await page.goto("/");
    await expect(page.locator(".badge-applied")).toContainText("Applied");
  });

  test("app card links to detail page", async ({ page }) => {
    seedSetupComplete();
    const campaignId = seedCampaign();
    const appId = seedJob({ campaignId, status: "applied", title: "Click Me" });
    await resetServer(BASE);

    await page.goto("/");
    await page.locator(".app-card").filter({ has: page.locator(".badge-applied") }).first().click();
    await expect(page).toHaveURL(/\/application\/\d+/);
  });
});
