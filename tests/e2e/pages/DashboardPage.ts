import { Page, Locator, expect } from "@playwright/test";

export class DashboardPage {
  readonly page: Page;
  readonly brand: Locator;
  readonly pendingCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.brand = page.locator(".topbar-brand h1");
    this.pendingCards = page.locator(".app-card--pending");
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
