"use client";

import { useMemo, useState } from "react";
import {
  COUNTRIES,
  PROVIDERS,
  detectProvider,
  formatPhone,
  type ProviderInfo,
} from "@/lib/setup-helpers";

const DEFAULT_COUNTRY_CODE = "US";
const DEFAULT_PROVIDER_ID = PROVIDERS[0].id;

export default function SetupClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);

  const [countryCode, setCountryCode] = useState<string>(DEFAULT_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState<string>("");

  const [providerId, setProviderId] = useState<ProviderInfo["id"]>(DEFAULT_PROVIDER_ID);
  const [apiKey, setApiKey] = useState<string>("");

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

  return (
    <div className="page-center">
      <div className="form-card">
        <span className="form-card-logo">JobBot</span>
        <h2>Let&apos;s get you set up</h2>
        <p className="form-card-sub">Takes about a minute. You only need to do this once.</p>

        <div className="steps">
          <div className="step-dot active" />
          <div className="step-dot" />
        </div>

        <form method="POST" action="/api/setup" encType="multipart/form-data" className="setup-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input type="text" id="name" name="name" required placeholder="Your Name" />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="you@email.com" />
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
              {provider.hint && <span className="label-hint">({provider.hint})</span>}
            </label>
            <div className="api-key-row">
              <select
                className="provider-select"
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
                placeholder={provider.placeholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <input type="hidden" name={provider.fieldName} value={apiKey} />
            {providerMismatch && (
              <p className="form-warning">
                This key prefix looks like a <strong>{detectedProvider}</strong> key — but you selected{" "}
                <strong>{provider.name}</strong>. Switch the provider or check the key.
              </p>
            )}
          </div>

          <div className="form-group">
            <label>Master Resume</label>
            <div className={`file-drop${fileName ? " file-drop--uploaded" : ""}`}>
              <input
                type="file"
                name="resume"
                accept=".docx,.doc,.pdf"
                required
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
                  <div className="file-drop-icon">📄</div>
                  <div className="file-drop-text">Click to upload your resume</div>
                  <div className="file-drop-hint">.docx, .doc, or .pdf accepted</div>
                </>
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full">
            Save &amp; Continue →
          </button>
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
