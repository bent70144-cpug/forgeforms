// Live-announcer seam for the builder (spec §12 + §6.2): one polite ARIA live
// region mounted ONCE (BuilderShell) that announces builder events —
// currently Alt+Arrow / toolbar block moves ("… moved to position N of M").
//
// ---------------------------------------------------------------------------
// WINDOW EVENT CONTRACT — "ff:announce"
// ---------------------------------------------------------------------------
//   announce(message) →
//   window CustomEvent("ff:announce", { detail: { message: string } })
//   • Emitted by every mutation that reorders the document (Canvas move
//     toolbar buttons + the useShortcuts Alt+↑/↓ handler), so both pointer
//     and keyboard paths announce identically (§6.2 "Announce moves via an
//     ARIA live region").
//   • Consumer: <LiveAnnouncer /> (mounted once in BuilderShell) listens on
//     `window` and renders the message into a visually-hidden
//     role="status" aria-live="polite" region.
//   • announce() is SSR-safe (no window → no-op) and TESTABLE: pass an
//     injected dispatch target to capture the event without a DOM.
//
// Screen-reader note: the message is rendered inside a keyed <span> so a
// repeated identical announcement replaces the text node (mutation-observing
// SRs re-announce; text-diff-based ones would stay silent).

import { useEffect, useState, type ReactElement } from "react";

/** Window event name — see the contract above. */
export const ANNOUNCE_EVENT = "ff:announce";

export type AnnounceDetail = { message: string };

/** Minimal dispatch surface so tests can inject a fake window/target. */
export type AnnounceTarget = {
  dispatchEvent: (event: Event) => boolean;
};

function defaultTarget(): AnnounceTarget | null {
  if (typeof window === "undefined") return null;
  return window;
}

/**
 * Announce `message` politely through the "ff:announce" window event.
 * No-op when there is no dispatch target (SSR / node tests) or the message
 * is empty. Pass `target` to capture the event in tests.
 */
export function announce(message: string, target: AnnounceTarget | null = defaultTarget()): void {
  if (!message) return;
  if (!target) return;
  if (typeof CustomEvent !== "function") return; // ancient runtime — stay silent, never throw
  target.dispatchEvent(new CustomEvent<AnnounceDetail>(ANNOUNCE_EVENT, { detail: { message } }));
}

/**
 * Hook behind <LiveAnnouncer />: subscribes to "ff:announce" and returns the
 * latest message ("" before the first announcement). Listener is attached
 * client-side only, so static rendering never touches window.
 */
export function useLiveAnnouncer(): string {
  const [message, setMessage] = useState("");

  useEffect(() => {
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<AnnounceDetail>).detail;
      if (detail && typeof detail.message === "string") setMessage(detail.message);
    }
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
  }, []);

  return message;
}

/**
 * The single polite live region for the whole builder (spec §12). Visually
 * hidden (`.ff-a11y-announcer`, globals.css), never focusable, announces
 * every `announce()` call — block moves today (§6.2), more later.
 */
export function LiveAnnouncer(): ReactElement {
  const message = useLiveAnnouncer();
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="live-announcer"
      className="ff-a11y-announcer"
    >
      <span key={message}>{message}</span>
    </div>
  );
}
