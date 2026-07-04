"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COUNTRIES,
  PROVIDERS,
  detectProvider,
  formatPhone,
  parsePhone,
  type ProviderInfo,
} from "@/lib/setup-helpers";
import type { ActiveProvider } from "@/lib/resume";
import {
  Button,
  Card,
  Field,
  SectionTitle,
  SelectField,
  TopNav,
} from "@/components/ui";
import { cn } from "@/lib/cn";

const FALLBACK_COUNTRY_CODE = "US";

interface SettingsClientProps {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  activeProvider: ActiveProvider | null;
  configuredKeys: Record<ActiveProvider, string | null>;
  currentResume: string | null;
  linkedinConnected: boolean;
  dailyTokenLimit: string;
}

export default function SettingsClient({
  name,
  email,
  phone,
  linkedin,
  github,
  activeProvider,
  configuredKeys,
  currentResume,
  linkedinConnected: initialLinkedin,
  dailyTokenLimit,
}: SettingsClientProps) {
  const [linkedinConnected, setLinkedinConnected] = useState(initialLinkedin);
  const [linkedinBusy, setLinkedinBusy] = useState<"connecting" | "disconnecting" | null>(null);
  const linkedinPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (linkedinPollRef.current) clearInterval(linkedinPollRef.current);
    };
  }, []);

  const connectLinkedin = async () => {
    setLinkedinBusy("connecting");
    try {
      await fetch("/api/linkedin-connect", { method: "POST" });
    } catch {
      // keep waiting state; user can retry
    }
    if (linkedinPollRef.current) clearInterval(linkedinPollRef.current);
    linkedinPollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/linkedin-status");
        const data = await r.json();
        if (data.connected) {
          setLinkedinConnected(true);
          setLinkedinBusy(null);
          if (linkedinPollRef.current) clearInterval(linkedinPollRef.current);
        }
      } catch {
        // transient
      }
    }, 2000);
  };

  const disconnectLinkedin = async () => {
    if (!confirm("Disconnect LinkedIn? You'll need to log in again to start a campaign.")) return;
    setLinkedinBusy("disconnecting");
    try {
      await fetch("/api/linkedin-disconnect", { method: "POST" });
      setLinkedinConnected(false);
    } finally {
      setLinkedinBusy(null);
    }
  };
  const parsed = parsePhone(phone);
  const [countryCode, setCountryCode] = useState<string>(
    parsed?.countryCode ?? FALLBACK_COUNTRY_CODE
  );
  const [phoneNumber, setPhoneNumber] = useState<string>(parsed?.number ?? "");

  const initialProviderId: ProviderInfo["id"] = activeProvider ?? PROVIDERS[0].id;
  const [providerId, setProviderId] =
    useState<ProviderInfo["id"]>(initialProviderId);
  const [apiKey, setApiKey] = useState<string>("");

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0];
  const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];

  const phoneSubmitValue = useMemo(() => {
    try {
      return formatPhone(country.dialCode, phoneNumber);
    } catch {
      return "";
    }
  }, [country.dialCode, phoneNumber]);

  const detectedProvider = detectProvider(apiKey);
  const providerMismatch =
    apiKey.trim().length > 0 &&
    detectedProvider !== "unknown" &&
    detectedProvider !== provider.id;

  const fileSizeLabel = fileSize !== null ? formatBytes(fileSize) : null;
  const providerChanged = providerId !== activeProvider;
  const existingMaskedKey = configuredKeys[providerId];

  return (
    <div className="min-h-screen bg-cream pb-16">
      <TopNav backLabel="Back to dashboard" />

      <main className="mx-auto max-w-[760px] px-6 py-9 md:px-10">
        <h1 className="font-serif text-[28px] font-semibold text-ink">Settings</h1>
        <p className="mb-6 mt-1 text-[14px] text-muted">
          Update your profile, swap providers, or upload a new master resume.
        </p>

        {/* Connections (LinkedIn) — async, lives outside the settings form */}
        <Card className="mb-[18px]">
          <SectionTitle as="label" className="mb-4">
            Connections
          </SectionTitle>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold",
                linkedinConnected ? "bg-badge-green text-green" : "bg-input text-muted",
              )}
              aria-live="polite"
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  linkedinConnected ? "bg-green-strong" : "bg-faint",
                )}
              />
              <span>
                {linkedinConnected
                  ? "LinkedIn connected"
                  : linkedinBusy === "connecting"
                    ? "Log in in the Chrome window, then close it…"
                    : "LinkedIn not connected"}
              </span>
            </span>
            {linkedinConnected ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={disconnectLinkedin}
                disabled={linkedinBusy !== null}
              >
                {linkedinBusy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={connectLinkedin}
                disabled={linkedinBusy !== null}
              >
                {linkedinBusy === "connecting" ? "Waiting for login…" : "Connect"}
              </Button>
            )}
          </div>
        </Card>

        <form method="POST" action="/api/settings" encType="multipart/form-data">
          {/* Profile */}
          <Card className="mb-[18px]">
            <SectionTitle as="label" className="mb-4">
              Profile
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="name" name="name" label="Full name" defaultValue={name} required />
              <Field id="email" name="email" type="email" label="Email" defaultValue={email} required />
            </div>

            <div className="mt-4 flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-ink">Phone</span>
              <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-2">
                <SelectField
                  aria-label="Country dial code"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.dialCode} · {c.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  type="tel"
                  id="phone-number"
                  inputMode="numeric"
                  placeholder="555 000 0000"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                />
              </div>
              <input type="hidden" name="phone" value={phoneSubmitValue} />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                id="linkedin"
                name="linkedin"
                label={
                  <>
                    LinkedIn{" "}
                    <span className="font-normal text-muted">(optional)</span>
                  </>
                }
                defaultValue={linkedin}
                placeholder="linkedin.com/in/your-handle"
              />
              <Field
                id="github"
                name="github"
                label={
                  <>
                    GitHub{" "}
                    <span className="font-normal text-muted">(optional)</span>
                  </>
                }
                defaultValue={github}
                placeholder="github.com/your-handle"
              />
            </div>
          </Card>

          {/* AI provider */}
          <Card className="mb-[18px]">
            <SectionTitle as="label" className="mb-4">
              AI provider &amp; key
            </SectionTitle>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-ink">
                API key{" "}
                <span className="font-normal text-muted">
                  (leave blank to keep current)
                </span>
              </span>
              <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-2">
                <SelectField
                  name="active_provider"
                  aria-label="API provider"
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value as ProviderInfo["id"])}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  type="password"
                  id="api-key"
                  placeholder={existingMaskedKey ? "Paste a new key to replace" : provider.placeholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <input type="hidden" name={provider.fieldName} value={apiKey} />
              <p className="text-[11.5px] text-muted">
                {existingMaskedKey ? (
                  <>
                    Configured:{" "}
                    <code className="rounded bg-input px-1 py-0.5 text-[11px] text-ink">
                      {existingMaskedKey}
                    </code>
                    {" · leave blank to keep, paste a new key to replace"}
                  </>
                ) : (
                  <>No {provider.name} key on file. Paste one to enable this provider.</>
                )}
              </p>
              {providerChanged && (
                <p className="text-[11.5px] text-accent-strong">
                  Switching active provider from{" "}
                  <strong>{activeProvider ?? "none"}</strong> to{" "}
                  <strong>{provider.id}</strong>. Make sure a {provider.id} key is set.
                </p>
              )}
              {providerMismatch && (
                <p className="text-[11.5px] text-accent-strong">
                  This key prefix looks like a <strong>{detectedProvider}</strong> key
                  — but you selected <strong>{provider.name}</strong>. Switch the
                  provider or check the key.
                </p>
              )}
            </div>

            <div className="mt-4 max-w-xs">
              <Field
                type="number"
                id="daily-token-limit"
                name="daily_token_limit"
                label="Daily token limit"
                min={1}
                defaultValue={dailyTokenLimit || "100000"}
                hint="Groq's free tier is ~100,000 tokens/day. The dashboard gauge and auto-stop use this number."
              />
            </div>
          </Card>

          {/* Master resume */}
          <Card className="mb-[18px]">
            <SectionTitle as="label" className="mb-4">
              Master resume
            </SectionTitle>
            {currentResume && !fileName && (
              <div className="mb-3 flex items-center gap-3 rounded-xl bg-input p-3">
                <span
                  aria-hidden
                  className="grid h-9 w-9 place-items-center rounded-lg bg-badge-orange text-[17px]"
                >
                  📄
                </span>
                <span className="truncate text-[14px] font-bold text-ink">
                  {currentResume}
                </span>
              </div>
            )}
            <label
              className={
                fileName
                  ? "relative flex cursor-pointer flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-green-strong bg-badge-green p-[18px] text-center"
                  : "relative flex cursor-pointer flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-dashed border-line bg-input p-[18px] text-center hover:border-accent"
              }
            >
              <input
                type="file"
                name="resume"
                accept=".docx,.doc,.pdf"
                id="resume-input"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setFileName(file?.name ?? null);
                  setFileSize(file?.size ?? null);
                }}
              />
              {fileName ? (
                <>
                  <span
                    aria-hidden
                    className="grid h-9 w-9 place-items-center rounded-full bg-green-strong text-[19px] font-extrabold text-white"
                  >
                    ✓
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-green">
                    Uploaded
                  </span>
                  <span className="text-[13.5px] font-bold text-ink">{fileName}</span>
                  <span className="text-[11.5px] text-muted">
                    {fileSizeLabel ? `${fileSizeLabel} · ` : ""}Click to change
                  </span>
                </>
              ) : (
                <>
                  <span aria-hidden className="text-[22px]">
                    📤
                  </span>
                  <span className="text-[13.5px] font-bold text-ink">
                    Upload a new resume to replace
                  </span>
                  <span className="text-[11.5px] text-muted">
                    .docx, .doc, or .pdf accepted
                  </span>
                </>
              )}
            </label>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" variant="ink" className="px-7 py-3">
              Save changes
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
