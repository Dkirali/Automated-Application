import { test, expect } from "@playwright/test";
import { resolve } from "path";
import {
  prepare,
  connectLinkedinFixture,
  disconnectLinkedinFixture,
} from "./fixtures/seed";
import { SetupPage } from "./pages/SetupPage";
import { LinkedinStepPage } from "./pages/LinkedinStepPage";

const SAMPLE_RESUME = resolve(__dirname, "fixtures/sample.docx");

// We don't have a real DOCX bundled — Setup accepts .docx/.doc/.pdf, but the
// raw bytes are not parsed at setup-time (only the extension is checked, and
// the file is copied as `master.<ext>`). A tiny placeholder works.
import { writeFileSync } from "fs";
writeFileSync(SAMPLE_RESUME, "%PK placeholder", "binary");

test.describe("Onboarding — Setup (Step 1)", () => {
  test.beforeEach(async ({ request }) => {
    await prepare(request, { setupComplete: false });
    disconnectLinkedinFixture();
  });

  test("renders the empty setup form and redirects after submit to /setup/linkedin", async ({
    page,
  }) => {
    const setup = new SetupPage(page);
    await setup.goto();
    await setup.expectVisible();

    // Country dropdown is populated and defaults to US
    await expect(setup.countrySelect).toHaveValue("US");

    // Provider dropdown defaults to Groq
    await expect(setup.providerSelect).toHaveValue("groq");
    // Placeholder reflects the chosen provider
    await expect(setup.apiKey).toHaveAttribute("placeholder", /gsk_/);

    // Switch provider to anthropic → placeholder updates
    await setup.providerSelect.selectOption("anthropic");
    await expect(setup.apiKey).toHaveAttribute("placeholder", /sk-ant-/);

    // Switch back to Groq for submission
    await setup.providerSelect.selectOption("groq");

    await setup.fill({
      name: "Alex Smith",
      email: "alex.smith@example.com",
      countryCode: "TR",
      phoneDigits: "5322860461",
      provider: "groq",
      apiKey: "gsk_test_key_e2e_only",
      resumePath: SAMPLE_RESUME,
    });

    // File upload UI flips to UPLOADED
    await expect(page.locator(".file-drop--uploaded")).toBeVisible();
    await expect(page.locator(".file-drop-badge")).toContainText("UPLOADED");
    await expect(page.locator(".file-drop-filename")).toContainText("sample.docx");

    // Country change updates the hidden phone field with the right dial code
    const phoneHidden = page.locator("input[type='hidden'][name='phone']");
    await expect(phoneHidden).toHaveValue("+90 5322860461");

    await setup.submit.click();
    await page.waitForURL("**/setup/linkedin");

    const linkedin = new LinkedinStepPage(page);
    await linkedin.expectVisible();
    await linkedin.expectNotConnected();
  });

  test("shows a mismatch warning when the pasted key prefix doesn't match the selected provider", async ({
    page,
  }) => {
    const setup = new SetupPage(page);
    await setup.goto();

    // Provider stays on Groq, but paste an Anthropic key
    await setup.apiKey.fill("sk-ant-something-real-looking");
    await expect(page.locator(".form-warning")).toContainText(/looks like a .*anthropic/i);
  });
});

test.describe("Onboarding — LinkedIn (Step 2)", () => {
  test.beforeEach(async ({ request }) => {
    // Setup must be complete to render the linkedin step at all
    await prepare(request, { setupComplete: true, withApplications: false });
  });

  test("shows 'Not connected' when no cookie file exists", async ({ page }) => {
    disconnectLinkedinFixture();
    const step = new LinkedinStepPage(page);
    await step.goto();
    await step.expectVisible();
    await step.expectNotConnected();
    await expect(step.skipLink).toBeVisible();
  });

  test("shows 'Connected' and a 'Go to dashboard' link when cookies are present", async ({
    page,
  }) => {
    connectLinkedinFixture();
    const step = new LinkedinStepPage(page);
    await step.goto();
    await step.expectVisible();
    await step.expectConnected();
    await expect(step.goDashboardLink).toBeVisible();
  });

  test("/setup/linkedin redirects to /setup when setup is incomplete", async ({
    page,
    request,
  }) => {
    await prepare(request, { setupComplete: false });
    disconnectLinkedinFixture();
    await page.goto("/setup/linkedin");
    await page.waitForURL("**/setup");
  });
});
