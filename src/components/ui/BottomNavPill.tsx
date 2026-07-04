import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface BottomNavPillProps {
  children: ReactNode;
  className?: string;
}

/** Floating pill navigation fixed to the bottom-center of the viewport. */
export function BottomNavPill({ children, className }: BottomNavPillProps) {
  return (
    <div
      className={cn(
        "fixed bottom-[18px] left-1/2 -translate-x-1/2 z-40",
        "flex items-center gap-1 rounded-full bg-ink px-2 py-2 text-cream",
        "[filter:drop-shadow(0_14px_34px_rgba(0,0,0,0.35))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
