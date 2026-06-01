import { NextRequest, NextResponse } from "next/server";
import { setConfig } from "@/lib/db";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";

// Paths are overridable so e2e tests can redirect writes into a sandbox
// instead of clobbering the developer's real .env and master resume.
const RESUMES_DIR = process.env.JOBBOT_RESUMES_DIR
  ? resolve(process.env.JOBBOT_RESUMES_DIR)
  : resolve(process.cwd(), "resumes");
const ENV_PATH = process.env.JOBBOT_ENV_PATH
  ? resolve(process.env.JOBBOT_ENV_PATH)
  : resolve(process.cwd(), ".env");
const ALLOWED_EXTENSIONS = new Set([".docx", ".doc", ".pdf"]);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim() || "";
  const email = (formData.get("email") as string)?.trim() || "";
  const phone = (formData.get("phone") as string)?.trim() || "";
  const apiKey = (formData.get("api_key") as string)?.trim() || "";
  const groqKey = (formData.get("groq_key") as string)?.trim() || "";
  const openrouterKey = (formData.get("openrouter_key") as string)?.trim() || "";
  const resumeFile = formData.get("resume") as File | null;

  const hasAtLeastOneKey = apiKey || groqKey || openrouterKey;

  if (!name || !email || !phone || !hasAtLeastOneKey || !resumeFile) {
    return NextResponse.redirect(new URL("/setup?error=Name,+email,+phone,+at+least+one+API+key,+and+resume+are+required", request.url), 303);
  }

  const ext = extname(resumeFile.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.redirect(new URL(`/setup?error=Unsupported+file+type+${ext}`, request.url), 303);
  }

  mkdirSync(RESUMES_DIR, { recursive: true });
  const destPath = resolve(RESUMES_DIR, `master${ext}`);
  const buffer = Buffer.from(await resumeFile.arrayBuffer());
  writeFileSync(destPath, buffer);

  setConfig("name", name);
  setConfig("email", email);
  setConfig("phone", phone);
  setConfig("master_resume_path", destPath);

  // Record which provider this setup chose — the runtime uses exactly one.
  let activeProvider: "anthropic" | "groq" | "openrouter" | null = null;
  if (groqKey) activeProvider = "groq";
  else if (apiKey) activeProvider = "anthropic";
  else if (openrouterKey) activeProvider = "openrouter";
  if (activeProvider) setConfig("active_provider", activeProvider);

  // Write API key to .env (only one is submitted by the setup form)
  let envContent = "";
  if (existsSync(ENV_PATH)) {
    envContent = readFileSync(ENV_PATH, "utf-8");
  }
  const envMap = new Map<string, string>();
  for (const line of envContent.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) envMap.set(line.slice(0, eqIdx), line.slice(eqIdx + 1));
  }
  if (apiKey) { envMap.set("ANTHROPIC_API_KEY", apiKey); process.env.ANTHROPIC_API_KEY = apiKey; }
  if (groqKey) { envMap.set("GROQ_API_KEY", groqKey); process.env.GROQ_API_KEY = groqKey; }
  if (openrouterKey) { envMap.set("OPENROUTER_API_KEY", openrouterKey); process.env.OPENROUTER_API_KEY = openrouterKey; }
  writeFileSync(ENV_PATH, Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

  return NextResponse.redirect(new URL("/setup/linkedin", request.url), 303);
}
