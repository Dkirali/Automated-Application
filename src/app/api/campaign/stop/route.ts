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
  return NextResponse.redirect(new URL("/", request.url), 303);
}
