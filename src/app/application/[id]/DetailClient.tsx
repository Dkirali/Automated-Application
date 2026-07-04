"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, ScoreCompare, TopNav } from "@/components/ui";

interface DetailClientProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  application: Record<string, any>;
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

export default function DetailClient({ application }: DetailClientProps) {
  const [resumeHtml, setResumeHtml] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const [kwMatchCount, setKwMatchCount] = useState<number | null>(null);
  const resumeRef = useRef<HTMLDivElement>(null);

  const orig = application.original_ats_score || 0;
  const tail = application.ats_score || 0;
  const hasAts = orig > 0 || tail > 0;

  useEffect(() => {
    if (!application.resume_path) return;
    fetch(`/api/resume-text/${application.id}`)
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
  }, [application.id, application.resume_path]);

  return (
    <div className="min-h-screen bg-cream pb-16">
      <TopNav backLabel="Back to dashboard">
        <Link href="/settings" className="text-cream hover:no-underline hover:opacity-80">
          Settings
        </Link>
      </TopNav>

      <main className="mx-auto max-w-[1080px] px-6 py-7 md:px-10">
        {/* Header */}
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-[26px] font-semibold text-ink">
                  {application.title}
                </h1>
                {application.ats_score > 0 && (
                  <Badge tone={application.ats_score >= 70 ? "green" : "orange"}>
                    ATS {application.ats_score}%
                  </Badge>
                )}
                <Badge tone={application.status === "applied" ? "green" : application.status === "failed" ? "orange" : "neutral"}>
                  {application.status === "applied"
                    ? "✓ Applied"
                    : application.status === "failed"
                      ? "✗ Failed"
                      : application.status}
                </Badge>
              </div>
              <p className="mt-1 text-[14px] text-muted">
                {application.company}
                {application.location ? ` · ${application.location}` : ""}
              </p>
              {application.url && (
                <a
                  href={application.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-[13px] font-semibold text-accent"
                >
                  View on LinkedIn ↗
                </a>
              )}
              {application.status === "failed" && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-danger-line bg-badge-orange px-4 py-3 text-[13px] text-accent-strong">
                  <span>✗ This application failed.</span>
                  <button
                    type="button"
                    className="rounded-btn border-[1.5px] border-[#e3b5a6] px-3 py-1 text-[12px] font-bold text-accent-strong hover:bg-accent-strong hover:text-white"
                    onClick={() =>
                      fetch(`/api/retry-apply/${application.id}`, { method: "POST" }).then(() =>
                        location.reload(),
                      )
                    }
                  >
                    ↻ Retry
                  </button>
                </div>
              )}
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

        {/* Two-panel grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Job brief */}
          <Card flush className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
              Job brief
            </div>
            <div className="p-4">
              {application.jd_summary && (
                <p className="mb-3 text-[13px] leading-[1.55] text-ink">
                  {application.jd_summary}
                </p>
              )}
              {application.keywords && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {application.keywords.split(",").map(
                    (kw: string, i: number) =>
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
              {application.job_description ? (
                <details className="text-[13px]">
                  <summary className="cursor-pointer font-semibold text-accent">
                    Show full description
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-[1.5] text-muted">
                    {application.job_description}
                  </pre>
                </details>
              ) : (
                !application.jd_summary && (
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
                {application.model_used && (
                  <Badge tone="neutral">{application.model_used}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {application.keywords && (
                  <span
                    className="text-[11.5px] font-semibold text-muted"
                    title="Keywords matched in resume"
                  >
                    {kwMatchCount ?? "—"} / {application.keywords.split(",").length} kw
                  </span>
                )}
                {application.resume_path && (
                  <a
                    href={`/api/download/${application.id}`}
                    className="rounded-btn border-[1.5px] border-line px-2.5 py-1 text-[12px] font-bold text-ink hover:bg-ink hover:text-cream hover:no-underline"
                  >
                    ↓ PDF
                  </a>
                )}
              </div>
            </div>
            <div className="p-4">
              {application.resume_path ? (
                resumeError ? (
                  <p className="text-[12.5px] italic text-muted">Could not load resume.</p>
                ) : resumeHtml ? (
                  <div
                    className="resume-rendered"
                    ref={resumeRef}
                    dangerouslySetInnerHTML={{ __html: resumeHtml }}
                  />
                ) : (
                  <Skeleton />
                )
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <div className="text-[24px]">◈</div>
                  <div className="text-[14px] font-bold text-ink">
                    No resume generated
                  </div>
                  <div className="max-w-xs text-[12.5px] text-muted">
                    This application was submitted without a tailored resume.
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
