import { NextRequest, NextResponse } from "next/server";
import { getActiveCampaign, createCampaign } from "@/lib/db";
import { runCampaign, setAlert } from "@/lib/campaign";

export async function POST(request: NextRequest) {
  if (getActiveCampaign()) {
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const formData = await request.formData();
  const titlesRaw = (formData.get("titles") as string)?.trim() || "";
  const locationText = (formData.get("location_text") as string)?.trim() || "";
  const workTypes = formData.getAll("work_type") as string[];
  const experienceLevels = formData.getAll("exp_level") as string[];
  const datePosted = (formData.get("date_posted") as string) || "";
  const preferredModel = (formData.get("preferred_model") as string) || "auto";

  const titles = titlesRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!titles.length) {
    setAlert("Please provide at least one job title.");
    return NextResponse.redirect(new URL("/", request.url), 303);
  }

  const filters = {
    location_text: locationText,
    work_types: workTypes,
    experience_levels: experienceLevels,
    date_posted: datePosted,
  };

  const campaignId = createCampaign({
    name: titlesRaw,
    titles: titlesRaw,
    locations: locationText,
    preferredModel,
  });

  setAlert(null);
  // Run campaign in background (not awaited)
  runCampaign(campaignId, titles, filters).catch(() => {});

  return NextResponse.redirect(new URL("/", request.url), 303);
}
