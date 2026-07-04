"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Button,
  OnboardingAside,
  SplitScreenLayout,
  StepIndicator,
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface Props {
  initialConnected: boolean;
}

export default function LinkedinStepClient({ initialConnected }: Props) {
  const [connected, setConnected] = useState(initialConnected);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startConnect = async () => {
    setWaiting(true);
    setError(null);
    try {
      // The route blocks until the Chrome window closes, then returns the
      // VERIFIED result (a real li_at session, not just an opened window).
      const r = await fetch("/api/linkedin-connect", { method: "POST" });
      const data = await r.json();
      if (data.connected) {
        setConnected(true);
      } else {
        setError(
          "Login wasn't completed — click Connect, sign in fully, then close the window."
        );
      }
    } catch {
      setError("Couldn't reach the app — please try again.");
    } finally {
      setWaiting(false);
    }
  };

  const statusLabel = connected
    ? "LinkedIn connected"
    : waiting
      ? "Log in in the Chrome window, then close it…"
      : "Not connected yet";

  return (
    <SplitScreenLayout left={<OnboardingAside />}>
      <StepIndicator total={2} current={2} className="mb-6" />

      <h2 className="font-serif text-[28px] font-semibold text-ink">
        Connect LinkedIn
      </h2>
      <p className="mt-1 mb-6 text-[14px] leading-[1.5] text-muted">
        JobBot uses your LinkedIn session to find and apply to jobs. We open a
        real Chrome window and you log in yourself — your password never leaves
        your machine.
      </p>

      <div className="flex flex-col gap-4 rounded-card border border-line bg-card p-6">
        <span
          className={cn(
            "inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-[13px] font-semibold",
            connected ? "bg-badge-green text-green" : "bg-input text-muted",
          )}
          aria-live="polite"
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              connected ? "bg-green-strong" : "bg-faint",
            )}
          />
          <span>{statusLabel}</span>
        </span>

        {error && !connected && (
          <p className="text-[12.5px] text-accent-strong" role="alert">
            {error}
          </p>
        )}

        {!connected && (
          <Button
            type="button"
            variant="accent"
            className="w-full py-3.5"
            onClick={startConnect}
            disabled={waiting}
          >
            {waiting ? "Waiting for login…" : "Connect LinkedIn"}
          </Button>
        )}

        {connected && (
          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-btn bg-accent py-3.5 text-[13px] font-bold text-white hover:bg-accent/90 hover:no-underline"
          >
            Go to dashboard →
          </Link>
        )}

        {!connected && (
          <Link
            href="/"
            className="text-center text-[12.5px] font-semibold text-muted hover:text-ink hover:no-underline"
          >
            Skip for now — I&apos;ll connect later from Settings
          </Link>
        )}
      </div>
    </SplitScreenLayout>
  );
}
