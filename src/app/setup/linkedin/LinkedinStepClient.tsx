"use client";

import { useState } from "react";

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

  return (
    <div className="page-center">
      <div className="form-card">
        <span className="form-card-logo">JobBot</span>
        <h2>Connect LinkedIn</h2>
        <p className="form-card-sub">
          JobBot uses your LinkedIn session to find and apply to jobs. We open a real Chrome window and you log in
          yourself — your password never leaves your machine.
        </p>

        <div className="steps">
          <div className="step-dot done" />
          <div className="step-dot active" />
        </div>

        <div className="linkedin-card">
          <div className="linkedin-card-row">
            <span
              className={`li-pill ${connected ? "li-pill--on" : "li-pill--off"}`}
              aria-live="polite"
            >
              <span className="li-pill-dot" />
              <span>
                {connected
                  ? "LinkedIn connected"
                  : waiting
                    ? "Log in in the Chrome window, then close it…"
                    : "Not connected yet"}
              </span>
            </span>
          </div>

          {error && !connected && (
            <p className="li-error" role="alert">
              {error}
            </p>
          )}

          {!connected && (
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={startConnect}
              disabled={waiting}
            >
              {waiting ? "Waiting for login…" : "Connect LinkedIn"}
            </button>
          )}

          {connected && (
            <a href="/" className="btn btn-primary btn-full">
              Go to dashboard →
            </a>
          )}

          {!connected && (
            <a href="/" className="form-skip-link">
              Skip for now — I&apos;ll connect later from Settings
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
