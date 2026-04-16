export function resolveCampaignAction(isRunning: boolean): string {
  return isRunning ? "/api/campaign/stop" : "/api/campaign/start";
}

export function resolveCampaignButtonLabel(isRunning: boolean): string {
  return isRunning ? "■ Stop" : "▶ Start";
}

export function resolveCampaignButtonClass(isRunning: boolean): string {
  return isRunning ? "btn-stop" : "btn-start";
}
