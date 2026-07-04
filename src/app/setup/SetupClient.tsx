"use client";

import { useMemo, useState } from "react";
import {
  COUNTRIES,
  PROVIDERS,
  detectProvider,
  formatPhone,
  type ProviderInfo,
} from "@/lib/setup-helpers";
import {
  Button,
  Field,
  OnboardingAside,
  SelectField,
  SplitScreenLayout,
  StepIndicator,
} from "@/components/ui";

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
    <SplitScreenLayout left={<OnboardingAside />}>
      <StepIndicator total={2} current={1} className="mb-6" />

      <h2 className="font-serif text-[28px] font-semibold text-ink">
        Let&apos;s get you set up
      </h2>
      <p className="mt-1 mb-6 text-[14px] text-muted">
        Takes about a minute. You only do this once.
      </p>

      <form
        method="POST"
        action="/api/setup"
        encType="multipart/form-data"
        className="flex flex-col gap-[18px]"
      >
        <Field
          type="text"
          id="name"
          name="name"
          label="Full name"
          required
          placeholder="Your name"
        />

        <Field
          type="email"
          id="email"
          name="email"
          label="Email"
          required
          placeholder="you@email.com"
        />

        {/* Phone: country dial-code select + national number; hidden field carries the formatted value */}
        <div className="flex flex-col gap-1.5">
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

        {/* API key: provider select + key input; hidden field carries the key under the provider's field name */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink">
            API key{" "}
            {provider.hint && (
              <span className="font-normal text-muted">({provider.hint})</span>
            )}
          </span>
          <div className="grid grid-cols-[minmax(0,150px)_1fr] gap-2">
            <SelectField
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
              placeholder={provider.placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <input type="hidden" name={provider.fieldName} value={apiKey} />
          {providerMismatch && (
            <p className="text-[11.5px] text-accent-strong">
              This key prefix looks like a <strong>{detectedProvider}</strong> key
              — but you selected <strong>{provider.name}</strong>. Switch the
              provider or check the key.
            </p>
          )}
        </div>

        {/* Master resume upload with a success state */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink">Master resume</span>
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
              required
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
                  📄
                </span>
                <span className="text-[13.5px] font-bold text-ink">
                  Click to upload your resume
                </span>
                <span className="text-[11.5px] text-muted">
                  .docx, .doc, or .pdf accepted
                </span>
              </>
            )}
          </label>
        </div>

        <Button type="submit" variant="accent" className="w-full py-3.5">
          Save &amp; continue →
        </Button>
      </form>
    </SplitScreenLayout>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
