import type { Page } from "playwright";
import { existsSync } from "fs";
import { getBrowserContext } from "./scraper";

export type ProgressFn = (
  state:
    | "opening"
    | "easy_apply_click"
    | "filling"
    | "submitting"
    | "awaiting_user"
    | "applied"
    | "failed",
  message: string
) => void;

export interface SubmitResult {
  outcome: "applied" | "awaiting_user" | "failed";
  reason?: string;
}

async function fillVisibleFields(
  page: Page,
  phone: string,
  pdfPath: string
): Promise<void> {
  for (const fieldLabel of ["Phone", "Mobile phone number"]) {
    try {
      const field = page.getByLabel(fieldLabel, { exact: true });
      if ((await field.count()) > 0 && (await field.first().isVisible())) {
        await field.first().fill(phone);
      }
    } catch {
      // ignore
    }
  }

  const upload = page.locator("input[type='file']");
  if (pdfPath && (await upload.count()) > 0 && existsSync(pdfPath)) {
    try {
      await upload.first().setInputFiles(pdfPath);
    } catch {
      // ignore
    }
  }
}

// Count modal inputs that are visible, required, and still empty — these are
// the signals that the bot can't progress and the user needs to finish manually.
async function countUnfilledRequired(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const modal = document.querySelector(".jobs-easy-apply-modal");
      if (!modal) return 0;
      const fields = modal.querySelectorAll(
        "input[required]:not([type=hidden]), select[required], textarea[required]"
      );
      let unfilled = 0;
      for (const f of fields) {
        const el = f as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        if ((el as HTMLElement).offsetParent === null) continue; // hidden
        if (!el.value || !el.value.toString().trim()) unfilled++;
      }
      return unfilled;
    });
  } catch {
    return 0;
  }
}

async function fillEasyApply(
  page: Page,
  phone: string,
  pdfPath: string,
  progress: ProgressFn
): Promise<SubmitResult> {
  try {
    await page.waitForSelector(".jobs-easy-apply-modal", { timeout: 10000 });
  } catch {
    return { outcome: "failed", reason: "easy_apply_modal_not_found" };
  }

  const maxSteps = 10;
  for (let i = 0; i < maxSteps; i++) {
    progress("filling", `Filling form (step ${i + 1})…`);
    await fillVisibleFields(page, phone, pdfPath);

    const submit = page.locator("button[aria-label='Submit application']");
    const nextBtn = page.locator("button[aria-label='Continue to next step']");
    const reviewBtn = page.locator("button[aria-label='Review your application']");

    if ((await submit.count()) > 0) {
      progress("submitting", "Submitting application…");
      await submit.first().click();
      await page.waitForTimeout(2500);
      return { outcome: "applied" };
    }

    if ((await reviewBtn.count()) > 0) {
      await reviewBtn.first().click();
      await page.waitForTimeout(1500);
      continue;
    }

    if ((await nextBtn.count()) > 0) {
      await nextBtn.first().click();
      await page.waitForTimeout(1500);
      continue;
    }

    // No actionable button found — see if there are unfilled required fields
    const unfilled = await countUnfilledRequired(page);
    if (unfilled > 0) {
      progress(
        "awaiting_user",
        `${unfilled} field${unfilled === 1 ? "" : "s"} need your input. Complete the form in the Chrome window and click Submit.`
      );
      return { outcome: "awaiting_user", reason: "custom_questions" };
    }
    break;
  }

  return { outcome: "failed", reason: "modal_stalled" };
}

// When awaiting_user, the Playwright browser stays open. We poll for the
// LinkedIn post-submit confirmation modal (or a closed modal + success state)
// and resolve when the user finishes manually.
async function waitForUserSubmit(
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // LinkedIn shows a confirmation dialog when the application is submitted
      const confirmModal = page.locator("h2:has-text('Your application was sent')");
      if ((await confirmModal.count()) > 0) return true;

      // Or the post-apply confirmation banner
      const sentBanner = page.locator("[data-test-modal-id='easy-apply-success-modal']");
      if ((await sentBanner.count()) > 0) return true;

      // Modal disappeared entirely — assume submitted
      const modalGone =
        (await page.locator(".jobs-easy-apply-modal").count()) === 0;
      if (modalGone) return true;
    } catch {
      // page closed mid-check — treat as cancelled
      return false;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

export async function submitApplication(
  jobUrl: string,
  pdfPath: string,
  _name: string,
  _email: string,
  phone: string,
  progress: ProgressFn = () => {}
): Promise<SubmitResult> {
  // Test-mode shim — when JOBBOT_TEST_MODE=1 (set by playwright.config), simulate
  // the full progress sequence without launching real Chrome or touching LinkedIn.
  if (process.env.JOBBOT_TEST_MODE === "1") {
    progress("opening", "[test] Opening LinkedIn job page…");
    await new Promise((r) => setTimeout(r, 50));
    progress("easy_apply_click", "[test] Clicking Easy Apply…");
    await new Promise((r) => setTimeout(r, 50));
    progress("filling", "[test] Filling form (step 1)…");
    await new Promise((r) => setTimeout(r, 50));
    progress("submitting", "[test] Submitting application…");
    await new Promise((r) => setTimeout(r, 50));
    return { outcome: "applied", reason: "test_mode" };
  }

  const context = await getBrowserContext();
  try {
    const page = await context.newPage();
    progress("opening", "Opening LinkedIn job page…");
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Dismiss interstitial popup if present
    const notNow = page.locator("button[aria-label='Not now']");
    if ((await notNow.count()) > 0) {
      await notNow.click();
      await page.waitForTimeout(1000);
    }

    // The Apply control is now an <a data-view-name="job-apply-button">
    // (or legacy button for older LinkedIn UI). Match both, and prefer the
    // primary data-view-name selector — it works regardless of UI locale.
    const applyBtn = page.locator(
      "[data-view-name='job-apply-button'], button.jobs-apply-button, button[aria-label*='Easy Apply' i], button[aria-label*='LinkedIn Apply' i]"
    );
    if ((await applyBtn.count()) === 0) {
      return { outcome: "failed", reason: "no_easy_apply_button" };
    }

    progress("easy_apply_click", "Clicking Apply…");
    await applyBtn.first().click();
    await page.waitForTimeout(2500);

    const result = await fillEasyApply(page, phone, pdfPath, progress);

    // When awaiting_user, leave the Chrome window open and watch for the
    // user to submit manually. The context only closes once we're done.
    if (result.outcome === "awaiting_user") {
      const submitted = await waitForUserSubmit(page, 5 * 60_000);
      return submitted
        ? { outcome: "applied", reason: "user_completed" }
        : { outcome: "failed", reason: "user_timeout" };
    }

    return result;
  } finally {
    await context.close();
  }
}
