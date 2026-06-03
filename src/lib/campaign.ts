import { Worker } from "worker_threads";
import {
  getConfig,
  getSeenUrls,
  insertApplication,
  updateApplication,
  updateCampaignStatus,
  getActiveCampaign,
} from "./db";
import { analyzeFitBatch, analyzeFit } from "./resume";
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

    // Buffer scraped jobs and score them in batches: the resume + instructions
    // are sent ONCE per batch instead of once-per-job, so far more jobs fit
    // inside Groq's fixed per-minute / daily token budget. Flushed fire-and-forget.
    // Batch kept small (3) so several long PM job descriptions still fit inside
    // one output-token budget — a larger batch risks the model dropping the
    // last object(s), which would leave those jobs stuck "Analyzing fit…".
    const FIT_BATCH_SIZE = 3;
    // Time-bound the tail: a partial batch (< FIT_BATCH_SIZE) must not sit
    // "Analyzing fit…" until the whole scrape pass ends. Flush it after this
    // long if it hasn't filled up, so leftover jobs score within seconds.
    const FIT_FLUSH_MS = 15_000;
    let fitBuffer: { appId: number; jobDescription: string }[] = [];
    let fitTimer: ReturnType<typeof setTimeout> | null = null;

    const persistFit = (
      appId: number,
      { scores, rationale }: Awaited<ReturnType<typeof analyzeFit>>
    ) => {
      updateApplication(appId, "pending", {
        fitScore: scores.fitScore,
        keywordScore: scores.keywordScore,
        hardreqScore: scores.hardreqScore,
        parseabilityScore: scores.parseabilityScore,
        requirementsJson: JSON.stringify(scores.requirements),
        fitSummary: rationale.raw,
        jdSummary: rationale.jdSummary,
      });
    };

    const flushFitBatch = () => {
      if (fitTimer) {
        clearTimeout(fitTimer);
        fitTimer = null;
      }
      if (!masterPath || fitBuffer.length === 0) return;
      const batch = fitBuffer;
      fitBuffer = [];
      analyzeFitBatch(
        batch.map((b) => ({ jobDescription: b.jobDescription })),
        masterPath
      )
        .then((results) => {
          results.forEach((res, i) => {
            if (res) {
              persistFit(batch[i].appId, res);
            } else {
              // The model omitted this job from the batch response. Rescue it
              // NOW with a single-job call rather than leaving it stuck until
              // the slower retry-fit pass.
              analyzeFit(batch[i].jobDescription, masterPath)
                .then((single) => persistFit(batch[i].appId, single))
                .catch(() => {
                  // still unscored — retry-fit remains the final backstop
                });
            }
          });
        })
        .catch(() => {
          // whole-batch failure (e.g. rate limit) — retry-fit will pick them up
        });
    };

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

      if (masterPath && job.job_description) {
        fitBuffer.push({ appId, jobDescription: job.job_description });
        if (fitBuffer.length >= FIT_BATCH_SIZE) {
          flushFitBatch();
        } else if (!fitTimer) {
          // Arm a flush so a partial batch doesn't wait for the scrape to end.
          fitTimer = setTimeout(flushFitBatch, FIT_FLUSH_MS);
        }
      }
    };

    const stopCheck = { isSet: () => stopFlag };

    try {
      await scrapeJobs(titles, filters, seenUrls, stopCheck, update, onJob);
      // Score whatever didn't fill a full batch this scrape pass.
      flushFitBatch();
    } catch (e) {
      // Flush buffered jobs before bailing so a mid-scrape error doesn't drop them.
      flushFitBatch();
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
