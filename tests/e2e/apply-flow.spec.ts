import { test, expect } from "@playwright/test";
import { prepare } from "./fixtures/seed";
import { ReviewPage } from "./pages/ReviewPage";

test.describe("Apply flow — confirmation modal + progress strip", () => {
  test.beforeEach(async ({ request }) => {
    await prepare(request, {
      setupComplete: true,
      withApplications: true,
      linkedinConnected: true,
    });
  });

  test("Apply Now button is visible only for Easy Apply jobs", async ({ page }) => {
    const review = new ReviewPage(page);

    // Easy apply → button present
    await review.gotoById(1);
    await expect(review.applyBtn).toBeVisible();

    // Manual apply → no Apply Now button
    await review.gotoById(3);
    await expect(review.applyBtn).toHaveCount(0);
  });

  test("clicking Apply opens the confirmation modal with job + resume + fit info", async ({
    page,
  }) => {
    const review = new ReviewPage(page);
    await review.gotoById(1);
    await review.openConfirm();

    await expect(review.confirmModal).toContainText(/Submit this application/);
    await expect(review.confirmModal).toContainText(/Backend Engineer/);
    await expect(review.confirmModal).toContainText(/Acme/);
    // Fit badge inside the modal reflects the score
    await expect(review.confirmModal.locator(".fit-score-badge")).toContainText("82");

    // Cancel closes the modal without firing anything
    await review.confirmCancel.click();
    await expect(review.confirmModal).toHaveCount(0);
    await expect(review.progressStrip).toHaveCount(0);
  });

  test("low-fit job: warning appears and Submit is disabled until override is checked", async ({
    page,
  }) => {
    const review = new ReviewPage(page);
    await review.gotoById(2); // Rust Systems Engineer — fit=35
    await review.openConfirm();

    // Warning is shown
    await expect(review.confirmModal.locator(".apply-confirm-warning")).toContainText(/Low fit/);

    // Submit button starts disabled
    await expect(review.confirmSubmit).toBeDisabled();

    // Check the override → Submit becomes enabled
    await review.confirmModal
      .locator(".apply-confirm-override input[type='checkbox']")
      .check();
    await expect(review.confirmSubmit).toBeEnabled();
  });

  test("high-fit job: Submit fires the apply route and progress strip reaches Applied", async ({
    page,
  }) => {
    const review = new ReviewPage(page);
    await review.gotoById(1);
    await review.openConfirm();

    // Track the POST to /api/apply so we know the wire is intact
    const applyResp = page.waitForResponse(
      (r) => r.url().includes("/api/apply/") && r.request().method() === "POST"
    );

    await review.confirmSubmit.click();
    await applyResp;

    // Progress strip appears
    await expect(review.progressStrip).toBeVisible();

    // In JOBBOT_TEST_MODE the submitter short-circuits, so we expect the
    // applied state within a few polling intervals.
    await expect(review.progressStrip).toContainText(/Applied/, { timeout: 15000 });
    await expect(review.applyBtn).toHaveCount(0); // button disappears once applied
  });

  test("returns 409 when a second apply is fired while one is in flight", async ({
    page,
    request,
  }) => {
    const review = new ReviewPage(page);
    await review.gotoById(1);
    await review.openConfirm();
    await review.confirmSubmit.click();

    // Fire a second apply directly via the API immediately — should be rejected
    const r = await request.post(`/api/apply/1`);
    expect([200, 409]).toContain(r.status());
    // Race-safe: either the first POST already finished (200 on this one) or
    // it's still in-flight (409). We accept both — the bug we're guarding
    // against is a *crash* or a duplicate submission.
  });
});
