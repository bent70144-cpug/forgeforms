'use client';

// usePreviewSession — client session state for the §8.4 preview modal.
//
// Owns everything the modal chrome needs while it is open:
// - device toggle (desktop fluid frame / mobile 390px frame, §8.4);
// - prefill params: raw toolbar text → parsed record (Apply) + removable chips;
// - restart nonce (§8.4 "Restart" remounts the renderer via key increment);
// - the modal focus contract: capture the trigger on open, restore focus on
//   close, keep Tab cycling inside the dialog, close on Escape.
//
// DOM-dependent logic is isolated in `queryFocusable` (pure traversal over a
// container) so the unit-testable surface stays free of jsdom — the vitest
// suite runs in the node env (react-dom/server only).

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { parsePrefillParams, type PreviewDevice } from "@/lib/builder/preview";

/** Elements the Tab loop may stop on inside the modal (subset we render). */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Focusable elements inside `container`, in DOM order (§12: keyboard reachable). */
export function queryFocusable(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(candidates).filter((el) => el.getAttribute("aria-hidden") !== "true");
}

export type PreviewSession = {
  device: PreviewDevice;
  setDevice: (device: PreviewDevice) => void;
  /** Increments on every Restart — used as the renderer wrapper's `key`. */
  restartNonce: number;
  restart: () => void;
  paramsText: string;
  setParamsText: (text: string) => void;
  /** Parsed prefill params currently applied to the renderer (§8.4). */
  appliedParams: Record<string, string>;
  applyParams: () => void;
  removeParam: (key: string) => void;
  /** Ref for the dialog panel (focus target on open + Tab-loop bounds). */
  panelRef: RefObject<HTMLDivElement | null>;
};

export function usePreviewSession(open: boolean, onClose: () => void): PreviewSession {
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [restartNonce, setRestartNonce] = useState(0);
  const [paramsText, setParamsText] = useState("");
  const [appliedParams, setAppliedParams] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // onClose via ref: TopBar passes a fresh arrow each render; the keydown
  // listener must not re-subscribe (and never fire stale) because of that.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus capture (§8.4): remember the trigger when the modal opens, hand
  // focus to the dialog, and restore it to the trigger on close/unmount.
  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, [open]);

  // Escape closes (renderer's own Escape swallow stays a no-op — ours is a
  // capture-phase document listener); Tab loops inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = queryFocusable(panel);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (!inside) {
        // Focus escaped (e.g. browser quirk) — pull it back to an edge.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const applyParams = useCallback(() => {
    setAppliedParams(parsePrefillParams(paramsText));
  }, [paramsText]);

  const removeParam = useCallback((key: string) => {
    setAppliedParams((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const restart = useCallback(() => setRestartNonce((nonce) => nonce + 1), []);

  return {
    device,
    setDevice,
    restartNonce,
    restart,
    paramsText,
    setParamsText,
    appliedParams,
    applyParams,
    removeParam,
    panelRef,
  };
}
