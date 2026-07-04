import { cn } from "@/lib/cn";
import { ProgressBar } from "./ProgressBar";

export interface FitScoreBarProps {
  /** 0–100 match percentage. */
  value: number;
  label?: string;
  className?: string;
}

/** Compact fit-score readout (percentage + bar) for job listing cards. */
export function FitScoreBar({ value, label = "Match", className }: FitScoreBarProps) {
  const pct = Math.round(value);
  const tone = pct >= 80 ? "green" : "accent";
  return (
    <div className={cn("w-32", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
          {label}
        </span>
        <span
          className={cn(
            "font-serif text-[15px] font-semibold",
            tone === "green" ? "text-green" : "text-accent",
          )}
        >
          {pct}%
        </span>
      </div>
      <ProgressBar value={pct} tone={tone} />
    </div>
  );
}

export interface ScoreCompareProps {
  original: number;
  tailored: number;
  className?: string;
}

/** Original → Tailored score comparison used on the review page. */
export function ScoreCompare({ original, tailored, className }: ScoreCompareProps) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <ScoreBox label="Original" value={original} tone="muted" />
      <span aria-hidden className="text-[20px] text-faint">
        →
      </span>
      <ScoreBox label="Tailored" value={tailored} tone="green" />
    </div>
  );
}

function ScoreBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "green";
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          "font-serif text-[28px] font-semibold leading-none",
          tone === "green" ? "text-green" : "text-muted",
        )}
      >
        {Math.round(value)}
      </div>
      <div className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted">
        {label}
      </div>
    </div>
  );
}
