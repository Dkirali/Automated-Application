"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  ScoreCompare,
  TopNav,
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface FitCategoryView {
  key: string;
  label: string;
  score: number;
  rationale: string;
}

interface HardReqView {
  text: string;
  met: boolean;
  evidence?: string;
}

interface ReviewClientProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>;
  fit: {
    fit_score: number;
    strengths: string[];
    gaps: string[];
    verdict: string;
    jd_summary: string | null;
    jd_keywords: string | null;
    categories: FitCategoryView[];
    requirements: {
      required_keywords: string[];
      preferred_keywords: string[];
      hard_requirements: HardReqView[];
    } | null;
    matchedRequired: string[];
    missedRequired: string[];
    matchedPreferred: string[];
    missedPreferred: string[];
  };
  tailoringInProgress: boolean;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineBold(s: string): string {
  return s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function isAllCapsHeading(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && t === t.toUpperCase() && /[A-Z]/.test(t) && !/[a-z]/.test(t) && !t.startsWith("-") && !t.startsWith("#");
}

function renderMarkdown(text: string): string {
  return text.split("\n").map((line) => {
    if (line.startsWith("## ")) return `<h3 class="resume-section">${escHtml(line.slice(3))}</h3>`;
    if (line.startsWith("# ")) return `<h2 class="resume-name">${escHtml(line.slice(2))}</h2>`;
    if (line.startsWith("> ")) return `<p class="resume-summary">${inlineBold(escHtml(line.slice(2)))}</p>`;
    if (line.startsWith("- ")) return `<p class="resume-bullet">${inlineBold(escHtml(line.slice(2)))}</p>`;
    if (line.trim() === "") return '<div class="resume-spacer"></div>';
    if (isAllCapsHeading(line)) return `<h3 class="resume-section">${escHtml(line.trim())}</h3>`;
    return `<p class="resume-line">${inlineBold(escHtml(line))}</p>`;
  }).join("");
}

function highlightKeywords(container: HTMLElement, keywords: string[]): number {
  if (!keywords?.length) return 0;
  const parts = keywords.map((k) => {
    const e = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return k.length <= 4 ? `\\b${e}\\b` : e;
  });
  const pattern = new RegExp(`(${parts.join("|")})`, "gi");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) nodes.push(node);
  const matched = new Set<string>();
  for (const n of nodes) {
    const m = n.textContent?.match(pattern);
    if (m) m.forEach((w) => matched.add(w.toLowerCase()));
    pattern.lastIndex = 0;
    if (!pattern.test(n.textContent || "")) { pattern.lastIndex = 0; continue; }
    pattern.lastIndex = 0;
    const span = document.createElement("span");
    span.innerHTML = (n.textContent || "").replace(pattern, '<mark class="kw-highlight">$1</mark>');
    pattern.lastIndex = 0;
    n.parentNode?.replaceChild(span, n);
  }
  return matched.size;
}

type ApplyView = {
  state:
    | "idle"
    | "starting"
    | "opening"
    | "easy_apply_click"
    | "filling"
    | "submitting"
    | "awaiting_user"
    | "applied"
    | "failed";
  message: string;
  error?: string;
};

const APPLY_TERMINAL = new Set(["applied", "failed"]);

// Small skeleton loading rows (replaces old .skeleton-line).
function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[55, 80, 70, 65, 90, 50, 75, 60].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-track"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

export default function ReviewClient({ job, fit, tailoringInProgress }: ReviewClientProps) {
  const [resumeHtml, setResumeHtml] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const [kwMatchCount, setKwMatchCount] = useState<number | null>(null);
  const [isTailoring, setIsTailoring] = useState(tailoringInProgress);
  const [currentJob, setCurrentJob] = useState(job);
  const [showConfirm, setShowConfirm] = useState(false);
  const [overrideLowFit, setOverrideLowFit] = useState(false);
  const [apply, setApply] = useState<ApplyView>({ state: "idle", message: "" });
  const resumeRef = useRef<HTMLDivElement>(null);
  const applyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lowFit = fit.fit_score > 0 && fit.fit_score < 50;
  const submitDisabled = apply.state !== "idle" && apply.state !== "failed";

  const startTailor = async () => {
    setIsTailoring(true);
    setResumeHtml(null);
    setResumeError(false);
    setKwMatchCount(null);
    await fetch(`/api/retailor/${currentJob.id}`, { method: "POST", body: new FormData() });
  };

  const handleRetailor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await startTailor();
  };

  const openConfirm = () => {
    setOverrideLowFit(false);
    setShowConfirm(true);
  };

  const submitApply = async () => {
    setShowConfirm(false);
    setApply({ state: "starting", message: "Launching browser…" });
    try {
      const r = await fetch(`/api/apply/${currentJob.id}`, { method: "POST" });
      if (r.status === 409) {
        setApply({ state: "failed", message: "An apply is already in progress for this job." });
        return;
      }
      if (!r.ok) {
        setApply({ state: "failed", message: `Could not start: HTTP ${r.status}` });
        return;
      }
    } catch (e) {
      setApply({ state: "failed", message: `Network error: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    // Polling effect picks up from here
  };

  // Poll apply status while a submission is in flight
  useEffect(() => {
    if (apply.state === "idle" || APPLY_TERMINAL.has(apply.state)) {
      if (applyPollRef.current) {
        clearInterval(applyPollRef.current);
        applyPollRef.current = null;
      }
      return;
    }
    if (applyPollRef.current) return;
    applyPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/apply-status/${currentJob.id}`);
        const data = await r.json();
        setApply({ state: data.state, message: data.message || "", error: data.error });
        if (APPLY_TERMINAL.has(data.state)) {
          if (data.state === "applied") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setCurrentJob((p: Record<string, any>) => ({ ...p, status: "applied" }));
          } else if (data.state === "failed") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setCurrentJob((p: Record<string, any>) => ({ ...p, status: "failed" }));
          }
        }
      } catch {
        // transient — keep polling
      }
    }, 2000);
    return () => {
      if (applyPollRef.current) {
        clearInterval(applyPollRef.current);
        applyPollRef.current = null;
      }
    };
  }, [apply.state, currentJob.id]);

  const orig = currentJob.original_ats_score || 0;
  const tail = currentJob.ats_score || 0;
  const hasAts = orig > 0 || tail > 0;

  // Poll for tailoring completion. Tailoring moves the job through
  // `tailoring` → `reviewed` (done) or `failed`. Stop on a terminal status, and
  // bail after a timeout so a stuck background job can't spin the UI forever.
  useEffect(() => {
    if (!isTailoring) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // ~2 min at 4s intervals
    const interval = setInterval(() => {
      attempts += 1;
      fetch(`/api/job-status/${currentJob.id}`)
        .then((r) => r.json())
        .then((d) => {
          const inProgress = d.status === "pending" || d.status === "tailoring";
          if (!inProgress) {
            clearInterval(interval);
            setIsTailoring(false);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setCurrentJob((prev: Record<string, any>) => ({
              ...prev,
              status: d.status,
              ats_score: d.ats_score ?? prev.ats_score,
              original_ats_score: d.original_ats_score ?? prev.original_ats_score,
              keywords: d.keywords ?? prev.keywords,
              resume_path: d.resume_path ?? prev.resume_path,
              model_used: d.model_used ?? prev.model_used,
            }));
            setResumeHtml(null);
            setResumeError(d.status === "failed");
            setKwMatchCount(null);
          } else if (attempts >= MAX_ATTEMPTS) {
            clearInterval(interval);
            setIsTailoring(false);
            setResumeError(true);
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [isTailoring, currentJob.id]);

  // Load resume text
  useEffect(() => {
    if (isTailoring || !currentJob.resume_path) return;
    fetch(`/api/resume-text/${currentJob.id}`)
      .then((r) => r.json())
      .then((data) => {
        setResumeHtml(renderMarkdown(data.text || ""));
        setTimeout(() => {
          if (resumeRef.current) {
            const count = highlightKeywords(resumeRef.current, data.keywords || []);
            setKwMatchCount(count);
          }
        }, 100);
      })
      .catch(() => setResumeError(true));
  }, [currentJob.id, currentJob.resume_path, isTailoring]);

  return (
    <div className="min-h-screen bg-cream pb-16">
      <TopNav backLabel="Back to dashboard">
        <Link href="/settings" className="text-cream hover:no-underline hover:opacity-80">
          Settings
        </Link>
      </TopNav>

      <main className="mx-auto max-w-[1080px] px-6 py-7 md:px-10">
        {/* Job header */}
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-[26px] font-semibold text-ink">
                  {currentJob.title}
                </h1>
                {fit.fit_score > 0 && (
                  <Badge tone={fit.fit_score >= 70 ? "green" : "orange"}>
                    {fit.fit_score}% fit
                  </Badge>
                )}
                <Badge tone={currentJob.easy_apply ? "green" : "orange"}>
                  {currentJob.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
                </Badge>
              </div>
              <p className="mt-1 text-[14px] text-muted">
                {currentJob.company}
                {currentJob.location ? ` · ${currentJob.location}` : ""}
              </p>
              <a
                href={currentJob.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-[13px] font-semibold text-accent"
              >
                {currentJob.easy_apply ? "View on LinkedIn ↗" : "↗ Apply on LinkedIn"}
              </a>
            </div>
            {hasAts && (
              <div className="shrink-0">
                <div className="mb-2 text-right text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted">
                  ATS score
                </div>
                <ScoreCompare original={orig} tailored={tail} />
              </div>
            )}
          </div>
        </Card>

        {/* Fit analysis */}
        {fit.strengths.length > 0 || fit.gaps.length > 0 || fit.verdict ? (
          <Card className="mb-4">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {fit.strengths.length > 0 && (
                <div>
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Strengths
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fit.strengths.map((s, i) => (
                      <Badge key={i} tone="green">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {fit.gaps.length > 0 && fit.gaps[0] !== "None" && (
                <div>
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Gaps
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fit.gaps.map((g, i) => (
                      <Badge key={i} tone="orange">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {fit.verdict && (
              <p className="mt-4 border-t border-line pt-4 text-[13px] italic leading-[1.5] text-muted">
                {fit.verdict}
              </p>
            )}
          </Card>
        ) : (
          <Card className="mb-4">
            <Skeleton />
          </Card>
        )}

        {/* Score breakdown */}
        {fit.categories && fit.categories.length > 0 && (
          <Card className="mb-4">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                  Overall fit score
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-serif text-[34px] font-semibold text-ink">
                    {fit.fit_score || "—"}
                  </span>
                  <span className="text-[13px] text-muted">/ 100</span>
                </div>
              </div>
              <div className="w-40">
                <div className="h-[7px] overflow-hidden rounded bg-track">
                  <div
                    className={cn(
                      "h-full rounded",
                      fit.fit_score >= 70 ? "bg-green-strong" : "bg-accent",
                    )}
                    style={{ width: `${Math.max(fit.fit_score, 3)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                Match breakdown
              </div>
              {fit.categories.map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-[13px] font-semibold text-ink">
                      {cat.label}
                    </span>
                    <div className="h-[7px] flex-1 overflow-hidden rounded bg-track">
                      <div
                        className={cn(
                          "h-full rounded",
                          cat.score >= 70 ? "bg-green-strong" : "bg-accent",
                        )}
                        style={{ width: `${cat.score}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[13px] font-semibold text-ink">
                      {cat.score}
                    </span>
                  </div>
                  {cat.rationale && (
                    <p className="ml-[172px] mt-1 text-[11.5px] italic text-muted">
                      {cat.rationale}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {fit.requirements && (
              <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4">
                {(fit.matchedRequired.length > 0 || fit.missedRequired.length > 0) && (
                  <div>
                    <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                      Required keywords
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {fit.matchedRequired.map((k) => (
                        <Badge key={`mr-${k}`} tone="green">
                          ✓ {k}
                        </Badge>
                      ))}
                      {fit.missedRequired.map((k) => (
                        <Badge key={`xr-${k}`} tone="orange">
                          ✗ {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(fit.matchedPreferred.length > 0 || fit.missedPreferred.length > 0) && (
                  <div>
                    <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                      Preferred keywords
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {fit.matchedPreferred.map((k) => (
                        <Badge key={`mp-${k}`} tone="green">
                          ✓ {k}
                        </Badge>
                      ))}
                      {fit.missedPreferred.map((k) => (
                        <Badge key={`xp-${k}`} tone="neutral">
                          ✗ {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {fit.requirements.hard_requirements.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                      Hard requirements
                    </div>
                    <ul className="flex flex-col gap-2">
                      {fit.requirements.hard_requirements.map((r, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 font-bold",
                              r.met ? "text-green" : "text-accent",
                            )}
                          >
                            {r.met ? "✓" : "✗"}
                          </span>
                          <div>
                            <div className="text-[13px] text-ink">{r.text}</div>
                            {r.evidence && r.met && (
                              <div className="text-[11.5px] italic text-muted">
                                {r.evidence}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Two-panel review grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Job brief */}
          <Card flush className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
              Job brief
            </div>
            <div className="p-4">
              {fit.jd_summary && (
                <p className="mb-3 text-[13px] leading-[1.55] text-ink">
                  {fit.jd_summary}
                </p>
              )}
              {fit.jd_keywords && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {fit.jd_keywords.split(",").map(
                    (kw, i) =>
                      kw.trim() && (
                        <span
                          key={i}
                          className="rounded-md bg-badge-orange px-2 py-1 text-[11.5px] font-semibold text-accent"
                        >
                          {kw.trim()}
                        </span>
                      ),
                  )}
                </div>
              )}
              {currentJob.job_description ? (
                <details className="text-[13px]">
                  <summary className="cursor-pointer font-semibold text-accent">
                    Show full description
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-[1.5] text-muted">
                    {currentJob.job_description}
                  </pre>
                </details>
              ) : (
                !fit.jd_summary && (
                  <p className="text-[12.5px] italic text-muted">
                    No description available.
                  </p>
                )
              )}
            </div>
          </Card>

          {/* Tailored resume */}
          <Card flush className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
                  Tailored resume
                </span>
                {currentJob.model_used && (
                  <Badge tone="neutral">{currentJob.model_used}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {currentJob.keywords && (
                  <span
                    className="text-[11.5px] font-semibold text-muted"
                    title="Keywords matched in resume"
                  >
                    {kwMatchCount ?? "—"} / {currentJob.keywords.split(",").length} kw
                  </span>
                )}
                {currentJob.resume_path && (
                  <a
                    href={`/api/download/${currentJob.id}`}
                    className="rounded-btn border-[1.5px] border-line px-2.5 py-1 text-[12px] font-bold text-ink hover:bg-ink hover:text-cream hover:no-underline"
                  >
                    ↓ PDF
                  </a>
                )}
                <form onSubmit={handleRetailor}>
                  <button
                    type="submit"
                    className="rounded-btn border-[1.5px] border-line px-2.5 py-1 text-[12px] font-bold text-ink hover:bg-ink hover:text-cream disabled:opacity-50"
                    disabled={isTailoring}
                  >
                    ⟳ Re-tailor
                  </button>
                </form>
              </div>
            </div>
            <div className="p-4">
              {isTailoring ? (
                <>
                  <Skeleton />
                  <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
                    Tailoring resume… this takes about 30–60 seconds.
                  </div>
                </>
              ) : currentJob.status === "failed" ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <div className="text-[24px]">⚠</div>
                  <div className="text-[14px] font-bold text-ink">
                    Tailoring didn&apos;t complete
                  </div>
                  <div className="max-w-xs text-[12.5px] text-muted">
                    Something went wrong generating this resume — try again.
                  </div>
                  <Button size="sm" variant="outline" onClick={startTailor} className="mt-2">
                    ⟳ Try again
                  </Button>
                </div>
              ) : !currentJob.resume_path ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <div className="text-[24px]">◈</div>
                  <div className="text-[14px] font-bold text-ink">
                    Resume not tailored yet
                  </div>
                  <div className="max-w-xs text-[12.5px] text-muted">
                    Generate a tailored, ATS-optimized resume for this role.
                  </div>
                  <Button size="sm" variant="accent" onClick={startTailor} className="mt-2">
                    ✦ Create tailored resume
                  </Button>
                </div>
              ) : resumeError ? (
                <p className="text-[12.5px] italic text-muted">Could not load resume.</p>
              ) : resumeHtml ? (
                <div
                  className="resume-rendered"
                  ref={resumeRef}
                  dangerouslySetInnerHTML={{ __html: resumeHtml }}
                />
              ) : (
                <Skeleton />
              )}
            </div>
          </Card>
        </div>

        {/* Apply progress strip */}
        {apply.state !== "idle" && (
          <div
            className={cn(
              "mt-4 flex items-center gap-3 rounded-card border px-4 py-3 text-[13px]",
              apply.state === "applied"
                ? "border-green-strong bg-badge-green text-green"
                : apply.state === "failed"
                  ? "border-danger-line bg-badge-orange text-accent-strong"
                  : "border-line bg-card text-ink",
            )}
            role="status"
            aria-live="polite"
          >
            {!APPLY_TERMINAL.has(apply.state) && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            )}
            <span className="font-bold">
              {apply.state === "applied"
                ? "✓ Applied"
                : apply.state === "failed"
                  ? "✗ Failed"
                  : apply.state === "awaiting_user"
                    ? "⏸ Awaiting your input"
                    : "Working…"}
            </span>
            <span className="text-muted">{apply.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {currentJob.easy_apply && currentJob.status !== "applied" && (
            <Button
              type="button"
              variant="accent"
              onClick={openConfirm}
              disabled={submitDisabled || isTailoring}
              title={isTailoring ? "Wait for tailoring to finish" : ""}
              className="px-7 py-3"
            >
              ✓ Apply now
            </Button>
          )}
          {currentJob.status !== "applied" && (
            <form method="POST" action={`/api/discard/${currentJob.id}`}>
              <Button type="submit" variant="outline" className="px-6 py-3">
                ✗ Discard
              </Button>
            </form>
          )}
          <Link
            href="/"
            className="text-[13px] font-semibold text-muted hover:text-ink"
          >
            Back to dashboard
          </Link>
        </div>
      </main>

      {/* Confirmation modal */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-card border border-line bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-serif text-[21px] font-semibold text-ink">
              Submit this application?
            </h3>
            <p className="mt-1 text-[13px] leading-[1.5] text-muted">
              JobBot will open Chrome and submit Easy Apply on LinkedIn for{" "}
              <strong className="text-ink">{currentJob.title}</strong> at{" "}
              <strong className="text-ink">{currentJob.company}</strong>.
            </p>

            <dl className="mt-4 flex flex-col gap-2 rounded-xl bg-input p-3 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Resume</dt>
                <dd className="truncate font-semibold text-ink">
                  {currentJob.resume_path
                    ? currentJob.resume_path.split("/").pop()
                    : "Master resume (not tailored)"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Fit score</dt>
                <dd>
                  <Badge tone={fit.fit_score >= 70 ? "green" : "orange"}>
                    {fit.fit_score}%
                  </Badge>
                </dd>
              </div>
            </dl>

            {lowFit && (
              <div className="mt-3 rounded-xl border border-danger-line bg-badge-orange p-3 text-[12.5px] text-accent-strong">
                <strong>Low fit ({fit.fit_score}%).</strong> Applying anyway can hurt
                your signal-to-noise ratio with this employer.
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={overrideLowFit}
                    onChange={(e) => setOverrideLowFit(e.target.checked)}
                  />
                  <span>Apply anyway</span>
                </label>
              </div>
            )}

            <p className="mt-3 text-[11.5px] leading-[1.5] text-muted">
              If LinkedIn asks for fields the bot can&apos;t answer (years of
              experience, salary, etc.), the Chrome window stays open so you can
              finish manually.
            </p>

            <div className="mt-5 flex items-center justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="accent"
                disabled={lowFit && !overrideLowFit}
                onClick={submitApply}
              >
                Submit application
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
