import { getApplication, getConfig, getConn, updateApplication } from "./db";
import { tailorResume } from "./resume";

// Reset a job into the `tailoring` state and run tailoring in the background.
// Shared by /api/retailor/[id] and /api/bulk-retailor so both behave identically.
// Returns false if the job doesn't exist.
//
// Tailoring is fire-and-forget; the per-model TPM lock in resume.ts paces
// concurrent kickoffs. Any failure (including a missing master resume or empty
// job description) marks the job `failed` so the UI surfaces an error instead of
// spinning forever.
export function startTailoring(appId: number): boolean {
  const job = getApplication(appId);
  if (!job) return false;

  // Preserve existing keywords for ATS score stability.
  const storedKeywords = (job.keywords || "")
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean);

  updateApplication(appId, "tailoring");
  getConn()
    .prepare(
      "UPDATE applications SET resume_path=NULL, ats_score=NULL, original_ats_score=NULL, model_used=NULL WHERE id=?"
    )
    .run(appId);

  (async () => {
    const masterPath = getConfig("master_resume_path");
    const jd = job.job_description || "";
    if (!masterPath || !jd) {
      updateApplication(appId, "failed");
      return;
    }
    try {
      const tailor = await tailorResume(
        appId,
        jd,
        masterPath,
        storedKeywords.length ? storedKeywords : undefined
      );
      updateApplication(appId, "reviewed", {
        atsScore: tailor.atsScore,
        originalAtsScore: tailor.originalAtsScore,
        keywords: tailor.keywordsStr,
        resumePath: tailor.docxPath,
        modelUsed: tailor.modelUsed,
      });
    } catch (err) {
      console.error(`[tailor] Tailoring failed for job ${appId}:`, err);
      updateApplication(appId, "failed");
    }
  })();

  return true;
}
