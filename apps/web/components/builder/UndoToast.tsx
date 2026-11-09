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

// Meridian restyle: an ink-dark toast pinned bottom-left — #1a1d26 surface
// with paper text (the two core neutrals, pinned so the toast stays dark in
// night mode too), the Undo action in an ultramarine-300 tone, and a mono
// countdown to the 8 s auto-dismiss. Behavior contract unchanged.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useBuilderDispatch } from "./context";

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
  // Mono countdown for the auto-dismiss window — purely presentational (the
  // controller owns the real timer; this mirror just renders the seconds).
  const [secondsLeft, setSecondsLeft] = useState(Math.round(UNDO_TOAST_MS / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      className="ff-undo-toast fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm"
      style={{
        background: "#1a1d26",
        color: "#f7f5f0",
        border: "1px solid rgb(247 245 240 / 0.14)",
        boxShadow: "var(--ff-shadow-lg)",
      }}
    >
      <span className="font-medium">Deleted {props.label}</span>
      {props.hadLogic ? (
        <span style={{ color: "color-mix(in srgb, var(--ff-warning) 60%, white)" }}>
          Used by logic rules — review in{" "}
          <a
            href={props.logicHref ?? "../logic"}
            className="underline underline-offset-2"
            style={{ color: "inherit" }}
          >
            Logic
          </a>
          .
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="tabular-nums"
        style={{
          fontFamily: "var(--ff-font-mono)",
          fontSize: "0.6875rem",
          color: "rgb(247 245 240 / 0.6)",
        }}
      >
        {secondsLeft}s
      </span>
      <button
        type="button"
        onClick={props.onUndo}
        aria-label={`Undo delete of ${props.label}`}
        className="ff-btn ff-btn-sm hover:bg-[color:color-mix(in_srgb,var(--ff-primary)_30%,transparent)]"
        style={{
          color: "color-mix(in srgb, var(--ff-primary) 55%, white)",
          borderColor: "color-mix(in srgb, var(--ff-primary) 55%, white)",
          fontWeight: 600,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label="Dismiss"
        className="rounded-md p-1 leading-none transition-colors hover:bg-[color:rgb(255_255_255/0.1)]"
        style={{ color: "rgb(247 245 240 / 0.65)" }}
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
  // Dispatch-only subscription (§13): the toast never reads the document, so
  // it must not re-render on every store change.
  const dispatch = useBuilderDispatch();
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
