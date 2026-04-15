import { NextRequest, NextResponse } from "next/server";
import { updateApplication } from "@/lib/db";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const ids = formData.getAll("job_ids") as string[];
  for (const id of ids) {
    updateApplication(Number(id), "discarded");
  }
  return NextResponse.redirect(new URL("/", request.url), 303);
}
