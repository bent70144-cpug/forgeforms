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
      <div className="absolute inset-0 bg-stone-900/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Session expired"
        data-testid="reauth-dialog"
        className="relative mx-auto mt-[18vh] w-[calc(100%-2rem)] max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 className="text-base font-semibold">Session expired</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          Your session expired, so FormForge stopped saving. Nothing was lost.
        </p>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
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
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Sign in
          </a>
          <button
            type="button"
            data-testid="reauth-resume"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
            disabled={checking}
            onClick={handleResume}
          >
            {checking ? "Checking…" : "I've signed in — resume"}
          </button>
          <button
            type="button"
            data-testid="reauth-dismiss"
            className="ml-auto rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-400 dark:border-stone-700"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
