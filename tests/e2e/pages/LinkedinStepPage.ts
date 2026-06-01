import { Page, Locator, expect } from "@playwright/test";

export class LinkedinStepPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly statusPill: Locator;
  readonly connectButton: Locator;
  readonly goDashboardLink: Locator;
  readonly skipLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: /Connect LinkedIn/i });
    this.statusPill = page.locator(".li-pill");
    this.connectButton = page.getByRole("button", { name: /Connect LinkedIn/i });
    this.goDashboardLink = page.getByRole("link", { name: /Go to dashboard/i });
    this.skipLink = page.getByRole("link", { name: /Skip for now/i });
  }

  async goto() {
    await this.page.goto("/setup/linkedin");
  }

  async expectVisible() {
    await expect(this.heading).toBeVisible();
  }

  async expectConnected() {
    await expect(this.statusPill).toHaveClass(/li-pill--on/);
  }

  async expectNotConnected() {
    await expect(this.statusPill).toHaveClass(/li-pill--off/);
  }
}
