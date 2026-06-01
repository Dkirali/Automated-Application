import { Page, Locator, expect } from "@playwright/test";

export class SetupPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly name: Locator;
  readonly email: Locator;
  readonly phone: Locator;
  readonly countrySelect: Locator;
  readonly providerSelect: Locator;
  readonly apiKey: Locator;
  readonly resumeInput: Locator;
  readonly submit: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: /Let.s get you set up/i });
    this.name = page.locator("#name");
    this.email = page.locator("#email");
    this.phone = page.locator("#phone-number");
    this.countrySelect = page.locator(".phone-country");
    this.providerSelect = page.locator(".provider-select");
    this.apiKey = page.locator("#api-key");
    this.resumeInput = page.locator("#resume-input");
    this.submit = page.getByRole("button", { name: /Save & Continue/i });
  }

  async goto() {
    await this.page.goto("/setup");
  }

  async expectVisible() {
    await expect(this.heading).toBeVisible();
  }

  async fill(opts: {
    name: string;
    email: string;
    countryCode: string;
    phoneDigits: string;
    provider: "groq" | "anthropic" | "openrouter";
    apiKey: string;
    resumePath: string;
  }) {
    await this.name.fill(opts.name);
    await this.email.fill(opts.email);
    await this.countrySelect.selectOption(opts.countryCode);
    await this.phone.fill(opts.phoneDigits);
    await this.providerSelect.selectOption(opts.provider);
    await this.apiKey.fill(opts.apiKey);
    await this.resumeInput.setInputFiles(opts.resumePath);
  }
}
