import { Page, Locator, expect } from "@playwright/test";

export class DashboardPage {
  readonly page: Page;
  readonly brand: Locator;
  readonly pendingCards: Locator;
  readonly usageGauge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.brand = page.locator(".topbar-brand h1");
    this.pendingCards = page.locator(".app-card--pending");
    this.usageGauge = page.getByText(/Daily API usage/);
  }

  async goto() {
    await this.page.goto("/");
  }

  async expectVisible() {
    await expect(this.brand).toContainText(/JobBot/i);
  }

  cardByTitle(title: string | RegExp): Locator {
    return this.pendingCards.filter({ hasText: title });
  }
}
