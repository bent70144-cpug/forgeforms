'use client';

// Undo toast (builder spec §6.4 "Delete → Undo toast for 8 seconds").
//
// WINDOW EVENT CONTRACT (emitter: useShortcuts — Delete/Backspace on a
// selected block; a canvas toolbar may emit the same):
//   `window` CustomEvent "ff:block-deleted" with detail
//   { label: string; hadLogic: boolean }
//   - label:    display label of the deleted block → "Deleted <label>"
//   - hadLogic: a logic rule references the removed subtree → inline warning
//               "Used by logic rules — review in Logic." linking to ../logic
//
// Behavior: one toast at a time (a new event replaces it and resets the 8 s
// timer), Undo dispatches the editor "undo" action and dismisses, Escape
// dismisses, aria-live="polite" role="status". No confirm dialog (§6.4).

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useBuilder } from "./context";

export const UNDO_TOAST_MS = 8000;

/** Event name — see the contract comment above. Keep in sync with useShortcuts. */
export const BLOCK_DELETED_EVENT = "ff:block-deleted";

export type BlockDeletedDetail = { label: string; hadLogic: boolean };

export type UndoToastState = { label: string; hadLogic: boolean } | null;

// ---------------------------------------------------------------------------
// Framework-free controller (8 s auto-dismiss + reset-on-replace) so the
// timing contract is unit-testable without a DOM.
// ---------------------------------------------------------------------------

export type UndoToastController = {
  /** A block was deleted: show the toast (replacing any visible one). */
  handleDeleted: (detail: BlockDeletedDetail) => void;
  /** Hide the toast without undoing. */
  dismiss: () => void;
  /** Undo the delete: fire the onUndo callback once, then hide. */
  undo: () => void;
  destroy: () => void;
};

export function createUndoToastController(opts: {
  onState: (state: UndoToastState) => void;
  onUndo: () => void;
  durationMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): UndoToastController {
  const durationMs = opts.durationMs ?? UNDO_TOAST_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: UndoToastState = null;
  let destroyed = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function hide() {
    clearTimer();
    if (state !== null) {
      state = null;
      opts.onState(null);
    }
  }

  return {
    handleDeleted(detail) {
      if (destroyed) return;
      clearTimer();
      state = { label: detail.label, hadLogic: detail.hadLogic };
      opts.onState(state);
      timer = setTimeoutFn(() => {
        timer = null;
        hide();
      }, durationMs);
    },
    dismiss: hide,
    undo() {
      if (state === null) return;
      hide();
      opts.onUndo();
    },
    destroy() {
      hide(); // notifies onState(null) so external mirrors clear deterministically
      destroyed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Presentational view (exported for static-render tests)
// ---------------------------------------------------------------------------

export function UndoToastView(props: {
  label: string;
  hadLogic: boolean;
  logicHref?: string;
  onUndo: () => void;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="ff-undo-toast fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm shadow-xl dark:border-stone-700 dark:bg-stone-900"
    >
      <span className="font-medium">Deleted {props.label}</span>
      {props.hadLogic ? (
        <span className="text-amber-700 dark:text-amber-400">
          Used by logic rules — review in{" "}
          <a href={props.logicHref ?? "../logic"} className="underline underline-offset-2">
            Logic
          </a>
          .
        </span>
      ) : null}
      <button
        type="button"
        onClick={props.onUndo}
        aria-label={`Undo delete of ${props.label}`}
        className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold hover:bg-stone-100 dark:border-stone-600 dark:hover:bg-stone-800"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label="Dismiss"
        className="rounded-md px-1.5 py-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wired component
// ---------------------------------------------------------------------------

export function UndoToast() {
  const { dispatch } = useBuilder();
  const [toast, setToast] = useState<UndoToastState>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const controller = useMemo(
    () =>
      createUndoToastController({
        onState: setToast,
        onUndo: () => dispatch({ type: "undo" }),
      }),
    [dispatch],
  );

  useEffect(() => {
    function onBlockDeleted(event: Event) {
      const detail = (event as CustomEvent<BlockDeletedDetail>).detail;
      if (!detail || typeof detail.label !== "string") return;
      controller.handleDeleted({ label: detail.label, hadLogic: detail.hadLogic === true });
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && toastRef.current) {
        event.preventDefault();
        controller.dismiss();
      }
    }
    window.addEventListener(BLOCK_DELETED_EVENT, onBlockDeleted);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      controller.destroy();
      window.removeEventListener(BLOCK_DELETED_EVENT, onBlockDeleted);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [controller]);

  if (!toast) return null;
  return <UndoToastView label={toast.label} hadLogic={toast.hadLogic} onUndo={controller.undo} onDismiss={controller.dismiss} />;
}
