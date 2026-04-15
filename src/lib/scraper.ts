import { chromium, type BrowserContext, type Page } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

const JOBBOT_PROFILE = join(homedir(), ".jobbot-chrome");
const LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/search/";

export function getProfilePath(): string {
  return JOBBOT_PROFILE;
}

export async function getBrowserContext(): Promise<BrowserContext> {
  mkdirSync(JOBBOT_PROFILE, { recursive: true });
  return chromium.launchPersistentContext(JOBBOT_PROFILE, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function isEasyApply(page: Page): Promise<boolean> {
  const selectors = [
    "button.jobs-apply-button:has-text('Easy Apply')",
    "button:has-text('Easy Apply')",
    "[data-job-id] button:has-text('Easy Apply')",
  ];
  for (const sel of selectors) {
    try {
      if ((await page.locator(sel).count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
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
      await page.waitForTimeout(4000);

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
