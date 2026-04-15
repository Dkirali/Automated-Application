import { NextResponse } from "next/server";
import { getApiUsageToday } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getApiUsageToday());
}
