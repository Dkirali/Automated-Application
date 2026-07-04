import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Use the reddish danger-zone border treatment. */
  danger?: boolean;
  /** Remove default padding (for cards with their own header/body sections). */
  flush?: boolean;
}

export function Card({
  danger = false,
  flush = false,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "bg-card rounded-card border",
        danger ? "border-danger-line" : "border-line",
        !flush && "p-6",
        className,
      )}
      {...props}
    />
  );
}
