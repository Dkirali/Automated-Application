"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  COUNTRIES,
  PROVIDERS,
  detectProvider,
  formatPhone,
  parsePhone,
  type ProviderInfo,
} from "@/lib/setup-helpers";
import type { ActiveProvider } from "@/lib/resume";

const FALLBACK_COUNTRY_CODE = "US";

interface SettingsClientProps {
  name: string;
  email: string;
  phone: string;
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
    <div className="page-center">
      <div className="form-card">
        <div className="form-card-toprow">
          <span className="form-card-logo">JobBot</span>
          <Link href="/" className="back-link">← Dashboard</Link>
        </div>

        <h2>Settings</h2>
        <p className="form-card-sub">Update your profile, swap providers, or upload a new master resume.</p>

        <div className="settings-section">
          <div className="settings-section-title">LinkedIn</div>
          <div className="linkedin-card-row">
            <span
              className={`li-pill ${linkedinConnected ? "li-pill--on" : "li-pill--off"}`}
              aria-live="polite"
            >
              <span className="li-pill-dot" />
              <span>
                {linkedinConnected
                  ? "Connected"
                  : linkedinBusy === "connecting"
                    ? "Log in in the Chrome window, then close it…"
                    : "Not connected"}
              </span>
            </span>
            {linkedinConnected ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={disconnectLinkedin}
                disabled={linkedinBusy !== null}
              >
                {linkedinBusy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={connectLinkedin}
                disabled={linkedinBusy !== null}
              >
                {linkedinBusy === "connecting" ? "Waiting for login…" : "Connect"}
              </button>
            )}
          </div>
        </div>

        <form method="POST" action="/api/settings" encType="multipart/form-data" className="setup-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input type="text" id="name" name="name" defaultValue={name} required />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" defaultValue={email} required />
          </div>

          <div className="form-group">
            <label htmlFor="phone-number">Phone</label>
            <div className="phone-row">
              <select
                className="phone-country"
                aria-label="Country dial code"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.dialCode} · {c.name}
                  </option>
                ))}
              </select>
              <input
                type="tel"
                id="phone-number"
                className="phone-number"
                inputMode="numeric"
                placeholder="555 000 0000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
              />
            </div>
            <input type="hidden" name="phone" value={phoneSubmitValue} />
          </div>

          <div className="form-group">
            <label htmlFor="api-key">
              API Key{" "}
              <span className="label-hint">
                (leave blank to keep current — required if switching provider with no existing key)
              </span>
            </label>
            <div className="api-key-row">
              <select
                className="provider-select"
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
              </select>
              <input
                type="password"
                id="api-key"
                className="api-key-input"
                placeholder={existingMaskedKey ? "Paste a new key to replace" : provider.placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <input type="hidden" name={provider.fieldName} value={apiKey} />
            <p className="form-hint">
              {existingMaskedKey ? (
                <>
                  Configured: <code className="masked-key">{existingMaskedKey}</code>
                  {" · leave blank to keep, paste a new key to replace"}
                </>
              ) : (
                <>No {provider.name} key on file. Paste one to enable this provider.</>
              )}
            </p>
            {providerChanged && (
              <p className="form-warning">
                Switching active provider from{" "}
                <strong>{activeProvider ?? "none"}</strong> to{" "}
                <strong>{provider.id}</strong>. Make sure a {provider.id} key is set.
              </p>
            )}
            {providerMismatch && (
              <p className="form-warning">
                This key prefix looks like a <strong>{detectedProvider}</strong> key — but you selected{" "}
                <strong>{provider.name}</strong>. Switch the provider or check the key.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="daily-token-limit">Daily token limit</label>
            <input
              type="number"
              id="daily-token-limit"
              name="daily_token_limit"
              min={1}
              defaultValue={dailyTokenLimit || "100000"}
            />
            <p className="form-hint">
              Groq&apos;s free tier is ~100,000 tokens/day. The dashboard gauge and
              auto-stop use this number.
            </p>
          </div>

          <div className="form-group">
            <label>Master Resume</label>
            {currentResume && !fileName && (
              <div className="file-current">📄 {currentResume}</div>
            )}
            <div className={`file-drop${fileName ? " file-drop--uploaded" : ""}`}>
              <input
                type="file"
                name="resume"
                accept=".docx,.doc,.pdf"
                id="resume-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setFileName(file?.name ?? null);
                  setFileSize(file?.size ?? null);
                }}
              />
              {fileName ? (
                <>
                  <div className="file-drop-check" aria-hidden>✓</div>
                  <div className="file-drop-badge">UPLOADED</div>
                  <div className="file-drop-filename">{fileName}</div>
                  <div className="file-drop-hint">
                    {fileSizeLabel ? `${fileSizeLabel} · ` : ""}Click to change
                  </div>
                </>
              ) : (
                <>
                  <div className="file-drop-icon">📤</div>
                  <div className="file-drop-text">Upload a new resume to replace</div>
                  <div className="file-drop-hint">.docx, .doc, or .pdf accepted</div>
                </>
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full">Save Changes</button>
        </form>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
