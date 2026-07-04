import { cn } from "@/lib/cn";

export interface StepIndicatorProps {
  total: number;
  /** 1-based index of the current step. */
  current: number;
  className?: string;
}

/** Row of filled / unfilled progress bars for a multi-step wizard. */
export function StepIndicator({ total, current, className }: StepIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-[5px] w-6 rounded-[3px]",
            i < current ? "bg-accent" : "bg-line",
          )}
        />
      ))}
    </div>
  );
}
