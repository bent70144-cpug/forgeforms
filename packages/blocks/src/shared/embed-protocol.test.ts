// T21 — parent-side guards of the ff:* postMessage protocol (form-embed block).
// Message shapes are pinned by spec §10.2: {ff:height},{ff:complete:submissionToken}.
// The child side lives in apps/web/app/embed/[docId]/protocol.ts (T22); this module
// mirrors it as pure code so packages/blocks stays dependency-free.
import { describe, expect, it } from "vitest";
import {
  FF_COMPLETE,
  FF_HEIGHT,
  attachEmbedEventListeners,
  dispatchEmbedMessage,
  isCompleteMessage,
  isHeightMessage,
  postToEmbedParent,
} from "./embed-protocol";

describe("ff:* message guards (spec §10.2 shapes)", () => {
  it("constants match the protocol strings", () => {
    expect(FF_HEIGHT).toBe("ff:height");
    expect(FF_COMPLETE).toBe("ff:complete");
  });

  it("accepts a well-formed height message", () => {
    expect(isHeightMessage({ type: "ff:height", value: 480 })).toBe(true);
  });

  it("rejects malformed height messages", () => {
    expect(isHeightMessage({ type: "ff:height", value: "480" })).toBe(false);
    expect(isHeightMessage({ type: "ff:height", value: Number.NaN })).toBe(false);
    expect(isHeightMessage({ type: "ff:height" })).toBe(false);
    expect(isHeightMessage({ type: "ff:complete", value: 480 })).toBe(false);
    expect(isHeightMessage(null)).toBe(false);
    expect(isHeightMessage("ff:height")).toBe(false);
  });

  it("accepts a well-formed complete message", () => {
    expect(isCompleteMessage({ type: "ff:complete", submissionToken: "sub_2rAbCdEfGh" })).toBe(true);
  });

  it("rejects malformed complete messages", () => {
    expect(isCompleteMessage({ type: "ff:complete", submissionToken: 42 })).toBe(false);
    expect(isCompleteMessage({ type: "ff:complete" })).toBe(false);
    expect(isCompleteMessage({ type: "ff:height", submissionToken: "t" })).toBe(false);
    expect(isCompleteMessage(undefined)).toBe(false);
  });
});

describe("dispatchEmbedMessage", () => {
  const handlers = {
    onHeight: (value: number) => void value,
    onComplete: (token: string) => void token,
  };

  it("routes height and complete events to their handlers", () => {
    const seen: string[] = [];
    dispatchEmbedMessage({ type: "ff:height", value: 640 }, {
      onHeight: (v) => seen.push(`height:${String(v)}`),
    });
    dispatchEmbedMessage({ type: "ff:complete", submissionToken: "sub_t" }, {
      onComplete: (t) => seen.push(`complete:${t}`),
    });
    expect(seen).toEqual(["height:640", "complete:sub_t"]);
  });

  it("returns false and does not throw for junk (never crashes the host page)", () => {
    expect(dispatchEmbedMessage({ type: "ff:height", value: "nope" }, handlers)).toBe(false);
    expect(dispatchEmbedMessage("garbage", handlers)).toBe(false);
    expect(dispatchEmbedMessage(null, handlers)).toBe(false);
    expect(dispatchEmbedMessage(undefined, handlers)).toBe(false);
  });

  it("tolerates missing handlers", () => {
    expect(dispatchEmbedMessage({ type: "ff:height", value: 10 }, {})).toBe(true);
    expect(dispatchEmbedMessage({ type: "ff:complete", submissionToken: "t" }, {})).toBe(true);
  });
});

describe("attachEmbedEventListeners", () => {
  it("delivers only messages whose source matches the watched frame", () => {
    const target = new EventTarget();
    const frameA = new MessageChannel().port1;
    const frameB = new MessageChannel().port1;
    const seen: number[] = [];
    const detach = attachEmbedEventListeners(target, frameA, { onHeight: (v) => seen.push(v) });

    target.dispatchEvent(new MessageEvent("message", { source: frameB, data: { type: "ff:height", value: 1 } }));
    target.dispatchEvent(new MessageEvent("message", { source: frameA, data: { type: "ff:height", value: 2 } }));
    expect(seen).toEqual([2]);

    detach();
    target.dispatchEvent(new MessageEvent("message", { source: frameA, data: { type: "ff:height", value: 3 } }));
    expect(seen).toEqual([2]);
  });

  it("ignores junk payloads from the watched frame without throwing", () => {
    const target = new EventTarget();
    const frame = new MessageChannel().port1;
    const seen: string[] = [];
    const detach = attachEmbedEventListeners(target, frame, {
      onHeight: (v) => seen.push(`h${String(v)}`),
      onComplete: (t) => seen.push(`c${t}`),
    });
    target.dispatchEvent(new MessageEvent("message", { source: frame, data: { type: "ff:height", value: "junk" } }));
    target.dispatchEvent(new MessageEvent("message", { source: frame, data: { type: "ff:complete", submissionToken: "ok" } }));
    expect(seen).toEqual(["cok"]);
    detach();
  });
});

describe("postToEmbedParent (forward up when the page itself is embedded)", () => {
  it("no-ops safely when there is no window (node/tests) — never throws", () => {
    expect(postToEmbedParent({ type: "ff:height", value: 480 })).toBe(false);
    expect(postToEmbedParent({ type: "ff:complete", submissionToken: "t" })).toBe(false);
  });
});
