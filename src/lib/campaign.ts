import { Worker } from "worker_threads";
import {
  getConfig,
  getSeenUrls,
  insertApplication,
  insertManual,
  updateApplication,
  updateCampaignStatus,
  getActiveCampaign,
} from "./db";
import { generateFitSummary } from "./resume";
import type { SearchFilters, ScrapedJob } from "./scraper";

// Module-level state — mirrors the Python app's globals
let status = "Idle";
let alert: string | null = null;
let worker: Worker | null = null;
let stopFlag = false;

export function getStatus(): string {
  return status;
}

export function getAlert(): string | null {
  return alert;
}

export function setAlert(msg: string | null): void {
  alert = msg;
}

export function isRunning(): boolean {
  return worker !== null;
}

export function stopCampaign(): void {
  stopFlag = true;
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

export async function runCampaign(
  campaignId: number,
  titles: string[],
  filters: SearchFilters
): Promise<void> {
  stopFlag = false;
  const seenUrls = getSeenUrls();

  const update = (msg: string) => {
    status = msg;
  };

  // Import scraper lazily to avoid loading Playwright at module init
  const { scrapeJobs } = await import("./scraper");

  let totalJobsAdded = 0;

  while (!stopFlag) {
    update(`Scraping LinkedIn for: ${titles.join(", ")}…`);

    let jobsFound = 0;
    const masterPath = getConfig("master_resume_path");

    const onJob = (job: ScrapedJob) => {
      if (!job.easy_apply) {
        insertManual(
          campaignId,
          job.company || "Unknown",
          job.title || "Unknown",
          job.location || "",
          job.url,
          "not_easy_apply"
        );
        return;
      }

      const appId = insertApplication(
        campaignId,
        job.company || "Unknown",
        job.title || "Unknown",
        job.location || "",
        job.url,
        job.job_description || ""
      );
      if (!appId) return; // duplicate

      jobsFound++;
      update(`[${jobsFound} found] ${job.title} at ${job.company} — awaiting manual tailor`);

      // Run fit analysis in background
      if (masterPath && job.job_description) {
        generateFitSummary(job.job_description, masterPath)
          .then((fit) => {
            updateApplication(appId, "pending", {
              fitSummary: fit.raw,
              jdSummary: fit.jdSummary,
            });
          })
          .catch(() => {
            // non-fatal
          });
      }
    };

    const stopCheck = { isSet: () => stopFlag };

    try {
      await scrapeJobs(titles, filters, seenUrls, stopCheck, update, onJob);
    } catch (e) {
      const msg = `Scraper error: ${e}`;
      alert = msg;
      status = msg;
      break;
    }

    totalJobsAdded += jobsFound;

    if (!jobsFound) {
      // Wait 5 minutes before re-scanning
      for (let elapsed = 0; elapsed < 300 && !stopFlag; elapsed += 10) {
        const remaining = 300 - elapsed;
        const timeStr =
          remaining >= 60
            ? `${Math.floor(remaining / 60)}m ${remaining % 60}s`
            : `${remaining}s`;
        update(
          `All pages scraped, ${totalJobsAdded} total jobs found — re-scanning in ${timeStr}`
        );
        await new Promise((r) => setTimeout(r, 10000));
      }
      continue;
    }

    alert = `Added ${jobsFound} job(s) – review them in the dashboard`;

    // Wait 5 minutes before next scan
    for (let elapsed = 0; elapsed < 300 && !stopFlag; elapsed += 10) {
      const remaining = 300 - elapsed;
      const timeStr =
        remaining >= 60
          ? `${Math.floor(remaining / 60)}m ${remaining % 60}s`
          : `${remaining}s`;
      update(
        `Done: ${jobsFound} new, ${totalJobsAdded} total — next scan in ${timeStr}`
      );
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  status = "Idle";
  const campaign = getActiveCampaign();
  if (campaign && campaign.status === "running") {
    updateCampaignStatus(campaignId, "stopped");
  }
}
