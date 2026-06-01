import { test, expect } from "@playwright/test";
import { prepare, connectLinkedinFixture } from "./fixtures/seed";
import { DashboardPage } from "./pages/DashboardPage";
import { ReviewPage } from "./pages/ReviewPage";

test.describe("Dashboard — pending jobs render", () => {
  test.beforeEach(async ({ request }) => {
    await prepare(request, {
      setupComplete: true,
      withApplications: true,
      linkedinConnected: true,
    });
  });

  test("renders pending jobs with fit scores and easy/manual badges", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await dash.expectVisible();

    // All three seeded apps appear
    await expect(dash.pendingCards).toHaveCount(3);

    // High-fit easy-apply card shows its fit score and Easy Apply badge
    const easyHigh = dash.cardByTitle(/Backend Engineer/);
    await expect(easyHigh).toBeVisible();
    await expect(easyHigh.locator(".fit-badge")).toContainText("82");
    await expect(easyHigh.locator(".apply-badge--easy")).toBeVisible();

    // Manual-apply card shows the manual badge
    const manual = dash.cardByTitle(/Product Manager/);
    await expect(manual.locator(".apply-badge--manual")).toBeVisible();

    // Low-fit easy-apply still shows the Easy Apply badge and a fit number
    const lowFit = dash.cardByTitle(/Rust Systems Engineer/);
    await expect(lowFit.locator(".apply-badge--easy")).toBeVisible();
    await expect(lowFit.locator(".fit-badge")).toContainText("35");
  });

  test("clicking a card navigates to the review page", async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();
    await dash.cardByTitle(/Backend Engineer/).getByRole("link").first().click();

    const review = new ReviewPage(page);
    await review.expectVisible();
    await expect(review.title).toContainText(/Backend Engineer/);
  });

  test("LinkedIn status pill shows Connected when cookies exist", async ({ page }) => {
    connectLinkedinFixture();
    await page.goto("/");
    await expect(page.locator(".li-pill")).toHaveClass(/li-pill--on/);
  });
});

test.describe("Review page — fit breakdown", () => {
  test.beforeEach(async ({ request }) => {
    await prepare(request, {
      setupComplete: true,
      withApplications: true,
      linkedinConnected: true,
    });
  });

  test("renders the deterministic breakdown with keyword chips and hard requirements", async ({
    page,
  }) => {
    const review = new ReviewPage(page);
    await review.gotoById(1); // first seeded application = Backend Engineer
    await review.expectVisible();

    // Headline score badge
    await expect(review.fitScoreBadge).toContainText("82");

    // Breakdown labels
    await expect(review.fitBreakdown).toContainText(/Keyword Coverage/);
    await expect(review.fitBreakdown).toContainText(/Hard Requirements/);
    await expect(review.fitBreakdown).toContainText(/Resume Parseability/);

    // Required keyword chips include the seeded keywords
    const requiredBlock = page
      .locator(".fit-detail-block")
      .filter({ hasText: /Required keywords/i });
    await expect(requiredBlock).toContainText("Python");
    await expect(requiredBlock).toContainText("AWS");

    // Hard requirements list shows both items as met (✓) with evidence
    await expect(review.hardReqs).toBeVisible();
    const metItems = review.hardReqs.locator(".fit-hardreq--met");
    await expect(metItems).toHaveCount(2);
  });

  test("low-fit job renders chips for missed required keywords", async ({ page }) => {
    const review = new ReviewPage(page);
    await review.gotoById(2); // Rust Systems Engineer — both hard reqs missed
    await review.expectVisible();

    const missingReqs = review.hardReqs.locator(".fit-hardreq--missing");
    await expect(missingReqs).toHaveCount(2);
  });
});
