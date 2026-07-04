import type { ReactNode } from "react";

export interface SplitScreenLayoutProps {
  /** Content of the dark left trust panel. */
  left: ReactNode;
  /** Content of the cream right form panel. */
  children: ReactNode;
}

/** Two-column onboarding layout: dark trust panel + cream form panel. */
export function SplitScreenLayout({ left, children }: SplitScreenLayoutProps) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[1fr_1.2fr]">
      <aside className="hidden flex-col justify-between bg-ink px-12 py-14 text-cream md:flex">
        {left}
      </aside>
      <main className="flex items-center justify-center bg-cream px-8 py-14 md:px-16">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}
