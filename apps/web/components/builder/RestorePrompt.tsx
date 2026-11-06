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
// - "discard-stale" → the record predates the loaded rev (the document moved
//                     on elsewhere). Per §7.2 we do not merge: Discard-only
//                     with an explanatory note.
// Discard removes the stored record immediately (offline.discardPending).

import type { ReactElement } from "react";

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
  if (!request) return null;

  const stale = request.kind === "discard-stale";
  const edits =
    request.editCount === 1 ? "1 edit" : `${request.editCount} edits`;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="dialog"
        aria-label="Restore unsaved changes"
        data-testid="restore-prompt"
        className="flex max-w-lg flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-xl dark:border-stone-700 dark:bg-stone-900"
      >
        <p className="m-0 text-sm font-semibold">
          {stale
            ? "Discard unsaved changes?"
            : `Restore unsaved changes (${edits})?`}
        </p>
        {stale ? (
          <p className="m-0 text-xs text-stone-500 dark:text-stone-400">
            These changes were made against an older version of this form, which has since been
            updated elsewhere. They cannot be merged automatically.
          </p>
        ) : (
          <p className="m-0 text-xs text-stone-500 dark:text-stone-400">
            {edits} from your last session never reached the server.
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          {stale ? null : (
            <button
              type="button"
              data-ff-default-focus="true"
              className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              onClick={onRestore}
            >
              Restore
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
