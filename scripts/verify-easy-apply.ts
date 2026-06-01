// Run the NEW scraper.isEasyApply detector against a real LinkedIn URL
// using the same authenticated Chrome profile the scraper uses, so we can
// prove the fix works on real DOM before claiming it shipped.
//
// Usage:
//   npx tsx scripts/verify-easy-apply.ts <url> [<url> ...]
import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";

const PROFILE = join(homedir(), ".jobbot-chrome");

// Inline copy of the detector body so we can run it without booting Next.
async function isEasyApplyOnPage(page: import("playwright").Page): Promise<boolean> {
  try {
    await page.waitForSelector(
      "[data-view-name='job-apply-button'], button.jobs-apply-button, button[aria-label*='easy apply' i], button[aria-label*='linkedin apply' i]",
      { timeout: 12000 }
    );
  } catch {
    console.log("[easy-apply] timed out waiting for apply control");
    return false;
  }

  const result = await page.evaluate(() => {
    const applyRe =
      /apply|başvur|solicit|candidat|postul|bewerb|sollicit|応募|지원/i;
    type Sig = { isEasy: boolean; reason: string; matched: string; href?: string; seen?: unknown };

    const primary = document.querySelector<HTMLElement>("[data-view-name='job-apply-button']");
    if (primary) {
      const href = (primary.getAttribute("href") || "").toLowerCase();
      const hasLinkedinBug = !!primary.querySelector("svg[id^='linkedin-bug' i]");
      const hasExternalIcon = !!primary.querySelector("svg[id^='link-external' i]");
      const hasSdui = href.includes("opensduiapplyflow=true");
      const hasSafetyGo = href.includes("/safety/go/");
      const matched = (primary.getAttribute("aria-label") || primary.textContent || "").trim().slice(0, 80);
      if (hasLinkedinBug || hasSdui) {
        return { isEasy: true, reason: hasLinkedinBug ? "data-view-name + linkedin-bug icon" : "data-view-name + openSDUIApplyFlow", matched, href: primary.getAttribute("href") || "" } as Sig;
      }
      if (hasExternalIcon || hasSafetyGo) {
        return { isEasy: false, reason: hasExternalIcon ? "data-view-name with link-external icon" : "data-view-name with safety/go href", matched, href: primary.getAttribute("href") || "" } as Sig;
      }
      return { isEasy: false, reason: "data-view-name but no Easy/External signal", matched, href: primary.getAttribute("href") || "" } as Sig;
    }

    const sdui = document.querySelector<HTMLAnchorElement>("a[href*='openSDUIApplyFlow=true']");
    if (sdui) {
      return {
        isEasy: true,
        reason: "href has openSDUIApplyFlow=true",
        matched: sdui.textContent?.trim().slice(0, 80) || "",
        href: sdui.href,
      } as Sig;
    }

    const legacy = Array.from(
      document.querySelectorAll<HTMLElement>("button.jobs-apply-button, button[aria-label*='apply' i]")
    );
    for (const b of legacy) {
      const text = (b.textContent || "").trim();
      const aria = (b.getAttribute("aria-label") || "").trim();
      if (/easy\s+apply/i.test(text) || /easy\s+apply/i.test(aria) || b.classList.contains("jobs-apply-button")) {
        return { isEasy: true, reason: "legacy jobs-apply-button", matched: aria || text } as Sig;
      }
    }

    const seen = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
      .filter((el) => {
        const t = (el.textContent || "").trim();
        const a = (el.getAttribute("aria-label") || "").trim();
        return applyRe.test(t) || applyRe.test(a);
      })
      .slice(0, 5)
      .map((el) => ({ tag: el.tagName.toLowerCase(), aria: (el.getAttribute("aria-label") || "").trim(), text: (el.textContent || "").trim().slice(0, 60) }));
    return { isEasy: false, reason: seen.length ? "apply-shaped but no Easy-Apply signal" : "no apply controls", matched: "", seen } as Sig;
  });

  console.log(
    `[easy-apply] isEasy=${result.isEasy} reason="${result.reason}"` +
      (result.isEasy ? ` matched="${result.matched}"` : ` seen=${JSON.stringify(result.seen ?? [])}`)
  );
  return result.isEasy;
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error("usage: tsx scripts/verify-easy-apply.ts <url> [<url> ...]");
    process.exit(1);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await ctx.newPage();
  for (const url of urls) {
    console.log("\n=== " + url + " ===");
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Wait for the apply control to actually hydrate. LinkedIn's React
    // shell can take a while; we use networkidle as an extra signal that
    // the page has finished hydrating.
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch { /* ignore */ }
    try {
      await page.waitForSelector("[data-view-name='job-apply-button']", { timeout: 15000 });
    } catch {
      /* the detector will log the timeout */
    }
    const result = await isEasyApplyOnPage(page);
    console.log(`→ ${result ? "✅ EASY APPLY" : "❌ NOT easy apply"}`);
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
