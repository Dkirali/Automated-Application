"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  StatCard,
  TopNav,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ResumeAudit, RoleSuggestion, Severity } from "@/lib/resume-doctor";

interface AnalyzeResponse {
  ok: boolean;
  reason?: string;
  retryAt?: number;
  name?: string | null;
  resumeName?: string | null;
  audit?: ResumeAudit;
  roles?: RoleSuggestion[];
}

const REASON_COPY: Record<string, string> = {
  no_master_resume: "No resume on file — upload one in Settings first.",
  no_provider: "No AI provider configured — add one in Settings.",
  resume_unreadable: "Couldn't read your resume file.",
  resume_empty: "Your resume file appears to be empty.",
  rate_limited: "AI is rate-limited right now — try again shortly.",
  analysis_failed: "Analysis failed — please try again.",
  improve_failed: "Couldn't rewrite the resume — please try again.",
};

const SEV_TONE: Record<Severity, "orange" | "neutral"> = {
  high: "orange",
  medium: "neutral",
  low: "neutral",
};

const MATCH_TONE = {
  strong: "green",
  moderate: "neutral",
  stretch: "orange",
} as const;

export default function ResumeClient() {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [improve, setImprove] = useState<{
    state: "idle" | "loading" | "done" | "error";
    text?: string;
    reason?: string;
  }>({ state: "idle" });

  // Fetch results; only touches state after the await so it's safe to call
  // from the mount effect (no synchronous setState in an effect).
  const load = useCallback(async (refresh: boolean) => {
    try {
      const res = await fetch(`/api/resume/analyze${refresh ? "?refresh=1" : ""}`);
      const body: AnalyzeResponse = await res.json();
      setData(body);
      setState(body.ok ? "done" : "error");
    } catch {
      setData({ ok: false, reason: "analysis_failed" });
      setState("error");
    }
  }, []);

  const analyze = useCallback(() => {
    setState("loading");
    setData(null);
    void load(true); // force a fresh run
  }, [load]);

  const runImprove = useCallback(async () => {
    setImprove({ state: "loading" });
    try {
      const res = await fetch("/api/resume/improve", { method: "POST" });
      const body = await res.json();
      setImprove(
        body.ok
          ? { state: "done", text: body.text }
          : { state: "error", reason: body.reason }
      );
    } catch {
      setImprove({ state: "error", reason: "improve_failed" });
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount (uses server-side cache); state is set only after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  const audit = data?.audit;

  return (
    <div className="min-h-screen bg-cream pb-16">
      <TopNav>
        <Link href="/" className="text-cream hover:no-underline hover:opacity-80">
          Dashboard
        </Link>
        <Link href="/tracker" className="text-cream hover:no-underline hover:opacity-80">
          Tracker
        </Link>
        <Link href="/settings" className="text-cream hover:no-underline hover:opacity-80">
          Settings
        </Link>
      </TopNav>

      <main className="mx-auto max-w-[900px] px-6 py-9 md:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-[30px] font-semibold text-ink">
              Resume doctor
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              {data?.resumeName ? (
                <>
                  Analyzing <strong className="text-ink">{data.resumeName}</strong> ·{" "}
                  <Link href="/settings">change</Link>
                </>
              ) : (
                "ATS + standards check and role suggestions for your master resume."
              )}
            </p>
          </div>
          {state !== "loading" && (
            <Button variant="outline" size="sm" onClick={analyze}>
              ↻ Re-analyze
            </Button>
          )}
        </div>

        {state === "loading" && (
          <Card className="flex items-center gap-3 py-10">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span className="text-[14px] text-muted">
              Reading your resume and scoring it… this takes ~10–20 seconds.
            </span>
          </Card>
        )}

        {state === "error" && (
          <Card className="flex flex-col items-start gap-3 py-8">
            <p className="text-[14px] text-accent-strong">
              {REASON_COPY[data?.reason ?? "analysis_failed"] ??
                "Something went wrong."}
            </p>
            {(data?.reason === "no_master_resume" || data?.reason === "no_provider") ? (
              <Link
                href="/settings"
                className="inline-flex items-center rounded-btn bg-accent px-5 py-2.5 text-[13px] font-bold text-white hover:no-underline"
              >
                Go to Settings →
              </Link>
            ) : (
              <Button variant="accent" onClick={analyze}>
                Try again
              </Button>
            )}
          </Card>
        )}

        {state === "done" && audit && (
          <div className="flex flex-col gap-6">
            {/* Scores */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Overall"
                value={audit.overall}
                foot={`${audit.wordCount} words`}
              />
              <ScoreCard label="ATS parseability" value={audit.atsParseability} />
              <ScoreCard label="Writing & impact" value={audit.standardsScore} />
            </div>

            {/* Strengths */}
            {audit.strengths.length > 0 && (
              <Card>
                <SectionTitle as="label" className="mb-3">
                  Strengths
                </SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {audit.strengths.map((s, i) => (
                    <Badge key={i} tone="green">
                      {s}
                    </Badge>
                  ))}
                </div>
              </Card>
            )}

            {/* Fix list */}
            <Card>
              <SectionTitle
                as="label"
                className="mb-4"
                aside={<Badge tone="orange">{audit.findings.length}</Badge>}
              >
                Prioritized fixes
              </SectionTitle>
              {audit.findings.length === 0 ? (
                <p className="text-[13px] text-muted">
                  No significant issues found — nice resume.
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {audit.findings.map((f, i) => (
                    <li
                      key={i}
                      className={cn(
                        "border-l-[3px] pl-4",
                        f.severity === "high" ? "border-accent" : "border-line",
                      )}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={SEV_TONE[f.severity]}>{f.severity}</Badge>
                        <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                          {f.category}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold text-ink">{f.issue}</p>
                      <p className="mt-0.5 text-[13px] leading-[1.5] text-muted">
                        <span className="font-semibold text-accent">Fix: </span>
                        {f.fix}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Improve / rewrite */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <SectionTitle as="label">Improve my resume</SectionTitle>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Rewrite to stronger standards (impact, action verbs, concise
                    bullets) — your employers, dates, and schools are preserved.
                  </p>
                </div>
                {improve.state !== "done" && (
                  <Button
                    variant="accent"
                    onClick={runImprove}
                    disabled={improve.state === "loading"}
                  >
                    {improve.state === "loading" ? "Rewriting…" : "✨ Rewrite my resume"}
                  </Button>
                )}
              </div>

              {improve.state === "loading" && (
                <div className="mt-4 flex items-center gap-3 text-[13px] text-muted">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                  Rewriting with the flagship model… ~30–60 seconds.
                </div>
              )}
              {improve.state === "error" && (
                <p className="mt-4 text-[13px] text-accent-strong">
                  {REASON_COPY[improve.reason ?? "improve_failed"] ??
                    "Couldn't rewrite the resume."}
                </p>
              )}
              {improve.state === "done" && improve.text && (
                <div className="mt-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <a
                      href="/api/resume/download-improved"
                      className="inline-flex items-center rounded-btn bg-accent px-4 py-2 text-[13px] font-bold text-white hover:no-underline"
                    >
                      ↓ Download .docx
                    </a>
                    <Button variant="outline" size="sm" onClick={runImprove}>
                      ↻ Rewrite again
                    </Button>
                    <span className="text-[12px] text-muted">
                      Review before use — AI rewrites can drift.
                    </span>
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-input p-4 font-sans text-[12.5px] leading-[1.55] text-ink">
                    {improve.text}
                  </pre>
                </div>
              )}
            </Card>

            {/* Role suggestions */}
            <Card>
              <SectionTitle as="label" className="mb-1">
                Roles you&apos;re positioned for
              </SectionTitle>
              <p className="mb-4 text-[12.5px] text-muted">
                Push any of these into a campaign to start finding live postings.
              </p>
              {!data?.roles?.length ? (
                <p className="text-[13px] text-muted">No role suggestions available.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.roles.map((r, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold text-ink">
                            {r.title}
                          </span>
                          <Badge tone={MATCH_TONE[r.matchStrength]}>
                            {r.matchStrength}
                          </Badge>
                          <span className="text-[12px] text-muted">{r.seniority}</span>
                        </div>
                        <p className="mt-1 text-[13px] leading-[1.5] text-muted">
                          {r.rationale}
                        </p>
                      </div>
                      <Link
                        href={`/?titles=${encodeURIComponent(r.title)}`}
                        className="shrink-0 rounded-btn border-[1.5px] border-ink px-4 py-2 text-[13px] font-bold text-ink hover:bg-ink hover:text-cream hover:no-underline"
                      >
                        Use in campaign →
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  const tone = value >= 70 ? "green" : "accent";
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-card p-5">
      <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      <span
        className={cn(
          "font-serif text-[34px] leading-none font-semibold",
          tone === "green" ? "text-green" : "text-ink",
        )}
      >
        {value}
      </span>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}
