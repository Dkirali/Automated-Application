import { NextRequest, NextResponse } from "next/server";
import { setConfig } from "@/lib/db";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";

const RESUMES_DIR = process.env.JOBBOT_RESUMES_DIR
  ? resolve(process.env.JOBBOT_RESUMES_DIR)
  : resolve(process.cwd(), "resumes");
const ENV_PATH = process.env.JOBBOT_ENV_PATH
  ? resolve(process.env.JOBBOT_ENV_PATH)
  : resolve(process.cwd(), ".env");
const ALLOWED_EXTENSIONS = new Set([".docx", ".doc", ".pdf"]);

const PROVIDER_ENV: Record<"groq" | "anthropic" | "openrouter", string> = {
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim() || "";
  const email = (formData.get("email") as string)?.trim() || "";
  const phone = (formData.get("phone") as string)?.trim() || "";
  const apiKey = (formData.get("api_key") as string)?.trim() || "";
  const groqKey = (formData.get("groq_key") as string)?.trim() || "";
  const openrouterKey = (formData.get("openrouter_key") as string)?.trim() || "";
  const activeProviderRaw = (formData.get("active_provider") as string)?.trim() || "";
  const resumeFile = formData.get("resume") as File | null;

  if (!name || !email || !phone) {
    return NextResponse.redirect(new URL("/settings?error=Name+email+and+phone+are+required", request.url), 303);
  }

  setConfig("name", name);
  setConfig("email", email);
  setConfig("phone", phone);

  const dailyTokenLimitRaw = (formData.get("daily_token_limit") as string)?.trim() || "";
  if (dailyTokenLimitRaw) {
    const n = parseInt(dailyTokenLimitRaw, 10);
    if (Number.isFinite(n) && n > 0) setConfig("daily_token_limit", String(n));
  }

  // Update API keys in .env
  if (apiKey || groqKey || openrouterKey) {
    let envContent = "";
    if (existsSync(ENV_PATH)) {
      envContent = readFileSync(ENV_PATH, "utf-8");
    }
    const lines = envContent.split("\n");
    const envMap = new Map<string, string>();
    for (const line of lines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) envMap.set(line.slice(0, eqIdx), line.slice(eqIdx + 1));
    }
    if (apiKey) { envMap.set("ANTHROPIC_API_KEY", apiKey); process.env.ANTHROPIC_API_KEY = apiKey; }
    if (groqKey) { envMap.set("GROQ_API_KEY", groqKey); process.env.GROQ_API_KEY = groqKey; }
    if (openrouterKey) { envMap.set("OPENROUTER_API_KEY", openrouterKey); process.env.OPENROUTER_API_KEY = openrouterKey; }
    writeFileSync(ENV_PATH, Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  }

  // Update active provider — only commit if a key for that provider exists
  // (either newly submitted or already in env), so we never point the app at
  // a provider with no credentials.
  if (activeProviderRaw === "groq" || activeProviderRaw === "anthropic" || activeProviderRaw === "openrouter") {
    const envVar = PROVIDER_ENV[activeProviderRaw];
    if (process.env[envVar]) {
      setConfig("active_provider", activeProviderRaw);
    } else {
      return NextResponse.redirect(
        new URL(
          `/settings?error=Cannot+switch+to+${activeProviderRaw}+without+a+key`,
          request.url
        ),
        303
      );
    }
  }

  // Handle resume upload
  if (resumeFile && resumeFile.name) {
    const ext = extname(resumeFile.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.redirect(new URL(`/settings?error=Unsupported+file+type+${ext}`, request.url), 303);
    }
    mkdirSync(RESUMES_DIR, { recursive: true });
    const destPath = resolve(RESUMES_DIR, `master${ext}`);
    const buffer = Buffer.from(await resumeFile.arrayBuffer());
    writeFileSync(destPath, buffer);
    setConfig("master_resume_path", destPath);
  }

  return NextResponse.redirect(new URL("/settings?success=Settings+saved", request.url), 303);
}
