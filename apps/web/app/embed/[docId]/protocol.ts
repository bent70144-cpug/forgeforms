// postMessage protocol between the public document frame (/embed/:docId) and the
// host page loader (/api/public/embed/embed.js).
//
// Spec §10.2 pins two child→parent messages:
//   { type: "ff:height", value }            — iframe content height in px
//   { type: "ff:complete", submissionToken }
// W1-22 adds two handshake messages (documented in the loader + embed docs page):
//   { type: "ff:ready" }                    — child → parent, frame is listening
//   { type: "ff:request-height" }           — parent → child, re-measure now
// Pure module: no React, safe to unit-test and reuse from the renderer later.

export const FF_HEIGHT = "ff:height";
export const FF_COMPLETE = "ff:complete";
export const FF_READY = "ff:ready";
export const FF_REQUEST_HEIGHT = "ff:request-height";

export type FFHeightMessage = { type: typeof FF_HEIGHT; value: number };
export type FFCompleteMessage = { type: typeof FF_COMPLETE; submissionToken: string };
export type FFReadyMessage = { type: typeof FF_READY };
export type FFRequestHeightMessage = { type: typeof FF_REQUEST_HEIGHT };

/** Child (iframe) → parent messages. */
export type FFChildMessage = FFHeightMessage | FFCompleteMessage | FFReadyMessage;
/** Parent (host page) → child messages. */
export type FFParentMessage = FFRequestHeightMessage;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

export function isHeightMessage(raw: unknown): raw is FFHeightMessage {
  return isRecord(raw) && raw["type"] === FF_HEIGHT && typeof raw["value"] === "number" && Number.isFinite(raw["value"]);
}

export function isCompleteMessage(raw: unknown): raw is FFCompleteMessage {
  return isRecord(raw) && raw["type"] === FF_COMPLETE && typeof raw["submissionToken"] === "string";
}

export function isReadyMessage(raw: unknown): raw is FFReadyMessage {
  return isRecord(raw) && raw["type"] === FF_READY;
}

export function isRequestHeightMessage(raw: unknown): raw is FFRequestHeightMessage {
  return isRecord(raw) && raw["type"] === FF_REQUEST_HEIGHT;
}

/** True when this window is running inside the embed iframe. */
export function isEmbedded(): boolean {
  try {
    return typeof window !== "undefined" && window.parent !== window;
  } catch {
    return false;
  }
}

/**
 * Post a child→parent message. Silently no-ops when not embedded.
 * `targetOrigin: "*"` is intentional: the public plane serves arbitrary host pages
 * (custom domains, unknown embedders) and these messages carry no secrets — the
 * loader, in turn, verifies every incoming message's origin (see loader-script.ts).
 */
export function postToParent(message: FFChildMessage): boolean {
  if (!isEmbedded()) return false;
  window.parent.postMessage(message, "*");
  return true;
}
