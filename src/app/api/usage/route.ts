import { NextResponse } from "next/server";
import { getApiUsageToday, getConfig } from "@/lib/db";
import { getActiveModel, getRateLimitState, DEFAULT_DAILY_TOKEN_LIMIT } from "@/lib/resume";

const WARN_THRESHOLD = 0.8;

export async function GET() {
  try {
    const model = getActiveModel();
    const key = model?.usageKey ?? "";
    const usage = getApiUsageToday();
    const tokens = usage.tokensByModel[key] ?? 0;
    const calls = usage.counts[key] ?? 0;
    const dailyLimit =
      Number(getConfig("daily_token_limit")) || DEFAULT_DAILY_TOKEN_LIMIT;
    const pct = dailyLimit > 0 ? tokens / dailyLimit : 0;
    const rl = getRateLimitState();
    return NextResponse.json({
      model: key,
      tokens,
      calls,
      dailyLimit,
      pct,
      warn: pct >= WARN_THRESHOLD,
      rateLimited: rl.rateLimited,
      retryAt: rl.retryAt,
    });
  } catch {
    return NextResponse.json({
      model: "",
      tokens: 0,
      calls: 0,
      dailyLimit: DEFAULT_DAILY_TOKEN_LIMIT,
      pct: 0,
      warn: false,
      rateLimited: false,
      retryAt: 0,
    });
  }
}
