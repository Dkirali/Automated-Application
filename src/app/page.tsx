import { redirect } from "next/navigation";
import {
  isSetupComplete,
  getActiveCampaign,
  getAllApplications,
  getPendingJobs,
  getAllCampaigns,
  getConfig,
} from "@/lib/db";
import { AVAILABLE_MODELS, getLastModelUsed, parseFitScore, parseFitField } from "@/lib/resume";
import { getAlert } from "@/lib/campaign";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }

  const campaign = getActiveCampaign();
  const applications = getAllApplications();
  const pending = getPendingJobs();
  const campaigns = getAllCampaigns();

  const stats = {
    applied: applications.filter((a) => a.status === "applied").length,
    manual: pending.filter((p) => !p.easy_apply).length,
    status: campaign?.status || "idle",
  };

  const resumePath = getConfig("master_resume_path");
  const resumeName = resumePath ? resumePath.split("/").pop() : null;

  const linkedinConnected = existsSync(
    join(homedir(), ".jobbot-chrome", "Default", "Cookies")
  );

  // Parse fit data for pending jobs
  const pendingWithFit = pending.map((job) => {
    const raw = job.fit_summary || "";
    return {
      ...job,
      fit_score: parseFitScore(raw),
      verdict: parseFitField(raw, "VERDICT"),
      fit_strengths: parseFitField(raw, "STRENGTHS")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
      fit_gaps: parseFitField(raw, "GAPS")
        .split(",")
        .map((g: string) => g.trim())
        .filter(Boolean),
    };
  });

  // Determine configured models
  const configuredModels = new Set<string>();
  if (process.env.GROQ_API_KEY) configuredModels.add("groq/llama-3.3-70b");
  if (process.env.OPENROUTER_API_KEY) {
    configuredModels.add("openrouter/gpt-oss-120b");
    configuredModels.add("openrouter/minimax-m2.5");
    configuredModels.add("openrouter/free");
  }
  if (process.env.ANTHROPIC_API_KEY) configuredModels.add("anthropic/claude-sonnet");

  return (
    <DashboardClient
      stats={stats}
      linkedinConnected={linkedinConnected}
      resumeName={resumeName}
      activeModel={getLastModelUsed()}
      pendingJobs={pendingWithFit}
      applications={applications}
      campaigns={campaigns}
      alert={getAlert()}
      availableModels={AVAILABLE_MODELS}
      configuredModels={Array.from(configuredModels)}
    />
  );
}
