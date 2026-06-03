import { redirect } from "next/navigation";
import {
  isSetupComplete,
  getActiveCampaign,
  getAllApplications,
  getPendingJobs,
  getAllCampaigns,
  getConfig,
} from "@/lib/db";
import { parseFitScore, parseFitField } from "@/lib/resume";
import { getAlert } from "@/lib/campaign";
import { isLinkedinConnected } from "@/lib/linkedin";
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
    easy: pending.filter((p) => p.easy_apply).length,
    status: campaign?.status || "idle",
  };

  const resumePath = getConfig("master_resume_path");
  const resumeName = resumePath ? resumePath.split("/").pop() : null;

  const linkedinConnected = isLinkedinConnected();

  // Parse fit data for pending jobs.
  // Prefer the deterministic fit_score column; fall back to parsing legacy
  // fit_summary text for rows scored before the v2 pipeline existed.
  const pendingWithFit = pending.map((job) => {
    const raw = job.fit_summary || "";
    const storedFit = typeof job.fit_score === "number" ? job.fit_score : null;
    return {
      ...job,
      fit_score: storedFit ?? parseFitScore(raw),
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

  return (
    <DashboardClient
      stats={stats}
      linkedinConnected={linkedinConnected}
      resumeName={resumeName}
      pendingJobs={pendingWithFit}
      applications={applications}
      campaigns={campaigns}
      alert={getAlert()}
    />
  );
}
