import { NextRequest, NextResponse } from "next/server";
import { startTailoring } from "@/lib/tailor";

// Kick off tailoring for a user-selected set of jobs. Mirrors /api/bulk-discard.
// Each job moves to `tailoring`; the per-model TPM lock paces the LLM calls.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const ids = formData.getAll("job_ids") as string[];
  let started = 0;
  for (const id of ids) {
    if (startTailoring(Number(id))) started++;
  }
  return NextResponse.json({ ok: true, started });
}
