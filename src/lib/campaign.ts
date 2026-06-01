import { Worker } from "worker_threads";
import {
  getConfig,
  getSeenUrls,
  insertApplication,
  updateApplication,
  updateCampaignStatus,
  getActiveCampaign,
} from "./db";
import { analyzeFit } from "./resume";
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
  const { scrapeJobs, LinkedinAuthError } = await import("./scraper");

  let totalJobsAdded = 0;

  while (!stopFlag) {
    update(`Scraping LinkedIn for: ${titles.join(", ")}…`);

    let jobsFound = 0;
    const masterPath = getConfig("master_resume_path");

    const onJob = (job: ScrapedJob) => {
      const appId = insertApplication({
        campaignId,
        company: job.company || "Unknown",
        title: job.title || "Unknown",
        location: job.location || "",
        url: job.url,
        jobDescription: job.job_description || "",
        easyApply: job.easy_apply,
      });
      if (!appId) return; // duplicate

      jobsFound++;
      const applyTag = job.easy_apply ? "easy" : "manual";
      update(`[${jobsFound} found] ${job.title} at ${job.company} (${applyTag}) — awaiting tailor`);

      // Single-call fit analysis — scores + rationale in one LLM round trip
      // (half the per-job calls). If it fails, the job stays unscored and
      // retry-fit picks it up later with its resumable two-stage path.
      if (masterPath && job.job_description) {
        analyzeFit(job.job_description, masterPath)
          .then(({ scores, rationale }) => {
            updateApplication(appId, "pending", {
              fitScore: scores.fitScore,
              keywordScore: scores.keywordScore,
              hardreqScore: scores.hardreqScore,
              parseabilityScore: scores.parseabilityScore,
              requirementsJson: JSON.stringify(scores.requirements),
              fitSummary: rationale.raw,
              jdSummary: rationale.jdSummary,
            });
          })
          .catch(() => {
            // non-fatal — job stays unscored, retry-fit will pick it up
          });
      }
    };

    const stopCheck = { isSet: () => stopFlag };

    try {
      await scrapeJobs(titles, filters, seenUrls, stopCheck, update, onJob);
    } catch (e) {
      if (e instanceof LinkedinAuthError) {
        const msg =
          "⚠ LinkedIn session expired — reconnect LinkedIn in Settings, then restart the campaign.";
        alert = msg;
        status = msg;
      } else {
        const msg = `Scraper error: ${e}`;
        alert = msg;
        status = msg;
      }
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
