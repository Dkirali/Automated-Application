import type { Page } from "playwright";

export enum StopSignal {
  CAPTCHA = "CAPTCHA detected — automation paused",
  SESSION_EXPIRED = "Session expired — please log into LinkedIn again",
  RATE_LIMITED = "LinkedIn is rate limiting — paused for 30 minutes",
  REPEATED_FAILURES = "Too many submission failures in a row",
  ACCOUNT_RESTRICTED = "Account may be restricted — check LinkedIn",
}

export function classifyStopSignal(signal: string): StopSignal | null {
  const map: Record<string, StopSignal> = {
    captcha: StopSignal.CAPTCHA,
    login_redirect: StopSignal.SESSION_EXPIRED,
    rate_limit: StopSignal.RATE_LIMITED,
    repeated_failures: StopSignal.REPEATED_FAILURES,
    account_restricted: StopSignal.ACCOUNT_RESTRICTED,
  };
  return map[signal] ?? null;
}

export async function checkPageForStopSignal(page: Page): Promise<StopSignal | null> {
  const url = page.url().toLowerCase();

  if (url.includes("checkpoint") || url.includes("challenge")) {
    return StopSignal.CAPTCHA;
  }

  if (url.includes("linkedin.com/login")) {
    return StopSignal.SESSION_EXPIRED;
  }

  if ((await page.locator("text=too many requests").count()) > 0) {
    return StopSignal.RATE_LIMITED;
  }

  if ((await page.locator("text=Your account has been restricted").count()) > 0) {
    return StopSignal.ACCOUNT_RESTRICTED;
  }

  return null;
}
