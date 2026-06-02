import { NextResponse } from "next/server";
import { getApiUsageTotalsToday, getConfig } from "@/lib/db";
import { getRateLimitState, DEFAULT_DAILY_TOKEN_LIMIT } from "@/lib/resume";

const WARN_THRESHOLD = 0.8;

export async function GET() {
  try {
    // Aggregate across all models: fit scoring spends on the fast model while
    // tailoring spends on the flagship, so a single-model gauge would read 0.
    const { tokens, calls } = getApiUsageTotalsToday();
    const dailyLimit =
      Number(getConfig("daily_token_limit")) || DEFAULT_DAILY_TOKEN_LIMIT;
    const pct = dailyLimit > 0 ? tokens / dailyLimit : 0;
    const rl = getRateLimitState();
    return NextResponse.json({
      model: "all",
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
