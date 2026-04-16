"use client";

import { useEffect, useRef, useState } from "react";

interface FitCategoryView {
  key: string;
  label: string;
  score: number;
  rationale: string;
}

interface ReviewClientProps {
  job: Record<string, any>;
  fit: {
    fit_score: number;
    strengths: string[];
    gaps: string[];
    verdict: string;
    jd_summary: string | null;
    jd_keywords: string | null;
    categories: FitCategoryView[];
  };
  availableModels: Record<string, string>;
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

export default function ReviewClient({ job, fit, availableModels, tailoringInProgress }: ReviewClientProps) {
  const [resumeHtml, setResumeHtml] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const [kwMatchCount, setKwMatchCount] = useState<number | null>(null);
  const [isTailoring, setIsTailoring] = useState(tailoringInProgress);
  const [currentJob, setCurrentJob] = useState(job);
  const resumeRef = useRef<HTMLDivElement>(null);

  const scoreClass = (s: number) => (s >= 70 ? "high" : s >= 40 ? "medium" : "low");

  const handleRetailor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setIsTailoring(true);
    setResumeHtml(null);
    setResumeError(false);
    setKwMatchCount(null);
    await fetch(`/api/retailor/${currentJob.id}`, { method: "POST", body: formData });
  };

  const orig = currentJob.original_ats_score || 0;
  const tail = currentJob.ats_score || 0;
  const delta = tail - orig;
  const circ = 125.66;
  const origDash = Math.max((orig / 100) * circ, 2);
  const tailDash = Math.max((tail / 100) * circ, 2);

  // Count-up animation
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

  // Poll for tailoring completion
  useEffect(() => {
    if (!isTailoring) return;
    const interval = setInterval(() => {
      fetch(`/api/job-status/${currentJob.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status !== "pending") {
            clearInterval(interval);
            setIsTailoring(false);
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
            setResumeError(false);
            setKwMatchCount(null);
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
    <div className="container">
      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-brand">
          <a href="/" className="back-link">← JobBot</a>
        </div>
        <div className="topbar-actions">
          <a href="/settings" className="icon-link">⚙ Settings</a>
        </div>
      </div>

      {/* Job Header */}
      <div className="review-header">
        <div className="review-header-body">
          <div className="review-header-top">
            <h1 className="review-title">{currentJob.title}</h1>
            {fit.fit_score > 0 && (
              <span className={`fit-score-badge fit-score--${scoreClass(fit.fit_score)}`}>{fit.fit_score}% fit</span>
            )}
            <span className={`apply-badge apply-badge--${currentJob.easy_apply ? "easy" : "manual"}`}>
              {currentJob.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
            </span>
          </div>
          <p className="review-meta">{currentJob.company}{currentJob.location ? ` · ${currentJob.location}` : ""}</p>
          {currentJob.easy_apply ? (
            <a
              href={currentJob.url}
              target="_blank"
              rel="noopener noreferrer"
              className="review-link"
            >
              View on LinkedIn ↗
            </a>
          ) : (
            <a
              href={currentJob.url}
              target="_blank"
              rel="noopener noreferrer"
              className="apply-linkedin-btn"
            >
              ↗ Apply on LinkedIn
            </a>
          )}
        </div>

        {/* Dual ATS Rings */}
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

      {/* Fit Analysis Bar */}
      {fit.strengths.length > 0 || fit.gaps.length > 0 || fit.verdict ? (
        <div className="fit-bar">
          {fit.strengths.length > 0 && (
            <div className="fit-section">
              <div className="fit-section-label">Strengths</div>
              <div className="fit-chips">
                {fit.strengths.map((s, i) => <span key={i} className="fit-chip fit-chip--strength">{s}</span>)}
              </div>
            </div>
          )}
          {fit.gaps.length > 0 && fit.gaps[0] !== "None" && (
            <div className="fit-section">
              <div className="fit-section-label">Gaps</div>
              <div className="fit-chips">
                {fit.gaps.map((g, i) => <span key={i} className="fit-chip fit-chip--gap">{g}</span>)}
              </div>
            </div>
          )}
          {fit.verdict && <div className="fit-verdict">{fit.verdict}</div>}
        </div>
      ) : (
        <div className="fit-bar fit-bar--loading">
          <div className="skeleton-line" style={{ width: "60%" }} />
          <div className="skeleton-line" style={{ width: "40%" }} />
        </div>
      )}

      {fit.categories && fit.categories.length > 0 && (
        <div className="fit-categories">
          <div className="fit-categories-title">Match Breakdown</div>
          {fit.categories.map((cat) => (
            <div key={cat.key} className="fit-cat-row">
              <span className="fit-cat-label">{cat.label}</span>
              <div className="fit-cat-bar-wrap">
                <div
                  className={`fit-cat-bar-fill ${scoreClass(cat.score)}`}
                  style={{ width: `${cat.score}%` }}
                />
              </div>
              <span className="fit-cat-score">{cat.score}</span>
              {cat.rationale && <div className="fit-cat-rationale">{cat.rationale}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Two-panel review grid */}
      <div className="review-grid">
        {/* Left: Job Brief */}
        <div className="review-panel">
          <div className="review-panel-header">
            <span className="review-panel-title">Job Brief</span>
          </div>
          <div className="review-panel-body">
            {fit.jd_summary && (
              <div className="jd-summary-card">
                <p className="jd-summary-text">{fit.jd_summary}</p>
              </div>
            )}
            {fit.jd_keywords && (
              <div className="jd-keyword-chips">
                {fit.jd_keywords.split(",").map((kw, i) => kw.trim() && <span key={i} className="jd-keyword-chip">{kw.trim()}</span>)}
              </div>
            )}
            {currentJob.job_description ? (
              <details className="jd-full-toggle">
                <summary>Show full description</summary>
                <pre className="jd-text">{currentJob.job_description}</pre>
              </details>
            ) : !fit.jd_summary && (
              <p className="empty-note">No description available.</p>
            )}
          </div>
        </div>

        {/* Right: Tailored Resume Panel */}
        <div className="resume-panel">
          <div className="resume-panel-header">
            <div className="resume-panel-title">
              <span className="panel-label">TAILORED RESUME</span>
              {currentJob.model_used && <span className="model-badge tailored-model-badge">{currentJob.model_used}</span>}
            </div>
            <div className="resume-panel-actions">
              {currentJob.keywords && (
                <span className="kw-match-badge" title="Keywords matched in resume">
                  <span>{kwMatchCount ?? "—"}</span>&thinsp;/&thinsp;{currentJob.keywords.split(",").length} kw
                </span>
              )}
              {currentJob.resume_path && <a href={`/api/download/${currentJob.id}`} className="btn-download">↓ PDF</a>}
              <form onSubmit={handleRetailor} className="retailor-form-inline">
                <select name="model" className="model-select-inline" title="Choose LLM model">
                  {Object.entries(availableModels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <button type="submit" className="btn-retailor" disabled={isTailoring}>⟳ Re-tailor</button>
              </form>
            </div>
          </div>
          <div className="resume-body">
            {isTailoring ? (
              <>
                <div>
                  {[55, 80, 70, 65, 90, 50, 75, 60].map((w, i) => <div key={i} className="skeleton-line" style={{ width: `${w}%` }} />)}
                </div>
                <div className="resume-tailoring-msg">
                  <div className="spinner" style={{ display: "inline-block", width: "18px", height: "18px", marginRight: "8px", verticalAlign: "middle" }} />
                  Tailoring resume… this takes about 30–60 seconds.
                </div>
              </>
            ) : !currentJob.resume_path ? (
              <div className="resume-not-tailored">
                <div className="resume-not-tailored-icon">◈</div>
                <div className="resume-not-tailored-msg">Resume not tailored yet</div>
                <div className="resume-not-tailored-hint">Select a model above and click Re-tailor to generate your tailored resume for this role.</div>
              </div>
            ) : resumeError ? (
              <p className="empty-note">Could not load resume.</p>
            ) : resumeHtml ? (
              <div className="resume-rendered" ref={resumeRef} dangerouslySetInnerHTML={{ __html: resumeHtml }} />
            ) : (
              <div>
                {[55, 80, 70, 65, 90, 50, 75, 60].map((w, i) => <div key={i} className="skeleton-line" style={{ width: `${w}%` }} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="review-actions">
        <form method="POST" action={`/api/apply/${currentJob.id}`}>
          <button type="submit" className="btn-apply">✓ Apply Now</button>
        </form>
        <form method="POST" action={`/api/discard/${currentJob.id}`}>
          <button type="submit" className="btn-discard">✗ Discard</button>
        </form>
        <a href="/" className="btn-back-dash">Back to Dashboard</a>
      </div>
    </div>
  );
}
