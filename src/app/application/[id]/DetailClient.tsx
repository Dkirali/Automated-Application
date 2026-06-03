"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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

export default function DetailClient({ application }: DetailClientProps) {
  const [resumeHtml, setResumeHtml] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const [kwMatchCount, setKwMatchCount] = useState<number | null>(null);
  const resumeRef = useRef<HTMLDivElement>(null);

  const scoreClass = (s: number) => (s >= 70 ? "high" : s >= 40 ? "medium" : "low");

  const orig = application.original_ats_score || 0;
  const tail = application.ats_score || 0;
  const delta = tail - orig;
  const circ = 125.66;
  const origDash = Math.max((orig / 100) * circ, 2);
  const tailDash = Math.max((tail / 100) * circ, 2);

  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".ats-ring-number[data-target]").forEach((el) => {
      const target = parseInt(el.dataset.target || "0", 10);
      const dur = 900;
      const start = performance.now();
      function tick(now: number) {
        const p = Math.min((now - start) / dur, 1);
        el.textContent = String(Math.round((1 - Math.pow(1 - p, 3)) * target));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, []);

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
    <div className="container">
      <div className="topbar">
        <div className="topbar-brand">
          <Link href="/" className="back-link">← JobBot</Link>
        </div>
        <div className="topbar-actions">
          <a href="/settings" className="icon-link">⚙ Settings</a>
        </div>
      </div>

      <div className="review-header">
        <div className="review-header-body">
          <div className="review-header-top">
            <h1 className="review-title">{application.title}</h1>
            {application.ats_score > 0 && (
              <span className={`fit-score-badge fit-score--${scoreClass(application.ats_score)}`}>ATS {application.ats_score}%</span>
            )}
          </div>
          <p className="review-meta">{application.company}{application.location ? ` · ${application.location}` : ""}</p>
          {application.url && <a href={application.url} target="_blank" rel="noopener noreferrer" className="review-link">View on LinkedIn ↗</a>}
          {application.status === "failed" && (
            <div className="alert alert-warning" style={{ marginTop: "10px" }}>
              ✗ This application failed.{" "}
              <button
                type="button"
                className="retry-btn"
                onClick={() =>
                  fetch(`/api/retry-apply/${application.id}`, { method: "POST" }).then(() => location.reload())
                }
              >
                ↻ Retry
              </button>
            </div>
          )}
        </div>

        <div className="ats-comparison">
          <div className="ats-ring-wrap ats-ring-wrap--original">
            <svg className="ats-ring" viewBox="0 0 48 48" width="72" height="72">
              <circle className="ats-ring-bg" cx="24" cy="24" r="20" />
              <circle className={`ats-ring-fill ${scoreClass(orig)}`} cx="24" cy="24" r="20" strokeDasharray={`${origDash} ${circ - origDash}`} strokeDashoffset="31.415" />
            </svg>
            <div className="ats-ring-label">
              <span className="ats-ring-number" data-target={orig}>0</span>
              <span className="ats-ring-unit">Original</span>
            </div>
          </div>
          <div className="ats-delta">
            <span className="ats-delta-arrow">→</span>
            <span className={`ats-delta-value ${delta > 0 ? "positive" : delta < 0 ? "negative" : ""}`}>
              {delta > 0 ? "+" : ""}{delta}%
            </span>
          </div>
          <div className="ats-ring-wrap ats-ring-wrap--tailored">
            <svg className="ats-ring" viewBox="0 0 48 48" width="72" height="72">
              <circle className="ats-ring-bg" cx="24" cy="24" r="20" />
              <circle className={`ats-ring-fill ${scoreClass(tail)} tailored-fill`} cx="24" cy="24" r="20" strokeDasharray={`${tailDash} ${circ - tailDash}`} strokeDashoffset="31.415" />
            </svg>
            <div className="ats-ring-label">
              <span className="ats-ring-number" data-target={tail}>0</span>
              <span className="ats-ring-unit">Tailored</span>
            </div>
          </div>
        </div>
      </div>

      <div className="review-grid">
        <div className="review-panel">
          <div className="review-panel-header">
            <span className="review-panel-title">Job Brief</span>
          </div>
          <div className="review-panel-body">
            {application.jd_summary && (
              <div className="jd-summary-card">
                <p className="jd-summary-text">{application.jd_summary}</p>
              </div>
            )}
            {application.keywords && (
              <div className="jd-keyword-chips">
                {application.keywords.split(",").map((kw: string, i: number) => kw.trim() && <span key={i} className="jd-keyword-chip">{kw.trim()}</span>)}
              </div>
            )}
            {application.job_description ? (
              <details className="jd-full-toggle">
                <summary>Show full description</summary>
                <pre className="jd-text">{application.job_description}</pre>
              </details>
            ) : !application.jd_summary && (
              <p className="empty-note">No description available.</p>
            )}
          </div>
        </div>

        <div className="resume-panel">
          <div className="resume-panel-header">
            <div className="resume-panel-title">
              <span className="panel-label">TAILORED RESUME</span>
              {application.model_used && <span className="model-badge tailored-model-badge">{application.model_used}</span>}
            </div>
            <div className="resume-panel-actions">
              {application.keywords && (
                <span className="kw-match-badge" title="Keywords matched in resume">
                  <span>{kwMatchCount ?? "—"}</span>&thinsp;/&thinsp;{application.keywords.split(",").length} kw
                </span>
              )}
              {application.resume_path && <a href={`/api/download/${application.id}`} className="btn-download">↓ PDF</a>}
            </div>
          </div>
          <div className="resume-body">
            {application.resume_path ? (
              resumeError ? (
                <p className="empty-note">Could not load resume.</p>
              ) : resumeHtml ? (
                <div className="resume-rendered" ref={resumeRef} dangerouslySetInnerHTML={{ __html: resumeHtml }} />
              ) : (
                <div>
                  {[55, 80, 70, 65, 90, 50, 75, 60].map((w, i) => <div key={i} className="skeleton-line" style={{ width: `${w}%` }} />)}
                </div>
              )
            ) : (
              <div className="resume-not-tailored">
                <div className="resume-not-tailored-icon">◈</div>
                <div className="resume-not-tailored-msg">No resume generated</div>
                <div className="resume-not-tailored-hint">This application was submitted without a tailored resume.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
