// Unit tests for the child side of the embed postMessage protocol
// (/embed/[docId]/protocol.ts). Pure module: guard functions run in Node;
// postToParent must no-op outside an iframe (no window) rather than throw.
import { describe, expect, it } from "vitest";

import {
  FF_COMPLETE,
  FF_HEIGHT,
  FF_READY,
  FF_REQUEST_HEIGHT,
  isCompleteMessage,
  isHeightMessage,
  isReadyMessage,
  isRequestHeightMessage,
  isEmbedded,
  postToParent,
} from "./protocol";

describe("protocol message guards", () => {
  it("accepts well-formed ff:height messages and rejects bad values", () => {
    expect(isHeightMessage({ type: FF_HEIGHT, value: 512 })).toBe(true);
    expect(isHeightMessage({ type: FF_HEIGHT, value: 0 })).toBe(true);
    expect(isHeightMessage({ type: FF_HEIGHT, value: Number.NaN })).toBe(false);
    expect(isHeightMessage({ type: FF_HEIGHT, value: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isHeightMessage({ type: FF_HEIGHT, value: "512" })).toBe(false);
    expect(isHeightMessage({ type: FF_HEIGHT })).toBe(false);
    expect(isHeightMessage(null)).toBe(false);
    expect(isHeightMessage("ff:height")).toBe(false);
  });

  it("accepts well-formed ff:complete messages only", () => {
    expect(isCompleteMessage({ type: FF_COMPLETE, submissionToken: "sub_1" })).toBe(true);
    expect(isCompleteMessage({ type: FF_COMPLETE, submissionToken: 7 })).toBe(false);
    expect(isCompleteMessage({ type: FF_COMPLETE })).toBe(false);
  });

  it("recognizes handshake messages", () => {
    expect(isReadyMessage({ type: FF_READY })).toBe(true);
    expect(isReadyMessage({ type: FF_REQUEST_HEIGHT })).toBe(false);
    expect(isRequestHeightMessage({ type: FF_REQUEST_HEIGHT })).toBe(true);
    expect(isRequestHeightMessage({ type: FF_HEIGHT, value: 1 })).toBe(false);
  });
});

describe("embedded runtime detection", () => {
  it("reports not-embedded outside a browser window (Node/test env)", () => {
    expect(isEmbedded()).toBe(false);
  });

  it("postToParent no-ops safely when not embedded", () => {
    expect(postToParent({ type: FF_READY })).toBe(false);
  });
});
