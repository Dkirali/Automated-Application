"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, TopNav } from "@/components/ui";
import { cn } from "@/lib/cn";

interface TrackedApp {
  id: number;
  title: string;
  company: string;
  location: string;
  stage: string;
  notes: string;
  ats_score: number;
  applied_at: string | null;
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
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TrackerCard({
  app,
  onMove,
  onSaveNotes,
}: {
  app: TrackedApp;
  onMove: (stage: string) => void;
  onSaveNotes: (notes: string) => void;
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

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-2 text-[11.5px] font-semibold text-accent hover:underline"
      >
        {open ? "Hide notes" : app.notes ? "Notes ●" : "Add notes"}
      </button>
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
