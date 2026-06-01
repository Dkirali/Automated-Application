import { NextRequest, NextResponse } from "next/server";
import { getActiveCampaign, updateCampaignStatus } from "@/lib/db";
import { stopCampaign, setAlert } from "@/lib/campaign";

export async function POST(request: NextRequest) {
  stopCampaign();
  const campaign = getActiveCampaign();
  if (campaign) {
    updateCampaignStatus(campaign.id, "stopped", "user_stopped");
  }
  setAlert(null);

  // Stopping the campaign should NOT leave half-analyzed jobs stuck on
  // "Analyzing fit". Kick off retry-fit so the in-flight + failed jobs
  // settle to a final score. Fire-and-forget — the response shouldn't wait.
  const retryUrl = new URL("/api/retry-fit", request.url);
  fetch(retryUrl, { method: "POST" }).catch(() => {});

  return NextResponse.redirect(new URL("/", request.url), 303);
}
