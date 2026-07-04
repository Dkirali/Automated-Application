import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "green" | "orange" | "neutral" | "ink";

const TONES: Record<Tone, string> = {
  green: "bg-badge-green text-green",
  orange: "bg-badge-orange text-accent",
  neutral: "bg-input text-muted",
  ink: "bg-ink text-cream",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Fully rounded pill (default) vs softly rounded block. */
  pill?: boolean;
}

export function Badge({
  tone = "neutral",
  pill = true,
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-semibold leading-none px-2.5 py-1",
        pill ? "rounded-full" : "rounded-lg",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
