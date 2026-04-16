import { describe, it, expect } from "vitest";
import {
  resolveCampaignAction,
  resolveCampaignButtonLabel,
  resolveCampaignButtonClass,
} from "@/lib/campaign-ui";

describe("resolveCampaignAction", () => {
  it("returns /api/campaign/stop when running", () => {
    expect(resolveCampaignAction(true)).toBe("/api/campaign/stop");
  });
  it("returns /api/campaign/start when idle", () => {
    expect(resolveCampaignAction(false)).toBe("/api/campaign/start");
  });
});

describe("resolveCampaignButtonLabel", () => {
  it("says Stop when running", () => {
    expect(resolveCampaignButtonLabel(true)).toBe("■ Stop");
  });
  it("says Start when idle", () => {
    expect(resolveCampaignButtonLabel(false)).toBe("▶ Start");
  });
});

describe("resolveCampaignButtonClass", () => {
  it("is btn-stop when running", () => {
    expect(resolveCampaignButtonClass(true)).toBe("btn-stop");
  });
  it("is btn-start when idle", () => {
    expect(resolveCampaignButtonClass(false)).toBe("btn-start");
  });
});
