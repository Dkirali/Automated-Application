"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { resolveCampaignAction, resolveCampaignButtonLabel } from "@/lib/campaign-ui";
import { gaugeLevel } from "@/lib/usage-ui";
import {
  Badge,
  BottomNavPill,
  Button,
  Card,
  Field,
  ProgressBar,
  SectionTitle,
  StatCard,
  TopNav,
} from "@/components/ui";
import { cn } from "@/lib/cn";

type FilterMode = "all" | "easy" | "manual" | "tailored" | "untailored";

interface UsageState {
  tokens: number;
  dailyLimit: number;
  pct: number;
  warn: boolean;
  rateLimited: boolean;
  retryAt: number;
  resetAt?: number;
  error?: boolean;
}

// "in 3h 12m" / "in 4m" — coarse countdown to the daily-quota reset.
function formatResetIn(target: number, now: number): string {
  const ms = target - now;
  if (ms <= 0) return "soon";
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

interface DashboardProps {
  stats: { applied: number; manual: number; easy: number; status: string };
  linkedinConnected: boolean;
  resumeName: string | null | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pendingJobs: Record<string, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applications: Record<string, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaigns: Record<string, any>[];
  alert: string | null;
}

// Score → tone used for fit / ATS colouring.
function scoreTone(score: number): "green" | "accent" {
  return score >= 70 ? "green" : "accent";
}

// Small labelled before/after ATS bar used on pending cards.
function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[10px] font-bold uppercase tracking-[0.04em] text-muted">
        {label}
      </span>
      <div className="h-[6px] w-20 overflow-hidden rounded bg-track">
        <div
          className={cn(
            "h-full rounded",
            value >= 70 ? "bg-green-strong" : "bg-accent",
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span
        className={cn(
          "w-9 text-right text-[11px] font-semibold",
          value >= 70 ? "text-green" : "text-accent",
        )}
      >
        {value}%
      </span>
    </div>
  );
}

// Checkbox styled as a Faran pill chip (works inside a native form).
function CheckChip({
  id,
  name,
  value,
  label,
  defaultChecked,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex">
      <input
        type="checkbox"
        id={id}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className="cursor-pointer select-none rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:border-ink/40 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-cream peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
      >
        {label}
      </label>
    </span>
  );
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fitModalJob, setFitModalJob] = useState<Record<string, any> | null>(null);
  const lastPendingCount = useRef(pendingJobs.length);
  const lastAnalyzedCount = useRef(
    pendingJobs.filter(
      (j) =>
        j.fit_score !== null && j.fit_score !== undefined && !!j.fit_summary
    ).length
  );

  const [usage, setUsage] = useState<UsageState | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const warnedRef = useRef(false);

  const enableAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setAlertsEnabled(perm === "granted");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const u: UsageState = await fetch("/api/usage").then((r) => r.json());
        if (cancelled) return;
        setUsage(u);
        if (u.warn && !warnedRef.current) {
          warnedRef.current = true;
          if (
            alertsEnabled &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification("JobBot", {
              body: `${Math.round(u.pct * 100)}% of your daily ${u.dailyLimit.toLocaleString()} token limit used.`,
            });
          }
        }
        if (!u.warn) warnedRef.current = false;
      } catch {
        // retry next tick
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [alertsEnabled]);

  // Prefill the campaign titles from a Resume-doctor "Use in campaign" handoff (?titles=).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("titles");
    if (!t) return;
    const el = document.getElementById("titles") as HTMLInputElement | null;
    if (el) {
      el.value = t;
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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
          // Auto-refresh when fit analysis completes for already-listed jobs.
          if (
            data.analyzed_count !== undefined &&
            data.analyzed_count !== lastAnalyzedCount.current
          ) {
            lastAnalyzedCount.current = data.analyzed_count;
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

  // Animated count-up number, rendered inside a StatCard.
  const AnimatedCount = ({ target }: { target: number }) => {
    const ref = useRef<HTMLSpanElement>(null);
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
    return <span ref={ref}>0</span>;
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

  const usageLevel = usage ? gaugeLevel(usage.pct, usage.rateLimited) : "ok";

  return (
    <div className="min-h-screen bg-cream pb-28">
      <TopNav>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold",
            liConnected ? "bg-badge-green text-green" : "bg-white/10 text-cream",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              liConnected ? "bg-green-strong" : "bg-faint",
            )}
          />
          <span>
            {liConnected
              ? "LinkedIn connected"
              : liConnecting
                ? "Log in & close Chrome…"
                : "LinkedIn disconnected"}
          </span>
          {!liConnected && !liConnecting && (
            <button
              onClick={connectLinkedIn}
              className="ml-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white"
            >
              Connect
            </button>
          )}
        </span>
        <Link href="/resume" className="text-cream hover:no-underline hover:opacity-80">
          Resume
        </Link>
        <Link href="/tracker" className="text-cream hover:no-underline hover:opacity-80">
          Tracker
        </Link>
        <Link href="/settings" className="text-cream hover:no-underline hover:opacity-80">
          Settings
        </Link>
      </TopNav>

      <main className="mx-auto max-w-[1080px] px-6 py-9 md:px-10">
        {/* Greeting + resume line */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-[30px] font-semibold text-ink">
            Your job search
          </h1>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                isRunning ? "bg-green-strong" : "bg-faint",
              )}
              title={stats.status}
            />
            <span className="text-[13px] font-semibold text-muted">
              {isRunning ? "Search running" : "Search idle"}
            </span>
          </span>
        </div>

        {resumeName ? (
          <p className="mb-6 text-[13px] text-muted">
            Resume: <strong className="text-ink">{resumeName}</strong> ·{" "}
            <Link href="/settings">change</Link>
          </p>
        ) : (
          <p className="mb-6 text-[13px] text-accent-strong">
            ⚠ No resume uploaded —{" "}
            <Link href="/settings" className="text-accent-strong underline">
              add one in Settings
            </Link>
          </p>
        )}

        {/* Alerts */}
        {initialAlert && (
          <div className="mb-4 rounded-xl border border-danger-line bg-badge-orange px-4 py-3 text-[13px] text-accent-strong">
            ⚠ {initialAlert}
          </div>
        )}
        {llmRateLimited && llmRateLimited.retryAt > Date.now() && (
          <div className="mb-4 rounded-xl border border-danger-line bg-badge-orange px-4 py-3 text-[13px] text-accent-strong">
            ⚠ LLM rate-limited — fit analysis paused until{" "}
            {new Date(llmRateLimited.retryAt).toLocaleTimeString()}. Upgrade your
            Groq tier or wait for the daily window to reset.
          </div>
        )}

        {/* Live activity bar */}
        {isRunning && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
            <span className="text-[13px] font-medium text-ink">{statusText}</span>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Applied" value={<AnimatedCount target={stats.applied} />} />
          <StatCard label="Easy Apply" value={<AnimatedCount target={stats.easy} />} />
          <StatCard label="Manual Apply" value={<AnimatedCount target={stats.manual} />} />
          <StatCard
            label="Campaign Status"
            value={
              <span className="text-[22px]">
                {stats.status.charAt(0).toUpperCase() + stats.status.slice(1)}
              </span>
            }
          />
        </div>

        {/* Daily API usage gauge */}
        {usage && (
          <Card className="mb-6">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="font-semibold text-ink">
                Daily API usage{" "}
                <span className="font-normal text-muted">
                  ({usage.tokens.toLocaleString()} /{" "}
                  {usage.dailyLimit.toLocaleString()} tokens)
                </span>
              </span>
              <span className="font-semibold text-ink">
                {Math.round(usage.pct * 100)}%
              </span>
            </div>
            <ProgressBar
              value={Math.min(usage.pct * 100, 100)}
              tone={usageLevel === "ok" ? "green" : "accent"}
            />
            {usage.rateLimited && usage.retryAt > Date.now() && (
              <p className="mt-2 text-[12px] text-accent-strong">
                ⚠ Rate-limited — runs auto-stopped. Resets{" "}
                {formatResetIn(usage.retryAt, Date.now())} (~
                {new Date(usage.retryAt).toLocaleTimeString()}).
              </p>
            )}
            {typeof window !== "undefined" &&
              "Notification" in window &&
              !alertsEnabled && (
                <button
                  type="button"
                  className="mt-2 text-[12px] font-semibold text-accent hover:underline"
                  onClick={enableAlerts}
                >
                  Enable alerts
                </button>
              )}
          </Card>
        )}

        {/* Campaign controls */}
        <Card className="mb-8">
          <SectionTitle as="label" className="mb-4">
            New campaign
          </SectionTitle>
          <form method="POST" action={resolveCampaignAction(isRunning)}>
            <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                id="titles"
                name="titles"
                label={
                  <>
                    Job titles{" "}
                    <span className="font-normal text-muted">(comma separated)</span>
                  </>
                }
                placeholder="Product Manager, Ops Manager"
                required={!isRunning}
                disabled={isRunning}
              />
              <Field
                id="location_text"
                name="location_text"
                label="Location"
                placeholder="City, Country or Remote"
                disabled={isRunning}
              />
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                  Work type
                </div>
                <div className="flex flex-wrap gap-2">
                  <CheckChip id="wt1" name="work_type" value="1" label="On-site" disabled={isRunning} />
                  <CheckChip id="wt2" name="work_type" value="2" label="Remote" defaultChecked disabled={isRunning} />
                  <CheckChip id="wt3" name="work_type" value="3" label="Hybrid" defaultChecked disabled={isRunning} />
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                  Experience level
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "el1", val: "1", label: "Internship" },
                    { id: "el2", val: "2", label: "Entry" },
                    { id: "el3", val: "3", label: "Associate" },
                    { id: "el4", val: "4", label: "Mid-Senior", checked: true },
                    { id: "el7", val: "5", label: "Senior Manager" },
                    { id: "el5", val: "5", label: "Director" },
                    { id: "el6", val: "6", label: "Executive" },
                  ].map((el) => (
                    <CheckChip
                      key={el.id}
                      id={el.id}
                      name="exp_level"
                      value={el.val}
                      label={el.label}
                      defaultChecked={el.checked}
                      disabled={isRunning}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                  Employment type
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "jt1", val: "F", label: "Full-time", checked: true },
                    { id: "jt2", val: "P", label: "Part-time" },
                    { id: "jt3", val: "C", label: "Contract" },
                    { id: "jt4", val: "I", label: "Internship" },
                    { id: "jt5", val: "V", label: "Volunteer" },
                  ].map((jt) => (
                    <CheckChip
                      key={jt.id}
                      id={jt.id}
                      name="job_type"
                      value={jt.val}
                      label={jt.label}
                      defaultChecked={jt.checked}
                      disabled={isRunning}
                    />
                  ))}
                </div>
              </div>
              <div className="max-w-xs">
                <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                  Date posted
                </div>
                <select
                  className="w-full rounded-field border-[1.5px] border-line bg-card px-3.5 py-2.5 text-[14px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                  name="date_posted"
                  defaultValue="r604800"
                  disabled={isRunning}
                >
                  <option value="">Any time</option>
                  <option value="r86400">Past 24 hours</option>
                  <option value="r604800">Past week</option>
                  <option value="r2592000">Past month</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-4">
              <Button type="submit" variant={isRunning ? "danger" : "accent"}>
                {resolveCampaignButtonLabel(isRunning)}
              </Button>
              <span className="text-[12px] text-muted">
                {isRunning
                  ? "Campaign is running — stop to reconfigure"
                  : "Max 20 applications per session"}
              </span>
            </div>
          </form>
        </Card>

        {/* Pending review */}
        {pendingJobs.length > 0 && (
          <section className="mb-8">
            <SectionTitle
              className="mb-4"
              aside={<Badge tone="orange">{pendingJobs.length}</Badge>}
            >
              Awaiting your review
            </SectionTitle>

            {/* Sort + filter controls */}
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              <ControlGroup label="Sort">
                {(["fit-desc", "fit-asc", "newest", "model"] as const).map((mode) => (
                  <ToggleBtn
                    key={mode}
                    active={sortMode === mode}
                    onClick={() => {
                      setSortMode(mode);
                      setPendingPage(1);
                    }}
                  >
                    {mode === "fit-desc"
                      ? "Fit ↓"
                      : mode === "fit-asc"
                        ? "Fit ↑"
                        : mode === "newest"
                          ? "Newest"
                          : "AI Model"}
                  </ToggleBtn>
                ))}
              </ControlGroup>
              <ControlGroup label="Apply">
                {(["all", "easy", "manual"] as const).map((mode) => {
                  const count =
                    mode === "all"
                      ? pendingJobs.length
                      : mode === "easy"
                        ? pendingEasyCount
                        : pendingManualCount;
                  const label = mode === "all" ? "All" : mode === "easy" ? "⚡ Easy" : "↗ Manual";
                  return (
                    <ToggleBtn
                      key={mode}
                      active={filterMode === mode}
                      onClick={() => {
                        setFilterMode(mode);
                        setPendingPage(1);
                      }}
                    >
                      {label}
                      <span className="ml-1 opacity-70">{count}</span>
                    </ToggleBtn>
                  );
                })}
              </ControlGroup>
              <ControlGroup label="Tailor">
                {(["tailored", "untailored"] as const).map((mode) => (
                  <ToggleBtn
                    key={mode}
                    active={filterMode === mode}
                    onClick={() => {
                      setFilterMode(mode);
                      setPendingPage(1);
                    }}
                  >
                    {mode === "tailored" ? "Tailored" : "Not Tailored"}
                  </ToggleBtn>
                ))}
              </ControlGroup>
            </div>

            {/* Job cards */}
            <div className="flex flex-col gap-3">
              {pendingSlice.map((job) => {
                const fs = job.fit_score || 0;
                const tail = job.ats_score || 0;
                const orig = job.original_ats_score || 0;
                const isTailored = !!job.resume_path;

                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-4 rounded-card border border-line bg-card px-4 py-4"
                  >
                    <label
                      className="flex cursor-pointer items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        name="job_ids"
                        value={job.id}
                        className="h-[18px] w-[18px] cursor-pointer rounded-[5px] border-[1.5px] border-line accent-accent"
                        checked={selectedJobs.has(job.id)}
                        onChange={() => toggleJob(job.id)}
                      />
                    </label>
                    <Link
                      className="flex flex-1 items-center gap-4 hover:no-underline"
                      href={`/review/${job.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-bold text-ink">{job.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-muted">
                            {job.company}
                            {job.location ? ` · ${job.location}` : ""}
                          </span>
                          <Badge tone={job.easy_apply ? "green" : "orange"}>
                            {job.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {fs ? (
                            <>
                              <button
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-[12px] font-bold",
                                  fs >= 70
                                    ? "bg-badge-green text-green"
                                    : "bg-badge-orange text-accent",
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setFitModalJob(job);
                                }}
                              >
                                {fs}% fit
                              </button>
                              {job.verdict && (
                                <span className="text-[11.5px] italic text-muted">
                                  {job.verdict.slice(0, 70)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-muted">⏳ Analyzing fit…</span>
                          )}
                          {job.status === "tailoring" ? (
                            <Badge tone="neutral">⏳ Tailoring…</Badge>
                          ) : isTailored ? (
                            <Badge tone="green">✓ {job.model_used}</Badge>
                          ) : (
                            <Badge tone="neutral">Not tailored</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {tail > 0 && (
                          <div className="flex flex-col gap-1">
                            <MiniBar label="Before" value={orig} />
                            <MiniBar label="After" value={tail} />
                          </div>
                        )}
                        <span className="text-[13px] font-bold text-accent">
                          Review →
                        </span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <Pagination
              page={pendingPage}
              totalPages={pendingTotalPages}
              pageSize={pendingPageSize}
              onPageSize={(n) => {
                setPendingPageSize(n);
                setPendingPage(1);
              }}
              onPrev={() => setPendingPage((p) => p - 1)}
              onNext={() => setPendingPage((p) => p + 1)}
            />

            {/* Bulk actions */}
            {selectedJobs.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-input px-4 py-3">
                <span className="text-[13px] font-semibold text-ink">
                  {selectedJobs.size} selected
                </span>
                <Button size="sm" variant="outline" onClick={toggleSelectAll}>
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => {
                    const body = new FormData();
                    selectedJobs.forEach((id) => body.append("job_ids", String(id)));
                    fetch("/api/bulk-retailor", { method: "POST", body }).then(() =>
                      location.reload(),
                    );
                  }}
                >
                  Create tailored resume
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    const body = new FormData();
                    selectedJobs.forEach((id) => body.append("job_ids", String(id)));
                    fetch("/api/bulk-discard", { method: "POST", body }).then(() =>
                      location.reload(),
                    );
                  }}
                >
                  Discard selected
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Applications */}
        <SectionTitle className="mb-4">Applications</SectionTitle>
        <div className="flex flex-col gap-3">
          {appsSlice.length > 0 ? (
            appsSlice.map((app) => {
              const score = app.ats_score || 0;
              return (
                <Link
                  key={app.id}
                  className="flex items-center gap-4 rounded-card border border-line bg-card px-4 py-4 hover:no-underline"
                  href={`/application/${app.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-ink">{app.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-muted">
                        {app.company}
                        {app.location ? ` · ${app.location}` : ""}
                      </span>
                      <Badge tone={app.easy_apply ? "green" : "orange"}>
                        {app.easy_apply ? "⚡ Easy Apply" : "↗ Manual Apply"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {score > 0 && (
                      <div className="w-28">
                        <div className="mb-1 text-right text-[11px] font-semibold text-muted">
                          ATS {score}%
                        </div>
                        <ProgressBar value={score} tone={scoreTone(score)} />
                      </div>
                    )}
                    <Badge tone={app.status === "applied" ? "green" : app.status === "failed" ? "orange" : "neutral"}>
                      {app.status === "applied"
                        ? "✓ Applied"
                        : app.status === "failed"
                          ? "✗ Failed"
                          : app.status}
                    </Badge>
                    {app.status === "failed" && (
                      <button
                        type="button"
                        className="rounded-btn border-[1.5px] border-line px-3 py-1.5 text-[12px] font-bold text-ink hover:bg-ink hover:text-cream"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          fetch(`/api/retry-apply/${app.id}`, { method: "POST" }).then(() =>
                            location.reload(),
                          );
                        }}
                      >
                        ↻ Retry
                      </button>
                    )}
                  </div>
                </Link>
              );
            })
          ) : (
            <Card className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="text-[40px]">🤖</div>
              <div className="text-[15px] font-bold text-ink">No applications yet</div>
              <div className="max-w-md text-[13px] text-muted">
                Fill in your job titles above and hit Start — JobBot will find and
                queue applications for you to review.
              </div>
            </Card>
          )}
        </div>

        {applications.length > 0 && (
          <Pagination
            page={appsPage}
            totalPages={appsTotalPages}
            pageSize={appsPageSize}
            onPageSize={(n) => {
              setAppsPageSize(n);
              setAppsPage(1);
            }}
            onPrev={() => setAppsPage((p) => p - 1)}
            onNext={() => setAppsPage((p) => p + 1)}
          />
        )}

        {/* Campaign history */}
        {campaigns.length > 0 && (
          <details className="mt-8 rounded-card border border-line bg-card p-5">
            <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
              Campaign history <Badge tone="neutral">{campaigns.length}</Badge>
            </summary>
            <div className="mt-4 flex flex-col gap-2">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 border-t border-line pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-ink">
                      {c.titles}
                    </div>
                    <div className="text-[12px] text-muted">
                      {c.started_at?.slice(0, 10)}
                      {c.locations && c.locations !== "None" ? ` · ${c.locations}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[12px] font-semibold">
                    <span className="text-green">✓ {c.applied_count || 0}</span>
                    <span className="text-accent">⏳ {c.pending_count || 0}</span>
                    <span className="text-muted">✗ {c.discarded_count || 0}</span>
                    <Badge tone="neutral">{c.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </main>

      <BottomNavPill>
        <PillLink href="/" active>
          Dashboard
        </PillLink>
        <PillLink href="/resume">Resume</PillLink>
        <PillLink href="/tracker">Tracker</PillLink>
        <PillLink href="/settings">Settings</PillLink>
      </BottomNavPill>

      {/* Fit breakdown modal */}
      {fitModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setFitModalJob(null)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-card border border-line bg-card p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-serif text-[21px] font-semibold text-ink">
                  Fit analysis
                </div>
                <div className="text-[13px] text-muted">
                  {fitModalJob.title}
                  {fitModalJob.company ? ` · ${fitModalJob.company}` : ""}
                </div>
              </div>
              <button
                className="text-[18px] text-muted hover:text-ink"
                onClick={() => setFitModalJob(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="font-serif text-[40px] font-semibold text-ink">
                {fitModalJob.fit_score || "—"}
              </div>
              <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                Fit
              </span>
            </div>
            <div className="mt-4 flex flex-col gap-4">
              {fitModalJob.fit_strengths?.length > 0 && (
                <div>
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Strengths
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fitModalJob.fit_strengths.map((s: string, i: number) => (
                      <Badge key={i} tone="green">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {fitModalJob.fit_gaps?.length > 0 && fitModalJob.fit_gaps[0] !== "None" && (
                <div>
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Gaps
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fitModalJob.fit_gaps.map((g: string, i: number) => (
                      <Badge key={i} tone="orange">
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {fitModalJob.verdict && (
                <div>
                  <div className="mb-1 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    Verdict
                  </div>
                  <div className="text-[13px] italic leading-[1.5] text-ink">
                    {fitModalJob.verdict}
                  </div>
                </div>
              )}
              {fitModalJob.keywords && (
                <div className="border-t border-line pt-4">
                  <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    JD keywords
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {fitModalJob.keywords
                      .split(",")
                      .map(
                        (k: string, i: number) =>
                          k.trim() && (
                            <span
                              key={i}
                              className="rounded-md bg-input px-2 py-1 text-[11.5px] text-muted"
                            >
                              {k.trim()}
                            </span>
                          ),
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
        active
          ? "bg-ink text-cream"
          : "border border-line bg-card text-muted hover:border-ink/40",
      )}
    >
      {children}
    </button>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  onPageSize,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-faint">
        Show
      </span>
      {[20, 40, 60].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPageSize(n)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] font-semibold",
            pageSize === n ? "bg-ink text-cream" : "border border-line text-muted",
          )}
        >
          {n}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={onPrev}
          className="rounded-full border border-line px-2.5 py-1 text-muted disabled:opacity-40"
        >
          ‹
        </button>
        <span className="text-[12px] text-muted">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={onNext}
          className="rounded-full border border-line px-2.5 py-1 text-muted disabled:opacity-40"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function PillLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full px-4 py-1.5 text-[13px] font-semibold hover:no-underline",
        active ? "bg-cream text-ink" : "text-cream hover:bg-white/10",
      )}
    >
      {children}
    </Link>
  );
}
