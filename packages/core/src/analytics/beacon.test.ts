// T19 — beacon validation/normalization tests: batch contract, malformed
// rejection, session hashing (never store raw ids or IPs — spec §4).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { BEACON_MAX_EVENTS, buildPixelEvent, hashSessionId, parseBeaconBatch } from "./beacon";

const NOW = () => new Date("2026-11-06T12:00:00.000Z");

const validBatch = {
  documentId: "018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80",
  events: [
    { type: "view", sessionId: "visitor-1234" },
    { type: "question_view", sessionId: "visitor-1234", blockId: "b1", props: { step: 1 } },
  ],
};

describe("parseBeaconBatch", () => {
  it("normalizes a valid batch: hashes session, defaults ts to ctx.now", () => {
    const result = parseBeaconBatch(validBatch, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documentId).toBe(validBatch.documentId);
    expect(result.value.events).toHaveLength(2);
    const [first, second] = result.value.events;
    expect(first?.type).toBe("view");
    expect(first?.sessionHash).toBe(createHash("sha256").update("visitor-1234", "utf8").digest("hex"));
    expect(first?.ts.toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(second?.blockId).toBe("b1");
    expect(second?.props).toEqual({ step: 1 });
  });

  it("honors explicit client timestamps", () => {
    const result = parseBeaconBatch(
      { ...validBatch, events: [{ type: "view", sessionId: "visitor-1234", ts: "2026-11-05T08:30:00.000Z" }] },
      NOW,
    );
    if (!result.ok) throw result.error;
    expect(result.value.events[0]?.ts.toISOString()).toBe("2026-11-05T08:30:00.000Z");
  });

  it.each([
    ["empty events array", { documentId: "doc1", events: [] }],
    ["missing documentId", { events: [{ type: "view", sessionId: "visitor-1234" }] }],
    ["documentId with spaces", { documentId: "not ok", events: [{ type: "view", sessionId: "visitor-1234" }] }],
    ["unknown event type", { documentId: "doc1", events: [{ type: "scroll", sessionId: "visitor-1234" }] }],
    ["missing sessionId", { documentId: "doc1", events: [{ type: "view" }] }],
    ["sessionId too short", { documentId: "doc1", events: [{ type: "view", sessionId: "abc" }] }],
    ["non-object body", "hello"],
    ["null body", null],
  ])("rejects malformed batch: %s", (_label, body) => {
    const result = parseBeaconBatch(body, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(Array.isArray(result.error.details)).toBe(true);
  });

  it("rejects batches larger than the cap with a VALIDATION error", () => {
    const events = Array.from({ length: BEACON_MAX_EVENTS + 1 }, (_, i) => ({
      type: "view" as const,
      sessionId: `visitor-${String(i).padStart(4, "0")}`,
    }));
    const result = parseBeaconBatch({ documentId: "doc1", events }, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
  });

  it("accepts exactly the cap", () => {
    const events = Array.from({ length: BEACON_MAX_EVENTS }, (_, i) => ({
      type: "view" as const,
      sessionId: `visitor-${String(i).padStart(4, "0")}`,
    }));
    const result = parseBeaconBatch({ documentId: "doc1", events }, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("hashSessionId (spec §4: hash session ids, never store IPs)", () => {
  it("is deterministic sha256 and does not leak the raw id", () => {
    const hash = hashSessionId("visitor-1234");
    expect(hash).toBe(createHash("sha256").update("visitor-1234", "utf8").digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("visitor");
  });

  it("differs per visitor", () => {
    expect(hashSessionId("a")).not.toBe(hashSessionId("b"));
  });
});

describe("buildPixelEvent (GET 1x1 gif)", () => {
  it("builds a view event with hashed session", () => {
    const event = buildPixelEvent({ documentId: "doc1", sessionId: "visitor-1234" }, NOW);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      documentId: "doc1",
      type: "view",
      blockId: null,
      props: null,
      sessionHash: hashSessionId("visitor-1234"),
    });
  });

  it("defaults type to view and accepts explicit types + blockId", () => {
    expect(buildPixelEvent({ documentId: "doc1", sessionId: "visitor-1234", type: "start" }, NOW)?.type).toBe("start");
    expect(buildPixelEvent({ documentId: "doc1", sessionId: "visitor-1234", type: "question_pass", blockId: "b2" }, NOW)?.blockId).toBe("b2");
  });

  it("returns null for missing or invalid params (pixel stays silent)", () => {
    expect(buildPixelEvent({}, NOW)).toBeNull();
    expect(buildPixelEvent({ documentId: "doc1" }, NOW)).toBeNull();
    expect(buildPixelEvent({ documentId: "doc1", sessionId: "short" }, NOW)).toBeNull();
    expect(buildPixelEvent({ documentId: "doc1", sessionId: "visitor-1234", type: "nope" }, NOW)).toBeNull();
    expect(buildPixelEvent({ documentId: "doc 1", sessionId: "visitor-1234" }, NOW)).toBeNull();
  });

  it("drops overlong blockIds instead of rejecting the pixel", () => {
    expect(
      buildPixelEvent({ documentId: "doc1", sessionId: "visitor-1234", blockId: "x".repeat(200) }, NOW)?.blockId,
    ).toBeNull();
  });
});
