// Event/webhook payload contract tests — canonical serialization must be
// byte-stable (signatures are computed over exact bytes; jsonb round-trips do
// not preserve key order).
import { describe, expect, it } from "vitest";
import { SUBMISSION_COMPLETED_EVENT_TYPE, canonicalJson, parseSubmissionCompletedEvent, serializeWebhookBody, type SubmissionCompletedEvent } from "./webhook-payload";
import { err, ok } from "../shared/result.ts";;

const validEvent: SubmissionCompletedEvent = {
  id: "e3333333-3333-3333-3333-333333333333",
  type: SUBMISSION_COMPLETED_EVENT_TYPE,
  occurredAt: "2026-11-06T10:00:00.000Z",
  workspaceId: "w4444444-4444-4444-4444-444444444444",
  documentId: "d1111111-1111-1111-1111-111111111111",
  data: {
    submissionId: "s2222222-2222-2222-2222-222222222222",
    answers: { b1: { label: "Email", value: "ana@example.com" } },
    hidden: { utm_source: "x" },
    variables: { score: 7 },
  },
};

describe("parseSubmissionCompletedEvent", () => {
  it("accepts a valid payload", () => {
    const result = parseSubmissionCompletedEvent(validEvent);
    expect(result).toEqual(ok(validEvent));
  });

  it("rejects wrong type, missing ids, bad dates and malformed answers", () => {
    expect(parseSubmissionCompletedEvent(null)).toEqual(err(expect.anything()));
    expect(parseSubmissionCompletedEvent({ ...validEvent, type: "other" }).ok).toBe(false);
    expect(parseSubmissionCompletedEvent({ ...validEvent, id: "" }).ok).toBe(false);
    expect(parseSubmissionCompletedEvent({ ...validEvent, occurredAt: "not-a-date" }).ok).toBe(false);
    expect(parseSubmissionCompletedEvent({ ...validEvent, data: { ...validEvent.data, answers: "x" } }).ok).toBe(false);
    expect(
      parseSubmissionCompletedEvent({ ...validEvent, data: { ...validEvent.data, answers: { b1: "nope" } } }).ok,
    ).toBe(false);
  });

  it("defaults hidden/variables to empty objects", () => {
    const result = parseSubmissionCompletedEvent({
      ...validEvent,
      data: { ...validEvent.data, hidden: undefined, variables: undefined },
    });
    if (result.ok) {
      expect(result.value.data.hidden).toEqual({});
      expect(result.value.data.variables).toEqual({});
    } else {
      expect.unreachable("expected ok");
    }
  });
});

describe("canonicalJson", () => {
  it("sorts object keys recursively and is byte-stable", () => {
    const a = canonicalJson({ b: 1, a: { d: [3, 1, 2], c: "x" } });
    const b = canonicalJson({ a: { c: "x", d: [3, 1, 2] }, b: 1 });
    expect(a).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
    expect(a).toBe(b);
  });

  it("preserves array order and handles scalars", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson("hi")).toBe('"hi"');
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
  });

  it("produces the same bytes for a jsonb round-trip of the event", () => {
    const before = serializeWebhookBody(validEvent);
    const roundTripped = JSON.parse(before) as Record<string, unknown>;
    // Simulate Postgres jsonb: key order is not preserved.
    const after = canonicalJson(roundTripped);
    expect(after).toBe(before);
  });

  it("serializes the full event deterministically", () => {
    const body = serializeWebhookBody(validEvent);
    expect(() => JSON.parse(body)).not.toThrow();
    expect(serializeWebhookBody(validEvent)).toBe(body);
  });
});
