import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  tone?: "accent" | "green";
  className?: string;
}

export function ProgressBar({
  value,
  tone = "accent",
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-[7px] w-full rounded overflow-hidden bg-track", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded transition-[width] duration-500",
          tone === "green" ? "bg-green-strong" : "bg-accent",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
