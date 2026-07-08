"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, TopNav } from "@/components/ui";
import { cn } from "@/lib/cn";

interface InterviewQuestion {
  q: string;
  why: string;
  answerHint: string;
}
interface InterviewPrep {
  questions: InterviewQuestion[];
  tips: string[];
  sourced: boolean;
  sources: string[];
  generatedAt: string;
}

interface TrackedApp {
  id: number;
  title: string;
  company: string;
  location: string;
  stage: string;
  notes: string;
  ats_score: number;
  applied_at: string | null;
  interview_prep: string | null;
}

const STAGES: { key: string; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
];

const STAGE_TONE: Record<string, "green" | "orange" | "neutral" | "ink"> = {
  applied: "neutral",
  screening: "orange",
  interview: "ink",
  offer: "green",
  rejected: "neutral",
};

export default function TrackerClient({ initialApps }: { initialApps: TrackedApp[] }) {
  const [apps, setApps] = useState<TrackedApp[]>(initialApps);
  const [prepFor, setPrepFor] = useState<TrackedApp | null>(null);

  const byStage = useMemo(() => {
    const map: Record<string, TrackedApp[]> = {};
    for (const s of STAGES) map[s.key] = [];
    for (const a of apps) (map[a.stage] ?? map.applied).push(a);
    return map;
  }, [apps]);

  const moveStage = async (id: number, stage: string) => {
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, stage } : a)));
    try {
      await fetch("/api/tracker/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stage }),
      });
    } catch {
      // best-effort; the optimistic move stays until reload
    }
  };

  const saveNotes = async (id: number, notes: string) => {
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, notes } : a)));
    try {
      await fetch("/api/tracker/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, notes }),
      });
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className="min-h-screen bg-cream pb-16">
      <TopNav>
        <Link href="/" className="text-cream hover:no-underline hover:opacity-80">
          Dashboard
        </Link>
        <Link href="/resume" className="text-cream hover:no-underline hover:opacity-80">
          Resume
        </Link>
        <Link href="/settings" className="text-cream hover:no-underline hover:opacity-80">
          Settings
        </Link>
      </TopNav>

      <main className="mx-auto max-w-[1200px] px-6 py-9 md:px-10">
        <h1 className="font-serif text-[30px] font-semibold text-ink">
          Application tracker
        </h1>
        <p className="mb-6 mt-1 text-[14px] text-muted">
          Move each application through your pipeline. {apps.length} tracked.
        </p>

        {apps.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="text-[40px]">📋</div>
            <div className="text-[15px] font-bold text-ink">Nothing to track yet</div>
            <div className="max-w-md text-[13px] text-muted">
              Applications you submit show up here. Start a campaign from the{" "}
              <Link href="/">dashboard</Link>.
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STAGES.map((s) => (
              <div key={s.key} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                    {s.label}
                  </span>
                  <Badge tone={STAGE_TONE[s.key]}>{byStage[s.key].length}</Badge>
                </div>
                <div className="flex flex-col gap-3">
                  {byStage[s.key].map((a) => (
                    <TrackerCard
                      key={a.id}
                      app={a}
                      onMove={(stage) => moveStage(a.id, stage)}
                      onSaveNotes={(notes) => saveNotes(a.id, notes)}
                      onPrep={() => setPrepFor(a)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {prepFor && <PrepModal app={prepFor} onClose={() => setPrepFor(null)} />}
    </div>
  );
}

function TrackerCard({
  app,
  onMove,
  onSaveNotes,
  onPrep,
}: {
  app: TrackedApp;
  onMove: (stage: string) => void;
  onSaveNotes: (notes: string) => void;
  onPrep: () => void;
}) {
  const [notes, setNotes] = useState(app.notes);
  const [open, setOpen] = useState(false);
  const dirty = notes !== app.notes;

  return (
    <div className="rounded-card border border-line bg-card p-3">
      <div className="text-[13.5px] font-bold leading-snug text-ink">{app.title}</div>
      <div className="mt-0.5 text-[12px] text-muted">
        {app.company}
        {app.location ? ` · ${app.location}` : ""}
      </div>
      {app.ats_score > 0 && (
        <div className="mt-1 text-[11px] font-semibold text-muted">ATS {app.ats_score}%</div>
      )}

      <select
        value={app.stage}
        onChange={(e) => onMove(e.target.value)}
        className="mt-2 w-full rounded-md border border-line bg-input px-2 py-1.5 text-[12px] font-semibold text-ink focus:border-accent focus:outline-none"
        aria-label="Move to stage"
      >
        {STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[11.5px] font-semibold text-accent hover:underline"
        >
          {open ? "Hide notes" : app.notes ? "Notes ●" : "Add notes"}
        </button>
        <button
          type="button"
          onClick={onPrep}
          className="text-[11.5px] font-semibold text-accent hover:underline"
        >
          {app.interview_prep ? "Interview prep ●" : "Interview prep"}
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Recruiter name, next step, dates…"
            className="w-full rounded-md border border-line bg-input px-2 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={!dirty}
            onClick={() => onSaveNotes(notes)}
            className={cn(
              "mt-1 rounded-md px-3 py-1 text-[11.5px] font-bold",
              dirty ? "bg-ink text-cream" : "bg-input text-faint"
            )}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

function PrepModal({ app, onClose }: { app: TrackedApp; onClose: () => void }) {
  const initial: InterviewPrep | null = app.interview_prep
    ? (() => {
        try {
          return JSON.parse(app.interview_prep) as InterviewPrep;
        } catch {
          return null;
        }
      })()
    : null;
  const [prep, setPrep] = useState<InterviewPrep | null>(initial);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const generate = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/interview/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id }),
      });
      const body = await res.json();
      if (body.ok) {
        setPrep(body.prep);
        setState("idle");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, [app.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-card border border-line bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-serif text-[21px] font-semibold text-ink">
              Interview prep
            </div>
            <div className="text-[13px] text-muted">
              {app.title} · {app.company}
            </div>
          </div>
          <button
            className="text-[18px] text-muted hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button variant="accent" size="sm" onClick={generate} disabled={state === "loading"}>
            {state === "loading"
              ? "Preparing…"
              : prep
                ? "↻ Regenerate"
                : "Generate prep"}
          </Button>
          {prep && (
            <Badge tone={prep.sourced ? "green" : "neutral"}>
              {prep.sourced ? "web-sourced" : "AI-generated"}
            </Badge>
          )}
          {state === "error" && (
            <span className="text-[12.5px] text-accent-strong">
              Couldn&apos;t generate prep — try again.
            </span>
          )}
        </div>

        {!prep && state !== "loading" && (
          <p className="text-[13px] text-muted">
            Generate likely questions and tailored answer angles for this role.
          </p>
        )}

        {prep && (
          <div className="flex flex-col gap-4">
            {prep.tips.length > 0 && (
              <div className="rounded-xl bg-input p-3">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                  Tips
                </div>
                <ul className="list-disc pl-5 text-[13px] text-ink">
                  {prep.tips.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <ol className="flex flex-col gap-3">
              {prep.questions.map((q, i) => (
                <li key={i} className="rounded-card border border-line p-3">
                  <div className="text-[14px] font-semibold text-ink">
                    {i + 1}. {q.q}
                  </div>
                  {q.why && (
                    <div className="mt-1 text-[12px] text-muted">
                      <span className="font-semibold">Why: </span>
                      {q.why}
                    </div>
                  )}
                  {q.answerHint && (
                    <div className="mt-1 text-[12.5px] text-ink">
                      <span className="font-semibold text-accent">Approach: </span>
                      {q.answerHint}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {prep.sourced && prep.sources.length > 0 && (
              <div className="text-[11.5px] text-muted">
                Sources:{" "}
                {prep.sources.slice(0, 5).map((u, i) => (
                  <a
                    key={i}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mr-2 underline"
                  >
                    [{i + 1}]
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
