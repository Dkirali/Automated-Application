import { NextRequest, NextResponse } from "next/server";
import { getApplication } from "@/lib/db";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const app = getApplication(Number(id));
  if (!app || !app.resume_path) {
    return new NextResponse("Not found", { status: 404 });
  }

  const docxPath = resolve(app.resume_path);
  const pdfPath = docxPath.replace(/\.docx$/, ".pdf");
  const servePath = existsSync(pdfPath) ? pdfPath : docxPath;

  if (!existsSync(servePath)) {
    return new NextResponse("File not found", { status: 404 });
  }

  const titleSlug = (app.title || "Resume").replace(/ /g, "_");
  const ext = servePath.endsWith(".pdf") ? ".pdf" : ".docx";
  const downloadName = `Doruk_Kirali_${titleSlug}${ext}`;
  const contentType = ext === ".pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const file = readFileSync(servePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
    },
  });
}
