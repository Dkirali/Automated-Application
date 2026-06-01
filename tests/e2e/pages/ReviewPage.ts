import { Page, Locator, expect } from "@playwright/test";

export class ReviewPage {
  readonly page: Page;
  readonly title: Locator;
  readonly fitScoreBadge: Locator;
  readonly applyBtn: Locator;
  readonly discardBtn: Locator;
  readonly fitBreakdown: Locator;
  readonly hardReqs: Locator;
  readonly confirmModal: Locator;
  readonly confirmSubmit: Locator;
  readonly confirmCancel: Locator;
  readonly progressStrip: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator(".review-title");
    this.fitScoreBadge = page.locator(".fit-score-badge").first();
    this.applyBtn = page.getByRole("button", { name: /Apply Now/i });
    this.discardBtn = page.getByRole("button", { name: /Discard/i });
    this.fitBreakdown = page.locator(".fit-categories");
    this.hardReqs = page.locator(".fit-hardreq-list");
    this.confirmModal = page.locator(".apply-confirm");
    this.confirmSubmit = page.getByRole("button", { name: /Submit application/i });
    this.confirmCancel = page.getByRole("button", { name: /^Cancel$/ });
    this.progressStrip = page.locator(".apply-progress");
  }

  async gotoById(id: number) {
    await this.page.goto(`/review/${id}`);
  }

  async expectVisible() {
    await expect(this.title).toBeVisible();
  }

  async openConfirm() {
    await this.applyBtn.click();
    await expect(this.confirmModal).toBeVisible();
  }
}
