'use client';

// Conflict dialog (builder spec §7.3.3) — shown when the AutosaveController's
// automatic rebase could not apply the local ops cleanly. Blocking but
// NON-destructive: no data is lost whichever way the user chooses.
//
// - "Keep mine"   → controller.resolveConflict("mine")  — re-sends the local
//   ops against the server rev (overwrites where they collide).
// - "Use theirs"  → controller.resolveConflict("theirs") — drops the local
//   ops and adopts the server document (DEFAULT focus).
// - "Compare"     → disabled ("Coming soon" — side-by-side diff is Phase 2).
// - Escape is deliberately a NO-OP: the user must choose (§7.3.3).
//
// While the dialog is open the controller keeps collecting edits for "Keep
// mine" and parks the network queue; the pending ops stay mirrored to the
// §22.2 IndexedDB record, so even a crash here loses nothing (autosave.ts
// syncQueue() continues while conflictCtx is set).

import { useEffect, useRef, type ReactElement } from "react";
import type { ConflictEvent, ConflictMode } from "@/lib/builder/autosave";

export type ConflictDialogProps = {
  /** Active conflict event from the controller (null → render nothing). */
  conflict: ConflictEvent | null;
  /** Resolve handler — BuilderPage wires this to controller.resolveConflict. */
  onResolve: (mode: ConflictMode) => void;
};

export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps): ReactElement | null {
  // Default focus lands on the safe choice ("Use theirs") when the dialog
  // opens; ref + effect because focus is a client-only concern.
  const theirsRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (conflict) theirsRef.current?.focus();
  }, [conflict]);

  if (!conflict) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      // §7.3.3: Escape must not dismiss — swallow it inside the overlay.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }}
    >
      <div className="absolute inset-0 bg-stone-900/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conflict"
        data-testid="conflict-dialog"
        className="relative mx-auto mt-[18vh] w-[calc(100%-2rem)] max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900"
      >
        <h2 className="text-base font-semibold">Conflict</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
          This form was changed in another tab or by someone else.
        </p>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          {conflict.pendingOps.length > 0
            ? `Your ${conflict.pendingOps.length} unsaved ${
                conflict.pendingOps.length === 1 ? "change is" : "changes are"
              } kept — choose which version wins.`
            : "Choose which version wins. Your changes are kept on this device."}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
            onClick={() => onResolve("mine")}
          >
            Keep mine
          </button>
          <button
            ref={theirsRef}
            type="button"
            data-ff-default-focus="true"
            className="rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            onClick={() => onResolve("theirs")}
          >
            Use theirs
          </button>
          <button
            type="button"
            className="ml-auto rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-400 dark:border-stone-700"
            disabled
            title="Coming soon"
          >
            Compare
          </button>
        </div>
      </div>
    </div>
  );
}
