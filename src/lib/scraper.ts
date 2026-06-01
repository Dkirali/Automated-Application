import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "fs";

const JOBBOT_PROFILE = join(homedir(), ".jobbot-chrome");
const LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/";
const EASY_APPLY_SNAPSHOT_DIR = join(homedir(), ".jobbot-easy-apply-snapshots");
const EASY_APPLY_SNAPSHOT_LIMIT = 10;

// Save the visible HTML around the apply button when the detector times out
// so we can see exactly what LinkedIn is serving instead of guessing.
// Caps the snapshot directory at 10 files so it never fills the disk.
async function saveEasyApplySnapshot(page: Page, url: string): Promise<string | null> {
  try {
    mkdirSync(EASY_APPLY_SNAPSHOT_DIR, { recursive: true });
    // Rotate — keep the N most recent
    const existing = readdirSync(EASY_APPLY_SNAPSHOT_DIR)
      .filter((f) => f.endsWith(".html"))
      .sort();
    while (existing.length >= EASY_APPLY_SNAPSHOT_LIMIT) {
      const drop = existing.shift();
      if (drop) {
        try { unlinkSync(join(EASY_APPLY_SNAPSHOT_DIR, drop)); } catch { /* ignore */ }
      }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fname = join(EASY_APPLY_SNAPSHOT_DIR, `${ts}.html`);
    const html = await page.content();
    const header = `<!-- jobbot easy-apply snapshot · ${new Date().toISOString()} · ${url} -->\n`;
    writeFileSync(fname, header + html, "utf-8");
    return fname;
  } catch {
    return null;
  }
}

export function getProfilePath(): string {
  return process.env.JOBBOT_PROFILE_DIR || JOBBOT_PROFILE;
}

// Thrown when LinkedIn serves the unauthenticated "Join now"/login wall — i.e.
// the persistent profile's session is missing or expired. Callers should stop
// and prompt the user to reconnect rather than scrape an empty guest page.
export class LinkedinAuthError extends Error {
  constructor() {
    super("LinkedIn session expired — reconnect LinkedIn in Settings to continue.");
    this.name = "LinkedinAuthError";
  }
}

// An expired/missing session navigating to a jobs URL gets redirected by
// LinkedIn to an authwall / login / signup / security-checkpoint URL.
export function isAuthwallUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("/authwall") ||
    u.includes("/login") ||
    u.includes("/uas/login") ||
    u.includes("/signup") ||
    u.includes("/checkpoint/")
  );
}

export async function getBrowserContext(): Promise<BrowserContext> {
  mkdirSync(JOBBOT_PROFILE, { recursive: true });
  return chromium.launchPersistentContext(JOBBOT_PROFILE, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

export function isEasyApplyText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(^|[^a-z])easy\s+apply($|[^a-z])/i.test(text.trim());
}

async function isEasyApply(page: Page): Promise<boolean> {
  // The detector runs against LinkedIn's CURRENT DOM, which:
  //   • renders the apply control as an <a>, not a <button>
  //   • uses hashed CSS-module class names (no semantic `jobs-apply-button`)
  //   • localizes the visible text and aria-label ("Başvurun" in Turkish,
  //     "Solicitar" in Spanish, etc.) — so English keyword matching fails
  //   • renamed "Easy Apply" → "LinkedIn Apply" in 2026
  //
  // The reliable, locale-independent signal is the SAME element for BOTH
  // Easy and External apply: `[data-view-name='job-apply-button']`. The
  // type is then disambiguated by the icon inside and the href:
  //   - linkedin-bug icon  + openSDUIApplyFlow=true href → Easy Apply
  //   - link-external icon + /safety/go href             → External Apply
  //
  // We must wait for the primary control to hydrate before classifying —
  // bare linkedin-bug SVGs elsewhere on the page (header, footer, badges)
  // would otherwise produce a false positive via a too-loose fallback.
  try {
    await page.waitForLoadState("networkidle", { timeout: 8000 });
  } catch {
    /* some LinkedIn pages never idle — proceed anyway */
  }
  try {
    await page.waitForSelector(
      "[data-view-name='job-apply-button'], button.jobs-apply-button, button[aria-label*='easy apply' i], button[aria-label*='linkedin apply' i]",
      { timeout: 15000 }
    );
  } catch {
    const snapPath = await saveEasyApplySnapshot(page, page.url());
    console.log(
      `[easy-apply] timed out waiting for apply control` +
        (snapPath ? ` — HTML snapshot saved to ${snapPath}` : "")
    );
    return false;
  }

  const result = await page.evaluate(() => {
    // Localized words for "apply" — captured for diagnostic logging only;
    // we don't rely on these for the positive signal anymore.
    const applyRe =
      /apply|başvur|solicit|candidat|postul|bewerb|sollicit|応募|지원/i;

    type Sig = { isEasy: boolean; reason: string; matched: string; href?: string };

    // The primary apply control uses data-view-name="job-apply-button" for
    // BOTH Easy Apply AND "Apply on company website" (external). Disambiguate
    // by looking at the icon inside (linkedin-bug = native, link-external =
    // external) and the href (openSDUIApplyFlow=true = native, /safety/go = external).
    const primary = document.querySelector<HTMLElement>(
      "[data-view-name='job-apply-button']"
    );
    if (primary) {
      const href = (primary.getAttribute("href") || "").toLowerCase();
      const hasLinkedinBug = !!primary.querySelector("svg[id^='linkedin-bug' i]");
      const hasExternalIcon = !!primary.querySelector("svg[id^='link-external' i]");
      const hasSdui = href.includes("opensduiapplyflow=true");
      const hasSafetyGo = href.includes("/safety/go/");
      const matched = (primary.getAttribute("aria-label") || primary.textContent || "").trim().slice(0, 80);

      if (hasLinkedinBug || hasSdui) {
        return {
          isEasy: true,
          reason: hasLinkedinBug ? "data-view-name + linkedin-bug icon" : "data-view-name + openSDUIApplyFlow",
          matched,
          href: primary.getAttribute("href") || "",
        } as Sig;
      }
      if (hasExternalIcon || hasSafetyGo) {
        return {
          isEasy: false,
          reason: hasExternalIcon ? "data-view-name with link-external icon" : "data-view-name with safety/go href",
          matched,
          href: primary.getAttribute("href") || "",
        } as Sig;
      }
      // Ambiguous — neither marker. Lean external (safer to miss-classify
      // an Easy Apply than to attempt Easy-Apply on an external link).
      return {
        isEasy: false,
        reason: "data-view-name but no Easy/External signal",
        matched,
        href: primary.getAttribute("href") || "",
      } as Sig;
    }

    // No data-view-name button found. Try the SDUI-flow URL as a stand-alone
    // signal — that URL pattern is specific to LinkedIn's in-app apply flow
    // and only appears in the apply-button href, never in nav/footer links.
    const sdui = document.querySelector<HTMLAnchorElement>(
      "a[href*='openSDUIApplyFlow=true']"
    );
    if (sdui) {
      return {
        isEasy: true,
        reason: "href has openSDUIApplyFlow=true",
        matched: sdui.textContent?.trim().slice(0, 80) || "",
        href: sdui.href,
      } as Sig;
    }

    // ── Legacy fallback (older LinkedIn UI) ───────────────────────
    const legacy = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button.jobs-apply-button, button[aria-label*='apply' i]"
      )
    );
    for (const b of legacy) {
      const text = (b.textContent || "").trim();
      const aria = (b.getAttribute("aria-label") || "").trim();
      if (/easy\s+apply/i.test(text) || /easy\s+apply/i.test(aria) || b.classList.contains("jobs-apply-button")) {
        return {
          isEasy: true,
          reason: "legacy jobs-apply-button / 'Easy Apply' text",
          matched: aria || text,
        } as Sig;
      }
    }

    // ── No positive signal — collect a few diagnostic labels ──────
    const allCandidates = Array.from(document.querySelectorAll<HTMLElement>("button, a"))
      .filter((el) => {
        const t = (el.textContent || "").trim();
        const a = (el.getAttribute("aria-label") || "").trim();
        return applyRe.test(t) || applyRe.test(a);
      })
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        aria: (el.getAttribute("aria-label") || "").trim(),
        text: (el.textContent || "").trim().slice(0, 60),
      }));
    return {
      isEasy: false,
      reason: allCandidates.length ? "apply-shaped elements but no Easy-Apply signal" : "no apply controls in DOM",
      matched: "",
      seen: allCandidates,
    } as Sig & { seen?: typeof allCandidates };
  });

  console.log(
    `[easy-apply] isEasy=${result.isEasy} reason="${result.reason}"` +
      (result.isEasy ? ` matched="${result.matched}"` : ` seen=${JSON.stringify((result as { seen?: unknown }).seen ?? [])}`)
  );
  return result.isEasy;
}

interface JobCard {
  title: string;
  company: string;
  location: string;
  url: string | null;
}

async function parseJobCard(card: any): Promise<JobCard> {
  async function tryText(...selectors: string[]): Promise<string> {
    for (const sel of selectors) {
      try {
        const el = card.locator(sel);
        if ((await el.count()) > 0) {
          const text = await el.first().innerText();
          return text.trim().split("\n")[0].trim();
        }
      } catch {
        // ignore
      }
    }
    return "";
  }

  async function tryHref(...selectors: string[]): Promise<string | null> {
    for (const sel of selectors) {
      try {
        const el = card.locator(sel);
        if ((await el.count()) > 0) {
          const href = (await el.first().getAttribute("href")) || "";
          if (href.includes("/jobs/view/")) {
            let path = href.split("?")[0];
            if (path.startsWith("/")) path = "https://www.linkedin.com" + path;
            return path;
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  const title = await tryText(
    "h3.base-search-card__title",
    "a.job-card-list__title--link",
    ".job-card-list__title",
    "h3"
  );
  const company = await tryText(
    "h4.base-search-card__subtitle",
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle",
    "h4"
  );
  const location = await tryText(
    ".job-card-container__metadata-item",
    ".job-search-card__location",
    ".artdeco-entity-lockup__caption"
  );
  const url = await tryHref(
    "a.job-card-list__title--link",
    "a.base-card__full-link",
    "a[href*='/jobs/view/']",
    "a"
  );

  return { title, company, location, url };
}

export interface SearchFilters {
  location_text?: string;
  work_types?: string[];
  experience_levels?: string[];
  date_posted?: string;
}

export function buildSearchUrl(
  titles: string[],
  filters: SearchFilters,
  start: number = 0
): string {
  const params = new URLSearchParams();
  params.set("keywords", titles.join(" OR "));
  if (filters.location_text) params.set("location", filters.location_text);
  if (filters.work_types?.length) params.set("f_WT", filters.work_types.join(","));
  if (filters.experience_levels?.length) params.set("f_E", filters.experience_levels.join(","));
  if (filters.date_posted) params.set("f_TPR", filters.date_posted);
  if (start > 0) params.set("start", String(start));
  return `${LINKEDIN_JOBS_URL}?${params.toString()}`;
}

async function getJobDescription(page: Page): Promise<string> {
  const selectors = [
    ".jobs-description__content",
    ".jobs-description-content__text",
    "#job-details",
    ".job-view-layout",
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel);
      if ((await el.count()) > 0) {
        return (await el.first().innerText()).trim();
      }
    } catch {
      // ignore
    }
  }
  return "";
}

export interface ScrapedJob {
  title: string;
  company: string;
  location: string;
  url: string;
  easy_apply: boolean;
  job_description: string;
}

type StopCheck = { isSet(): boolean };
type StatusCallback = (msg: string) => void;
type OnJobCallback = (job: ScrapedJob) => void;

export async function scrapeJobs(
  titles: string[],
  filters: SearchFilters,
  seenUrls: Set<string>,
  stopEvent: StopCheck,
  statusCallback?: StatusCallback,
  onJob?: OnJobCallback
): Promise<ScrapedJob[]> {
  const update = statusCallback || (() => {});
  const results: ScrapedJob[] = [];
  let pageStart = 0;
  const PAGE_SIZE = 25;
  let consecutiveEmpty = 0;

  const context = await getBrowserContext();
  try {
    const page = await context.newPage();

    while (!stopEvent.isSet()) {
      const searchUrl = buildSearchUrl(titles, filters, pageStart);
      const pageNum = Math.floor(pageStart / PAGE_SIZE) + 1;
      update(`Opening LinkedIn page ${pageNum}: ${searchUrl.slice(0, 80)}…`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      // If the session is dead, LinkedIn redirects to its authwall/login page
      // instead of the job results. Bail out loudly so the campaign stops and
      // the user is told to reconnect — rather than silently scraping nothing.
      if (isAuthwallUrl(page.url())) {
        throw new LinkedinAuthError();
      }

      // Fix LinkedIn location duplication: clear auto-resolved location and
      // re-enter the original text, then dismiss the distance filter pill
      if (filters.location_text && pageStart === 0) {
        try {
          // Clear the location input and type the clean value
          const locInput = page.locator("input[aria-label*='city' i], input[aria-label*='location' i], input#jobs-search-box-location-id-ember").first();
          if (await locInput.count()) {
            await locInput.click({ clickCount: 3 });
            await locInput.fill(filters.location_text);
            await page.waitForTimeout(500);
            await page.keyboard.press("Enter");
            await page.waitForTimeout(3000);
          }

          // Dismiss any distance filter pill LinkedIn auto-adds
          const distancePill = page.locator("button[aria-label*='distance' i], button[aria-label*='radius' i]").first();
          if (await distancePill.count()) {
            await distancePill.click();
            await page.waitForTimeout(500);
            // Look for "Cancel" or clear option inside the dropdown
            const clearBtn = page.locator("button:has-text('Cancel'), button:has-text('Clear')").first();
            if (await clearBtn.count()) {
              await clearBtn.click();
              await page.waitForTimeout(1000);
            } else {
              await page.keyboard.press("Escape");
            }
          }
        } catch {
          // Non-fatal — proceed with whatever LinkedIn gave us
        }
      }
      await page.waitForTimeout(1000);

      // Load cards by scrolling
      for (let i = 0; i < 8; i++) {
        if (stopEvent.isSet()) break;
        const countBefore = await page.locator(".job-card-container").count();
        await page.evaluate(() => {
          const card = document.querySelector(".job-card-container");
          if (!card) return;
          let el = card.parentElement;
          while (el) {
            if (el.scrollHeight > el.clientHeight + 50) {
              el.scrollBy(0, 1200);
              return;
            }
            el = el.parentElement;
          }
        });
        await page.waitForTimeout(1500);
        if ((await page.locator(".job-card-container").count()) === countBefore) break;
      }

      // Find cards
      const cardSelectors = [
        ".job-card-container",
        "li.jobs-search-results__list-item",
        ".base-search-card",
        "li.scaffold-layout__list-item",
      ];
      let cards: any[] = [];
      for (const sel of cardSelectors) {
        const found = await page.locator(sel).all();
        if (found.length > 0) {
          cards = found;
          break;
        }
      }

      if (!cards.length) {
        if (pageStart === 0) {
          await page.screenshot({ path: "debug_screenshot.png" });
          update("No job cards found — screenshot saved as debug_screenshot.png");
        } else {
          update(`No more jobs found after page ${pageNum}`);
        }
        break;
      }

      let newOnPage = 0;
      for (let i = 0; i < cards.length; i++) {
        if (stopEvent.isSet()) break;

        let job: JobCard;
        try {
          job = await parseJobCard(cards[i]);
        } catch {
          continue;
        }

        if (!job.url || seenUrls.has(job.url)) continue;

        update(`Reading job ${pageStart + i + 1}: ${job.title || "?"} at ${job.company || "?"}`);

        try {
          await cards[i].scrollIntoViewIfNeeded();
          await cards[i].click();
          await page.waitForTimeout(2000);
        } catch {
          continue;
        }

        const easyApply = await isEasyApply(page);
        const jobDescription = await getJobDescription(page);

        const scrapedJob: ScrapedJob = {
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
          easy_apply: easyApply,
          job_description: jobDescription,
        };

        results.push(scrapedJob);
        seenUrls.add(job.url);
        newOnPage++;

        onJob?.(scrapedJob);

        const delay = 3000 + Math.floor(Math.random() * 2000);
        await page.waitForTimeout(delay);
      }

      if (newOnPage === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) {
          update("No new jobs found on consecutive pages — done");
          break;
        }
      } else {
        consecutiveEmpty = 0;
      }

      pageStart += PAGE_SIZE;
      const pageDelay = 2000 + Math.floor(Math.random() * 2000);
      await page.waitForTimeout(pageDelay);
    }
  } finally {
    await context.close();
  }

  return results;
}
