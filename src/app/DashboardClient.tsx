"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  resolveCampaignAction,
  resolveCampaignButtonLabel,
  resolveCampaignButtonClass,
} from "@/lib/campaign-ui";

type FilterMode = "all" | "easy" | "manual" | "tailored" | "untailored";

interface DashboardProps {
  stats: { applied: number; manual: number; status: string };
  linkedinConnected: boolean;
  resumeName: string | null | undefined;
  pendingJobs: Record<string, any>[];
  applications: Record<string, any>[];
  campaigns: Record<string, any>[];
  alert: string | null;
}

export default function DashboardClient({
  stats,
  linkedinConnected: initialLinkedIn,
  resumeName,
  pendingJobs,
  applications,
  campaigns,
  alert: initialAlert,
}: DashboardProps) {
  const [statusText, setStatusText] = useState("Starting up…");
  const [isRunning, setIsRunning] = useState(stats.status === "running");
  const [liConnected, setLiConnected] = useState(initialLinkedIn);
  const [liConnecting, setLiConnecting] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState("fit-desc");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(20);
  const [appsPage, setAppsPage] = useState(1);
  const [appsPageSize, setAppsPageSize] = useState(20);
  const [fitModalJob, setFitModalJob] = useState<Record<string, any> | null>(null);
  const lastPendingCount = useRef(pendingJobs.length);

  // Poll status
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/status")
        .then((r) => r.json())
        .then((data) => {
          const running = data.status && data.status !== "Idle";
          setIsRunning(running);
          if (running) setStatusText(data.status);
          if (data.pending_count !== undefined && data.pending_count !== lastPendingCount.current) {
            lastPendingCount.current = data.pending_count;
            location.reload();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Keep retrying fit analysis until every pending job has both a score
  // and a rationale, regardless of whether a campaign is running.
  // When the LLM is rate-limited we back off until past `retryAt` instead
  // of hammering the API every 30 s and racking up 429s.
  const [llmRateLimited, setLlmRateLimited] = useState<{ retryAt: number; message: string } | null>(null);

  useEffect(() => {
    const hasStale = pendingJobs.some(
      (j) => j.fit_score === null || j.fit_score === undefined || !j.fit_summary
    );
    if (!hasStale) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const status = await fetch("/api/retry-fit").then((r) => r.json());
        if (status.rateLimited) {
          setLlmRateLimited({ retryAt: status.retryAt, message: status.message });
          return; // don't fire POST while the API is hard-blocked
        }
        setLlmRateLimited(null);
        const res = await fetch("/api/retry-fit", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (body?.reason === "rate_limited") {
          setLlmRateLimited({ retryAt: body.retryAt, message: body.message });
        }
      } catch {
        // ignore — try again next tick
      }
    };

    tick();
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pendingJobs]);

  // Animated stat counter
  const StatNumber = ({ target }: { target: number }) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!ref.current || target === 0) return;
      const dur = 700;
      const start = performance.now();
      function tick(ts: number) {
        const p = Math.min((ts - start) / dur, 1);
        if (ref.current) ref.current.textContent = String(Math.round((1 - Math.pow(1 - p, 2)) * target));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, [target]);
    return <div className="stat-number" ref={ref}>{target === 0 ? "0" : "0"}</div>;
  };

  const connectLinkedIn = () => {
    setLiConnecting(true);
    fetch("/api/linkedin-connect", { method: "POST" }).then(() => {
      const check = setInterval(() => {
        fetch("/api/linkedin-status")
          .then((r) => r.json())
          .then((d) => {
            if (d.connected) {
              clearInterval(check);
              setLiConnected(true);
              setLiConnecting(false);
            }
          });
      }, 2000);
    });
  };

  // Sort pending jobs
  const sortedPending = [...pendingJobs].sort((a, b) => {
    if (sortMode === "fit-desc") return (b.fit_score || 0) - (a.fit_score || 0);
    if (sortMode === "fit-asc") return (a.fit_score || 0) - (b.fit_score || 0);
    if (sortMode === "newest") return (b.created_at || "").localeCompare(a.created_at || "");
    if (sortMode === "model") return (a.model_used || "").localeCompare(b.model_used || "");
    return 0;
  });

  // Filter pending jobs
  const filteredPending = sortedPending.filter((j) => {
    if (filterMode === "all") return true;
    if (filterMode === "easy") return !!j.easy_apply;
    if (filterMode === "manual") return !j.easy_apply;
    if (filterMode === "tailored") return !!j.resume_path;
    if (filterMode === "untailored") return !j.resume_path;
    return true;
  });

  const pendingEasyCount = pendingJobs.filter((j) => j.easy_apply).length;
  const pendingManualCount = pendingJobs.length - pendingEasyCount;

  // Paginate
  const pendingTotalPages = Math.max(1, Math.ceil(filteredPending.length / pendingPageSize));
  const pendingSlice = filteredPending.slice((pendingPage - 1) * pendingPageSize, pendingPage * pendingPageSize);

  const appsTotalPages = Math.max(1, Math.ceil(applications.length / appsPageSize));
  const appsSlice = applications.slice((appsPage - 1) * appsPageSize, appsPage * appsPageSize);

  const toggleJob = (id: number) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedJobs.size === filteredPending.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(filteredPending.map((j) => j.id)));
    }
  };

  const scoreClass = (score: number) => (score >= 70 ? "high" : score >= 40 ? "medium" : "low");

  return (
    <div className="container">
      {/* Hero Top Bar */}
      <div className="topbar topbar--hero">
        <div className="topbar-brand">
          <h1>JobBot</h1>
          <span className={`status-dot ${isRunning ? "running" : ""}`} title={stats.status} />
        </div>
        <div className="topbar-actions">
          <span className={`li-pill ${liConnected ? "li-pill--on" : "li-pill--off"}`}>
            <span className="li-pill-dot" />
            <span>{liConnected ? "LinkedIn connected" : liConnecting ? "Log in & close Chrome window…" : "LinkedIn disconnected"}</span>
            {!liConnected && !liConnecting && (
              <button onClick={connectLinkedIn} className="li-pill-btn">Connect</button>
            )}
          </span>
          <a href="/settings" className="icon-link">⚙ Settings</a>
        </div>
      </div>

      {/* Resume subtitle */}
      {resumeName ? (
        <p className="subtitle">Resume: <strong>{resumeName}</strong> · <a href="/settings">change</a></p>
      ) : (
        <p className="subtitle-warn">⚠ No resume uploaded — <a href="/settings" style={{ color: "var(--clr-danger)" }}>add one in Settings</a></p>
      )}

      {/* Alert */}
      {initialAlert && <div className="alert alert-warning">⚠ {initialAlert}</div>}
      {llmRateLimited && llmRateLimited.retryAt > Date.now() && (
        <div className="alert alert-warning">
          ⚠ LLM rate-limited — fit analysis paused until{" "}
          {new Date(llmRateLimited.retryAt).toLocaleTimeString()}. Upgrade your
          Groq tier or wait for the daily window to reset.
        </div>
      )}

      {/* Live Activity Bar */}
      <div className={`activity-bar ${isRunning ? "visible" : ""}`}>
        <div className="spinner" />
        <span>{statusText}</span>
      </div>

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon applied">✓</div>
          <div className="stat-body">
            <StatNumber target={stats.applied} />
            <div className="stat-label">Applied</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon manual">⚠</div>
          <div className="stat-body">
            <StatNumber target={stats.manual} />
            <div className="stat-label">Manual Apply</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon status">●</div>
          <div className="stat-body">
            <div className={`stat-number ${isRunning ? "running" : ""}`}>{stats.status.toUpperCase()}</div>
            <div className="stat-label">Campaign Status</div>
          </div>
        </div>
      </div>

      {/* Campaign Controls */}
      <div className="campaign-card">
        <div className="campaign-card-title">New Campaign</div>
        <form method="POST" action={resolveCampaignAction(isRunning)}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="titles">Job Titles <span>(comma separated)</span></label>
              <input className="form-input" type="text" id="titles" name="titles" placeholder="Product Manager, Ops Manager" required={!isRunning} disabled={isRunning} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="location_text">Location</label>
              <input className="form-input" type="text" id="location_text" name="location_text" placeholder="City, Country or Remote" disabled={isRunning} />
            </div>
          </div>

          <div className="filter-row">
            <div className="filter-group">
              <div className="filter-label">Work Type</div>
              <div className="chip-group">
                <input type="checkbox" id="wt1" name="work_type" value="1" disabled={isRunning} />
                <label htmlFor="wt1">On-site</label>
                <input type="checkbox" id="wt2" name="work_type" value="2" defaultChecked disabled={isRunning} />
                <label htmlFor="wt2">Remote</label>
                <input type="checkbox" id="wt3" name="work_type" value="3" defaultChecked disabled={isRunning} />
                <label htmlFor="wt3">Hybrid</label>
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-label">Experience Level</div>
              <div className="chip-group">
                {[{ id: "el1", val: "1", label: "Internship" }, { id: "el2", val: "2", label: "Entry" }, { id: "el3", val: "3", label: "Associate" }, { id: "el4", val: "4", label: "Mid-Senior", checked: true }, { id: "el5", val: "5", label: "Director" }, { id: "el6", val: "6", label: "Executive" }].map((el) => (
                  <span key={el.id}>
                    <input type="checkbox" id={el.id} name="exp_level" value={el.val} defaultChecked={el.checked} disabled={isRunning} />
                    <label htmlFor={el.id}>{el.label}</label>
                  </span>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-label">Date Posted</div>
              <select className="form-select" name="date_posted" defaultValue="r604800" disabled={isRunning}>
                <option value="">Any time</option>
                <option value="r86400">Past 24 hours</option>
                <option value="r604800">Past week</option>
                <option value="r2592000">Past month</option>
              </select>
            </div>
          </div>

          <div className="campaign-actions">
            <button type="submit" className={resolveCampaignButtonClass(isRunning)}>
              {resolveCampaignButtonLabel(isRunning)}
            </button>
            <span className="campaign-hint">
              {isRunning ? "Campaign is running — stop to reconfigure" : "Max 20 applications per session"}
            </span>
          </div>
        </form>
      </div>

      {/* Pending Review */}
      {pendingJobs.length > 0 && (
        <>
          <div className="section-title section-title--pending">
            Pending Review
            <span className="section-badge">{pendingJobs.length}</span>
          </div>

          <div className="jobs-controls">
            <div className="ctrl-group">
              <span className="control-label">Sort</span>
              {(["fit-desc", "fit-asc", "newest", "model"] as const).map((mode) => (
                <button key={mode} className={`sort-btn ${sortMode === mode ? "active" : ""}`} onClick={() => { setSortMode(mode); setPendingPage(1); }}>
                  {mode === "fit-desc" ? "Fit ↓" : mode === "fit-asc" ? "Fit ↑" : mode === "newest" ? "Newest" : "AI Model"}
                </button>
              ))}
            </div>
            <div className="ctrl-group">
              <span className="control-label">Apply</span>
              {(["all", "easy", "manual"] as const).map((mode) => {
                const count = mode === "all" ? pendingJobs.length : mode === "easy" ? pendingEasyCount : pendingManualCount;
                const label = mode === "all" ? "All" : mode === "easy" ? "⚡ Easy" : "↗ Manual";
                return (
                  <button
                    key={mode}
                    className={`filter-btn filter-btn--${mode} ${filterMode === mode ? "active" : ""}`}
                    onClick={() => { setFilterMode(mode); setPendingPage(1); }}
                  >
                    {label}
                    <span className="filter-btn-count">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="ctrl-group">
              <span className="control-label">Tailor</span>
              {(["tailored", "untailored"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`filter-btn ${filterMode === mode ? "active" : ""}`}
                  onClick={() => { setFilterMode(mode); setPendingPage(1); }}
                >
                  {mode === "tailored" ? "Tailored" : "Not Tailored"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="card-list pending-list">
              {pendingSlice.map((job) => {
                const fs = job.fit_score || 0;
                const fsClass = scoreClass(fs);
                const tail = job.ats_score || 0;
                const tailClass = scoreClass(tail);
                const orig = job.original_ats_score || 0;
                const origClass = scoreClass(orig);
                const isTailored = !!job.resume_path;

                return (
                  <div key={job.id} className="app-card app-card--pending" data-fit={fs} data-model={job.model_used || ""} data-tailored={isTailored ? "1" : "0"} data-created={job.created_at || ""}>
                    <label className="job-checkbox-wrap" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" name="job_ids" value={job.id} className="job-checkbox" checked={selectedJobs.has(job.id)} onChange={() => toggleJob(job.id)} />
                      <span className="job-checkbox-box" />
                    </label>
                    <a className="app-card-inner" href={`/review/${job.id}`}>
                      <div className="app-card-body">
                        <div className="app-card-title">{job.title}</div>
                        <div className="app-card-meta">
                          <span className="app-card-meta-text">{job.company}{job.location ? ` · ${job.location}` : ""}</span>
                          <span className={`apply-badge apply-badge--${job.easy_apply ? "easy" : "manual"}`}>
                            {job.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
                          </span>
                        </div>
                        {fs ? (
                          <div className="app-card-fit">
                            <span className={`fit-badge fit-badge--${fsClass}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFitModalJob(job); }}>
                              {fs}% fit
                            </span>
                            {job.verdict && <span className="fit-verdict-snippet">{job.verdict.slice(0, 70)}</span>}
                          </div>
                        ) : (
                          <div className="app-card-verdict" style={{ color: "var(--clr-text-muted)", fontSize: "11px" }}>⏳ Analyzing fit…</div>
                        )}
                        <div className="app-card-tailor-status" style={{ marginTop: "6px" }}>
                          {isTailored ? (
                            <span className="tailored-model-badge">✓ {job.model_used}</span>
                          ) : (
                            <span className="untailored-badge">Not tailored</span>
                          )}
                        </div>
                      </div>
                      <div className="app-card-right">
                        {tail > 0 && (
                          <div className="ats-dual-mini">
                            <div className="ats-dual-row">
                              <span className="ats-dual-label">Before</span>
                              <div className="ats-bar-wrap ats-bar-wrap--sm">
                                <div className={`ats-bar-fill ${origClass}`} style={{ width: `${orig}%` }} />
                              </div>
                              <span className={`ats-dual-pct ats-dual-pct--${origClass}`}>{orig}%</span>
                            </div>
                            <div className="ats-dual-row">
                              <span className="ats-dual-label">After</span>
                              <div className="ats-bar-wrap ats-bar-wrap--sm">
                                <div className={`ats-bar-fill ${tailClass}`} style={{ width: `${tail}%` }} />
                              </div>
                              <span className={`ats-dual-pct ats-dual-pct--${tailClass}`}>{tail}%</span>
                            </div>
                          </div>
                        )}
                        <span className="badge badge-pending">Review →</span>
                      </div>
                    </a>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="pagination-bar">
              <span className="page-size-label">Show</span>
              {[20, 40, 60].map((n) => (
                <button key={n} type="button" className={`page-size-btn ${pendingPageSize === n ? "active" : ""}`} onClick={() => { setPendingPageSize(n); setPendingPage(1); }}>{n}</button>
              ))}
              <div className="page-nav">
                <button type="button" className="prev-btn" disabled={pendingPage <= 1} onClick={() => setPendingPage((p) => p - 1)}>‹</button>
                <span className="page-indicator">{pendingPage} / {pendingTotalPages}</span>
                <button type="button" className="next-btn" disabled={pendingPage >= pendingTotalPages} onClick={() => setPendingPage((p) => p + 1)}>›</button>
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedJobs.size > 0 && (
              <div className="bulk-bar" style={{ display: "flex" }}>
                <span className="bulk-bar-count">{selectedJobs.size} selected</span>
                <button type="button" className="bulk-bar-btn bulk-bar-btn--select-all" onClick={toggleSelectAll}>Select All</button>
                <button type="button" className="bulk-bar-btn bulk-bar-btn--discard" onClick={() => {
                  const body = new FormData();
                  selectedJobs.forEach((id) => body.append("job_ids", String(id)));
                  fetch("/api/bulk-discard", { method: "POST", body }).then(() => location.reload());
                }}>Discard Selected</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Applications */}
      <div className="section-title">Applications</div>
      <div className="card-list">
        {appsSlice.length > 0 ? appsSlice.map((app) => {
          const score = app.ats_score || 0;
          const sc = scoreClass(score);
          return (
            <a key={app.id} className="app-card" href={`/application/${app.id}`}>
              <div className="app-card-body">
                <div className="app-card-title">{app.title}</div>
                <div className="app-card-meta">
                  <span className="app-card-meta-text">{app.company}{app.location ? ` · ${app.location}` : ""}</span>
                  <span className={`apply-badge apply-badge--${app.easy_apply ? "easy" : "manual"}`}>
                    {app.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
                  </span>
                </div>
              </div>
              <div className="app-card-right">
                {app.ats_score > 0 && (
                  <div className="ats-mini">
                    <span className="ats-mini-label">ATS {app.ats_score}%</span>
                    <div className="ats-bar-wrap">
                      <div className={`ats-bar-fill ${sc}`} style={{ width: `${app.ats_score}%` }} />
                    </div>
                  </div>
                )}
                <span className={`badge badge-${app.status}`}>
                  {app.status === "applied" ? "✓ Applied" : app.status === "failed" ? "✗ Failed" : app.status}
                </span>
              </div>
            </a>
          );
        }) : (
          <div className="empty-state empty-state--illustrated">
            <div className="empty-state-art">
              <div className="empty-state-bot">🤖</div>
              <div className="empty-state-sparkles">✨</div>
            </div>
            <div className="empty-state-text">No applications yet</div>
            <div className="empty-state-hint">Fill in your job titles above and hit Start — JobBot will find and queue applications for you to review.</div>
          </div>
        )}
      </div>

      {/* Applications pagination */}
      {applications.length > 0 && (
        <div className="pagination-bar">
          <span className="page-size-label">Show</span>
          {[20, 40, 60].map((n) => (
            <button key={n} className={`page-size-btn ${appsPageSize === n ? "active" : ""}`} onClick={() => { setAppsPageSize(n); setAppsPage(1); }}>{n}</button>
          ))}
          <div className="page-nav">
            <button className="prev-btn" disabled={appsPage <= 1} onClick={() => setAppsPage((p) => p - 1)}>‹</button>
            <span className="page-indicator">{appsPage} / {appsTotalPages}</span>
            <button className="next-btn" disabled={appsPage >= appsTotalPages} onClick={() => setAppsPage((p) => p + 1)}>›</button>
          </div>
        </div>
      )}

      {/* Campaign History */}
      {campaigns.length > 0 && (
        <details className="campaign-history">
          <summary className="campaign-history-summary">Campaign History <span className="section-badge">{campaigns.length}</span></summary>
          <div className="campaign-history-list">
            {campaigns.map((c) => (
              <div key={c.id} className="campaign-row">
                <div className="campaign-row-body">
                  <div className="campaign-row-name">{c.titles}</div>
                  <div className="campaign-row-meta">
                    {c.started_at?.slice(0, 10)}
                    {c.locations && c.locations !== "None" ? ` · ${c.locations}` : ""}
                  </div>
                </div>
                <div className="campaign-row-stats">
                  <span className="campaign-stat campaign-stat--applied">✓ {c.applied_count || 0}</span>
                  <span className="campaign-stat campaign-stat--pending">⏳ {c.pending_count || 0}</span>
                  <span className="campaign-stat campaign-stat--discarded">✗ {c.discarded_count || 0}</span>
                  <span className={`campaign-badge campaign-badge--${c.status}`}>{c.status}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Fit Breakdown Modal */}
      {fitModalJob && (
        <div id="fit-modal" className="open" role="dialog" aria-modal="true">
          <div className="fit-modal-overlay" onClick={() => setFitModalJob(null)} />
          <div className="fit-modal-content">
            <div className="fit-modal-header">
              <div>
                <div className="fit-modal-title">Fit Analysis</div>
                <div className="fit-modal-job">{fitModalJob.title}{fitModalJob.company ? ` · ${fitModalJob.company}` : ""}</div>
              </div>
              <button className="fit-modal-close" onClick={() => setFitModalJob(null)} aria-label="Close">✕</button>
            </div>
            <div className="fit-modal-body">
              <div className="fit-modal-score-col">
                <div className="fit-modal-score-ring">
                  <svg viewBox="0 0 48 48">
                    <circle className="ats-ring-bg" cx="24" cy="24" r="20" />
                    <circle className={`ats-ring-fill ${scoreClass(fitModalJob.fit_score || 0)}`} cx="24" cy="24" r="20"
                      strokeDasharray={`${Math.max(((fitModalJob.fit_score || 0) / 100) * 125.66, 2)} ${125.66 - Math.max(((fitModalJob.fit_score || 0) / 100) * 125.66, 2)}`}
                      strokeDashoffset="31.415" />
                  </svg>
                  <div className="fit-modal-score-num">
                    <span className="score-val">{fitModalJob.fit_score || "—"}</span>
                    <span className="score-unit">FIT</span>
                  </div>
                </div>
              </div>
              <div className="fit-modal-data">
                {fitModalJob.fit_strengths?.length > 0 && (
                  <div>
                    <div className="fit-modal-section-label">Strengths</div>
                    <div>{fitModalJob.fit_strengths.map((s: string, i: number) => <span key={i} className="fit-chip-strength">● {s}</span>)}</div>
                  </div>
                )}
                {fitModalJob.fit_gaps?.length > 0 && fitModalJob.fit_gaps[0] !== "None" && (
                  <div>
                    <div className="fit-modal-section-label">Gaps</div>
                    <div>{fitModalJob.fit_gaps.map((g: string, i: number) => <span key={i} className="fit-chip-gap">✗ {g}</span>)}</div>
                  </div>
                )}
                {fitModalJob.verdict && (
                  <div>
                    <div className="fit-modal-section-label">Verdict</div>
                    <div className="fit-modal-verdict">{fitModalJob.verdict}</div>
                  </div>
                )}
              </div>
            </div>
            {fitModalJob.keywords && (
              <div className="fit-modal-footer">
                <div className="fit-modal-section-label">JD Keywords</div>
                <div className="fit-keywords-row">
                  {fitModalJob.keywords.split(",").map((k: string, i: number) => k.trim() && <span key={i} className="fit-kw-chip">{k.trim()}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
