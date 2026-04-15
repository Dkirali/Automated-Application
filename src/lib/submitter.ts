import type { Page } from "playwright";
import { existsSync } from "fs";
import { getBrowserContext } from "./scraper";

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

async function fillEasyApply(
  page: Page,
  name: string,
  email: string,
  phone: string,
  pdfPath: string
): Promise<boolean> {
  try {
    await page.waitForSelector(".jobs-easy-apply-modal", { timeout: 10000 });
  } catch {
    return false;
  }

  const maxSteps = 10;
  for (let i = 0; i < maxSteps; i++) {
    await fillVisibleFields(page, phone, pdfPath);

    const submit = page.locator("button[aria-label='Submit application']");
    const nextBtn = page.locator("button[aria-label='Continue to next step']");

    if ((await submit.count()) > 0) {
      await submit.click();
      await page.waitForTimeout(2000);
      return true;
    } else if ((await nextBtn.count()) > 0) {
      await nextBtn.click();
      await page.waitForTimeout(1500);
    } else {
      break;
    }
  }

  return false;
}

export async function submitApplication(
  jobUrl: string,
  pdfPath: string,
  name: string,
  email: string,
  phone: string
): Promise<boolean> {
  const context = await getBrowserContext();
  try {
    const page = await context.newPage();
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Dismiss interstitial popup if present
    const notNow = page.locator("button[aria-label='Not now']");
    if ((await notNow.count()) > 0) {
      await notNow.click();
      await page.waitForTimeout(1000);
    }

    const applyBtn = page.locator("[aria-label*='Easy Apply']");
    if ((await applyBtn.count()) === 0) return false;

    await applyBtn.first().click();
    await page.waitForTimeout(2000);

    return await fillEasyApply(page, name, email, phone, pdfPath);
  } finally {
    await context.close();
  }
}
