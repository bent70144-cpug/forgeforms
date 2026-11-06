// packages/blocks — parent-side of the ff:* postMessage protocol (T21 form-embed).
//
// Spec §10.2 pins the child→parent messages:
//   { type: "ff:height", value }            — iframe content height in px
//   { type: "ff:complete", submissionToken }
// The child side lives in apps/web/app/embed/[docId]/protocol.ts (T22). This
// module mirrors the same shapes as pure code so packages/blocks stays
// dependency-free; T22 may adopt these exports later to drop the duplication.
export const FF_HEIGHT = "ff:height";
export const FF_COMPLETE = "ff:complete";

export type FFHeightMessage = { type: typeof FF_HEIGHT; value: number };
export type FFCompleteMessage = { type: typeof FF_COMPLETE; submissionToken: string };
/** Child (iframe) → parent messages consumed by the form-embed parent side. */
export type FFChildMessage = FFHeightMessage | FFCompleteMessage;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

export function isHeightMessage(raw: unknown): raw is FFHeightMessage {
  return (
    isRecord(raw) &&
    raw["type"] === FF_HEIGHT &&
    typeof raw["value"] === "number" &&
    Number.isFinite(raw["value"])
  );
}

export function isCompleteMessage(raw: unknown): raw is FFCompleteMessage {
  return isRecord(raw) && raw["type"] === FF_COMPLETE && typeof raw["submissionToken"] === "string";
}

export type EmbedEventHandlers = {
  onHeight?: (value: number) => void;
  onComplete?: (submissionToken: string) => void;
};

/**
 * Route one raw message event payload to the handlers. Returns true when the
 * payload was a recognized ff:* message. Unknown/junk payloads are ignored
 * (never throw — the host page must not crash on third-party noise).
 */
export function dispatchEmbedMessage(raw: unknown, handlers: EmbedEventHandlers): boolean {
  if (isHeightMessage(raw)) {
    handlers.onHeight?.(raw.value);
    return true;
  }
  if (isCompleteMessage(raw)) {
    handlers.onComplete?.(raw.submissionToken);
    return true;
  }
  return false;
}

/**
 * Listen for postMessage events from one specific frame (`source`) on `target`
 * (usually `window`). Returns a detach function. `source` is compared by
 * identity — pass `iframe.contentWindow`.
 */
export function attachEmbedEventListeners(
  target: EventTarget,
  source: unknown,
  handlers: EmbedEventHandlers,
): () => void {
  const onMessage = (event: Event): void => {
    const messageEvent = event as MessageEvent;
    if (messageEvent.source !== source) return;
    dispatchEmbedMessage(messageEvent.data, handlers);
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}

/**
 * Re-post an ff:* message upward (form-embed inside a page that is itself
 * embedded). Silently no-ops when not running inside an iframe. `targetOrigin:
 * "*"` mirrors the T22 child side: the public plane serves arbitrary host
 * pages and these messages carry no secrets.
 */
export function postToEmbedParent(message: FFChildMessage): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.parent === window) return false;
    window.parent.postMessage(message, "*");
    return true;
  } catch {
    return false;
  }
}
