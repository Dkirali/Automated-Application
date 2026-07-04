import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Optional sub-line under the number (e.g. a status dot + text). */
  foot?: ReactNode;
  className?: string;
}

/** KPI card: uppercase label + large Newsreader number. */
export function StatCard({ label, value, foot, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-card rounded-card border border-line p-5 flex flex-col gap-2",
        className,
      )}
    >
      <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
        {label}
      </span>
      <span className="font-serif text-[34px] leading-none font-semibold text-ink">
        {value}
      </span>
      {foot != null && <span className="text-[12px] text-muted">{foot}</span>}
    </div>
  );
}
