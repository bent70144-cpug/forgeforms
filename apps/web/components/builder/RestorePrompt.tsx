'use client';

// §7.2 recovery prompt — offered after a reload when the §22.2 IndexedDB
// offline record holds unsaved ops that never reached the server.
//
// Two variants (planned by lib/builder/wiring.planRecovery):
// - "restore"       → the record's baseRev matches the loaded document rev:
//                     "Restore unsaved changes (N edits)?" with Restore +
//                     Discard. Restore dispatches the ops through the NORMAL
//                     store path (`apply`), which emits → the autosave wiring
//                     enqueues them; the controller's own ack clears the
//                     stored record on 200 (no manual clearQueue — a manual
//                     enqueue here would double-send).
// - "discard-stale" → the record predates the loaded rev and could NOT be
//                     routed into the §7.3 conflict flow (follow-up #2 makes
//                     that flow the default for stale batches with ops; this
//                     variant remains as the fallback for when the server-doc
//                     fetch fails). Per §7.2 we do not merge: Discard-only
//                     with an explanatory note.
// Discard removes the stored record immediately (offline.discardPending).

import { useEffect, useRef, type ReactElement } from "react";
import { BTN_PRIMARY, BTN_SECONDARY, BANNER_WARNING } from "@/lib/ui";

export type RestoreRequest = {
  kind: "restore" | "discard-stale";
  /** Number of stored ops — the "(N edits)" count. */
  editCount: number;
};

export type RestorePromptProps = {
  /** Pending recovery request (null → render nothing). */
  request: RestoreRequest | null;
  onRestore: () => void;
  onDiscard: () => void;
};

export function RestorePrompt({ request, onRestore, onDiscard }: RestorePromptProps): ReactElement | null {
  // §12 focus management: the prompt is a modal decision — move focus into it
  // when it appears (the `data-ff-default-focus` control, else the first
  // button) so keyboard users act on it instead of editing an obscured page.
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!request) return;
    const preferred = dialogRef.current?.querySelector<HTMLElement>("[data-ff-default-focus]");
    (preferred ?? dialogRef.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [request]);

  if (!request) return null;

  const stale = request.kind === "discard-stale";
  const edits =
    request.editCount === 1 ? "1 edit" : `${request.editCount} edits`;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Restore unsaved changes"
        data-testid="restore-prompt"
        className="flex max-w-lg flex-col gap-2 rounded-2xl border border-[color:var(--ff-border)] bg-[color:var(--ff-card)] p-4 text-[color:var(--ff-fg)] shadow-[var(--ff-shadow-lg)]"
      >
        <p
          className="m-0 text-sm font-semibold"
          style={{ fontFamily: "var(--ff-font-heading)", letterSpacing: "-0.01em" }}
        >
          {stale
            ? "Discard unsaved changes?"
            : `Restore unsaved changes (${edits})?`}
        </p>
        {stale ? (
          <p className="m-0 text-xs text-[color:var(--ff-muted)]">
            These changes were made against an older version of this form, which has since been
            updated elsewhere. They cannot be merged automatically.
          </p>
        ) : (
          <p className={`${BANNER_WARNING} m-0`} role="note">
            {edits} from your last session never reached the server.
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          {stale ? null : (
            <button
              type="button"
              data-ff-default-focus="true"
              className={BTN_PRIMARY}
              onClick={onRestore}
            >
              Restore
            </button>
          )}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
