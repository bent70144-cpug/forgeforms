'use client';

// Re-auth dialog (builder spec §7.1 follow-up #3) — shown when the
// AutosaveController parks the queue because the session expired
// (UnauthenticatedError: HTTP 401 or the §4 "Authentication required" 403).
//
// Blocking-ish but NON-destructive: the pending ops stay queued locally (and
// mirrored to the §22.2 IndexedDB record), so nothing is lost whichever way
// the user goes.
//
// - "Sign in"                  → opens the existing sign-in route (/login) in a
//   NEW TAB (target _blank) so this builder tab keeps its in-memory state.
// - "I've signed in — resume"  → controller.resumeAfterReauth(): re-checks
//   GET /api/auth/session and flushes the kept queue when the session is
//   valid again (DEFAULT focus after sign-in is the natural next step, but
//   the initial default lands on "Sign in" — the required first action).
// - "Dismiss"                  → controller.dismissReauth(): parks until the
//   next manual retry; a still-expired session re-raises this dialog.
// - Escape dismisses (the dialog is re-raised on the next failed attempt —
//   unlike ConflictDialog §7.3.3, there is no irrecoverable choice here).

import { useEffect, useRef, useState, type ReactElement } from "react";
import type { UnauthenticatedEvent } from "@/lib/builder/autosave";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, BANNER_WARNING } from "@/lib/ui";

export type ReauthDialogProps = {
  /** Active re-auth prompt from the controller (null → render nothing). */
  prompt: UnauthenticatedEvent | null;
  /** Sign-in route — the app's existing login page. */
  signInHref?: string;
  /** Resume handler — BuilderPage wires this to controller.resumeAfterReauth. */
  onResume: () => Promise<boolean>;
  /** Dismiss handler — parks the queue until the next manual retry. */
  onDismiss: () => void;
};

export function ReauthDialog({
  prompt,
  signInHref = "/login",
  onResume,
  onDismiss,
}: ReauthDialogProps): ReactElement | null {
  // Default focus lands on "Sign in" — the required first step (§12).
  const signInRef = useRef<HTMLAnchorElement | null>(null);
  // While the session re-check runs the resume button must not look dead
  // (and not double-fire); reset afterwards so a failed check can retry.
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (prompt) signInRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  const handleResume = (): void => {
    if (checking) return;
    setChecking(true);
    void Promise.resolve(onResume()).finally(() => setChecking(false));
  };

  return (
    <div
      className="fixed inset-0 z-50"
      // Non-blocking: Escape = dismiss (parks until the next manual retry).
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgb(26 29 38 / 0.4)" }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session expired"
        data-testid="reauth-dialog"
        className="relative mx-auto mt-[18vh] w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[color:var(--ff-border)] bg-[color:var(--ff-card)] p-6 text-[color:var(--ff-fg)] shadow-[var(--ff-shadow-lg)]"
      >
        <h2
          className="m-0 text-base font-semibold"
          style={{ fontFamily: "var(--ff-font-heading)", letterSpacing: "-0.01em" }}
        >
          Session expired
        </h2>
        <p className="mt-2 text-sm text-[color:var(--ff-muted)]">
          Your session expired, so FormForge stopped saving. Nothing was lost.
        </p>
        <p className={`${BANNER_WARNING} mt-3`} role="note">
          {prompt.pendingCount > 0
            ? `Your ${prompt.pendingCount} unsaved ${
                prompt.pendingCount === 1 ? "change is" : "changes are"
              } kept on this device — sign in to keep saving.`
            : "Your changes are kept on this device — sign in to keep saving."}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <a
            ref={signInRef}
            href={signInHref}
            target="_blank"
            rel="noopener noreferrer"
            data-ff-default-focus="true"
            data-testid="reauth-sign-in"
            className={BTN_PRIMARY}
          >
            Sign in
          </a>
          <button
            type="button"
            data-testid="reauth-resume"
            className={BTN_SECONDARY}
            disabled={checking}
            onClick={handleResume}
          >
            {checking ? "Checking…" : "I've signed in — resume"}
          </button>
          <button
            type="button"
            data-testid="reauth-dismiss"
            className={`${BTN_GHOST} ml-auto`}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
