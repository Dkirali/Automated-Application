import { getConfig } from "@/lib/db";
import { getActiveProvider, PROVIDER_MODELS, type ActiveProvider } from "@/lib/resume";
import { isLinkedinConnected } from "@/lib/linkedin";
import { maskKey } from "@/lib/setup-helpers";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const resumePath = getConfig("master_resume_path");

  const providers = ["groq", "anthropic", "openrouter"] as const;
  const maskedKeys: Record<ActiveProvider, string | null> = {
    groq: null,
    anthropic: null,
    openrouter: null,
  };
  for (const p of providers) {
    const raw = process.env[PROVIDER_MODELS[p].envKey];
    maskedKeys[p] = raw ? maskKey(raw) : null;
  }

  return (
    <SettingsClient
      name={getConfig("name") || ""}
      email={getConfig("email") || ""}
      phone={getConfig("phone") || ""}
      linkedin={getConfig("linkedin") || ""}
      github={getConfig("github") || ""}
      activeProvider={getActiveProvider()}
      configuredKeys={maskedKeys}
      currentResume={resumePath ? resumePath.split("/").pop() || null : null}
      linkedinConnected={isLinkedinConnected()}
      dailyTokenLimit={getConfig("daily_token_limit") || ""}
    />
  );
}
