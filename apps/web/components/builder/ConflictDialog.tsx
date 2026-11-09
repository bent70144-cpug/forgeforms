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
import { BTN_PRIMARY, BTN_SECONDARY, BANNER_WARNING } from "@/lib/ui";

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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conflict"
        data-testid="conflict-dialog"
        className="relative mx-auto mt-[18vh] w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[color:var(--ff-glass-border)] bg-[color:var(--ff-glass)] p-6 text-[color:var(--ff-fg)] shadow-[var(--ff-glow-soft),var(--ff-shadow-lg)] backdrop-blur-xl"
      >
        <h2 className="text-base font-semibold">Conflict</h2>
        <p className="mt-2 text-sm text-[color:var(--ff-muted)]">
          This form was changed in another tab or by someone else.
        </p>
        <p className={`${BANNER_WARNING} mt-3`} role="note">
          {conflict.pendingOps.length > 0
            ? `Your ${conflict.pendingOps.length} unsaved ${
                conflict.pendingOps.length === 1 ? "change is" : "changes are"
              } kept — choose which version wins.`
            : "Choose which version wins. Your changes are kept on this device."}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={() => onResolve("mine")}>
            Keep mine
          </button>
          <button
            ref={theirsRef}
            type="button"
            data-ff-default-focus="true"
            className={BTN_PRIMARY}
            onClick={() => onResolve("theirs")}
          >
            Use theirs
          </button>
          <button
            type="button"
            className={`${BTN_SECONDARY} ml-auto`}
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
