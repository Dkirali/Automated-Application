import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SectionTitleProps {
  children: ReactNode;
  /** Optional element rendered on the right (e.g. a link or count). */
  aside?: ReactNode;
  /** Render as a large serif section heading instead of an uppercase label. */
  as?: "heading" | "label";
  className?: string;
}

export function SectionTitle({
  children,
  aside,
  as = "heading",
  className,
}: SectionTitleProps) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3", className)}
    >
      {as === "heading" ? (
        <h2 className="font-serif text-[21px] font-semibold text-ink">
          {children}
        </h2>
      ) : (
        <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
          {children}
        </span>
      )}
      {aside != null && <div className="shrink-0">{aside}</div>}
    </div>
  );
}
