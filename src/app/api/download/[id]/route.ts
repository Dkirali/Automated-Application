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

  const resumePath = resolve(app.resume_path);
  // Prefer: PDF → DOCX → whatever was saved (txt)
  const dir = resumePath.replace(/[/\\][^/\\]+$/, "");
  const baseName = resumePath.replace(/\.[^.]+$/, "");
  const pdfPath = baseName + ".pdf";
  const docxPath = baseName + ".docx";

  let servePath: string;
  if (existsSync(pdfPath)) servePath = pdfPath;
  else if (existsSync(docxPath)) servePath = docxPath;
  else if (existsSync(resumePath)) servePath = resumePath;
  else return new NextResponse("File not found", { status: 404 });

  const titleSlug = (app.title || "Resume").replace(/ /g, "_");
  const serveExt = servePath.split(".").pop() || "docx";
  const downloadExt = serveExt === "txt" ? ".txt" : serveExt === "pdf" ? ".pdf" : ".docx";
  const downloadName = `Doruk_Kirali_${titleSlug}${downloadExt}`;
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
  };
  const contentType = contentTypes[serveExt] || "application/octet-stream";

  const file = readFileSync(servePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
    },
  });
}
