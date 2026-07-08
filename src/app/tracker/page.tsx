import { redirect } from "next/navigation";
import { isSetupComplete, getTrackedApplications } from "@/lib/db";
import TrackerClient from "./TrackerClient";

export const dynamic = "force-dynamic";

export default function TrackerPage() {
  if (!isSetupComplete()) {
    redirect("/setup");
  }
  const applications = getTrackedApplications().map((a) => ({
    id: a.id as number,
    title: (a.title as string) ?? "",
    company: (a.company as string) ?? "",
    location: (a.location as string) ?? "",
    stage: (a.stage as string) || "applied",
    notes: (a.notes as string) ?? "",
    ats_score: (a.ats_score as number) ?? 0,
    applied_at: (a.applied_at as string) ?? null,
    interview_prep: (a.interview_prep as string) ?? null,
  }));
  return <TrackerClient initialApps={applications} />;
}
