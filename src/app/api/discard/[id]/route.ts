import { NextRequest, NextResponse } from "next/server";
import { updateApplication } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  updateApplication(Number(id), "discarded");
  return NextResponse.redirect(new URL("/", request.url), 303);
}
