import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export interface TopNavProps {
  /** href for the brand / back link (defaults to dashboard). */
  href?: string;
  /** When set, shows a back arrow + this label on the left instead of the brand. */
  backLabel?: string;
  /** Right-hand actions (links, buttons). */
  children?: ReactNode;
  className?: string;
}

/** Dark fixed-width top navigation bar (ink background). */
export function TopNav({ href = "/", backLabel, children, className }: TopNavProps) {
  return (
    <header className={cn("w-full bg-ink text-cream", className)}>
      <div className="mx-auto flex max-w-[1080px] items-center justify-between px-10 py-3.5">
        <Link
          href={href}
          className="flex items-center gap-2.5 text-cream no-underline hover:no-underline"
        >
          {backLabel ? (
            <>
              <span aria-hidden className="text-[18px] leading-none">
                ←
              </span>
              <span className="text-[14px] font-semibold">{backLabel}</span>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[13px] font-bold text-white"
              >
                J
              </span>
              <span className="font-serif text-[21px] font-semibold">JobBot</span>
            </>
          )}
        </Link>
        {children != null && (
          <nav className="flex items-center gap-5 text-[13px] font-semibold">
            {children}
          </nav>
        )}
      </div>
    </header>
  );
}
