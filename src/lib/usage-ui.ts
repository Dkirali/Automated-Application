export type GaugeLevel = "ok" | "warn" | "blocked";

export function gaugeLevel(pct: number, rateLimited: boolean): GaugeLevel {
  if (rateLimited) return "blocked";
  if (pct >= 0.8) return "warn";
  return "ok";
}
