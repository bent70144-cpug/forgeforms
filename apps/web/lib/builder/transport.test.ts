// Tests for the ApiTransport wire parsing (spec §22.1):
//   200 { rev, updatedAt }          → PatchResult
//   409 { rev, body }               → ConflictError(rev, body)   (§7.3 rebase)
//   422 { opIndex, code, message }  → OpRejectedError            (§14 rollback)
// plus the §4 error-envelope fallbacks and the MockTransport 422 parity.

import { describe, expect, it, vi } from "vitest";
import { emptyBody, type Op } from "./ops";
import {
  ApiTransport,
  ConflictError,
  ForbiddenError,
  MockTransport,
  OpRejectedError,
  PlanLimitError,
  TransportError,
  UnauthenticatedError,
  seedEnvelope,
} from "./transport";

type FetchCall = { url: string; init?: RequestInit };

/** Fetch fake returning a scripted sequence of Responses; records calls. */
function fetchFake(responses: Array<Response | ((call: FetchCall, n: number) => Response)>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const n = calls.length;
    calls.push({ url, init });
    const res = responses[n];
    if (!res) throw new Error(`unexpected fetch call #${n + 1}`);
    return typeof res === "function" ? res(calls[n] as FetchCall, n) : res;
  });
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ops: Op[] = [{ op: "meta.update", patch: { title: "Renamed" } }];

describe("ApiTransport.patch", () => {
  it("sends PATCH { baseRev, ops } and returns the 200 { rev } payload", async () => {
    const { fn, calls } = fetchFake([jsonResponse(200, { rev: 7, updatedAt: "2024-01-01T00:00:00Z" })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const res = await transport.patch("doc1", 6, ops);

    expect(res).toEqual({ rev: 7, updatedAt: "2024-01-01T00:00:00Z" });
    const call = calls[0];
    expect(call?.url).toBe("/api/v1/documents/doc1");
    expect(call?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(call?.init?.body))).toEqual({ baseRev: 6, ops });
  });

  it("parses 409 { rev, body } from the top level (spec §22.1)", async () => {
    const body = emptyBody("form");
    const { fn } = fetchFake([jsonResponse(409, { error: { code: "CONFLICT", message: "stale" }, rev: 9, body })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 6, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).rev).toBe(9);
    expect((err as ConflictError).body).toEqual(body);
  });

  it("falls back to error.details.rev when the 409 body has no top-level rev", async () => {
    const { fn } = fetchFake([
      jsonResponse(409, { error: { code: "CONFLICT", details: [{ rev: 4 }] } }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 3, ops).catch((e: unknown) => e);

    expect((err as ConflictError).rev).toBe(4);
    expect((err as ConflictError).body).toBeUndefined();
  });

  it("parses 422 { opIndex, code, message } from the top level (spec §22.1)", async () => {
    const { fn } = fetchFake([
      jsonResponse(422, { opIndex: 2, code: "NOT_FOUND", message: "block b2 not found" }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport
      .patch("doc1", 1, [{ op: "meta.update", patch: { title: "a" } }, ...ops, { op: "meta.update", patch: { title: "c" } }])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpRejectedError);
    const rejected = err as OpRejectedError;
    expect(rejected.opIndex).toBe(2);
    expect(rejected.code).toBe("NOT_FOUND");
    expect(rejected.message).toBe("block b2 not found");
    expect(rejected.status).toBe(422);
  });

  it("recovers opIndex from the §4 details path ('ops[3].id') on legacy 422s", async () => {
    const { fn } = fetchFake([
      jsonResponse(422, {
        error: {
          code: "VALIDATION",
          message: "Invalid ops",
          details: [{ path: "ops[3].id", message: "block not found" }],
        },
      }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpRejectedError);
    expect((err as OpRejectedError).opIndex).toBe(3);
    expect((err as OpRejectedError).code).toBe("VALIDATION");
  });

  it("reports opIndex null for a 422 without any parsable index", async () => {
    const { fn } = fetchFake([jsonResponse(422, { error: { code: "VALIDATION", message: "nope" } })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpRejectedError);
    expect((err as OpRejectedError).opIndex).toBeNull();
  });

  it("maps other error envelopes to TransportError with the §4 code", async () => {
    const { fn } = fetchFake([jsonResponse(500, { error: { code: "INTERNAL", message: "boom" } })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).code).toBe("INTERNAL");
    expect((err as TransportError).status).toBe(500);
  });

  // §7.1 follow-up #3: expired credentials must be distinguishable so the
  // autosave controller can park + prompt instead of retrying.
  it("maps a plain 401 to UnauthenticatedError (follow-up #3)", async () => {
    const { fn } = fetchFake([jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Session expired" } })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect((err as UnauthenticatedError).status).toBe(401);
    expect((err as UnauthenticatedError).message).toBe("Session expired");
  });

  it("maps a 401 with a non-JSON body to UnauthenticatedError", async () => {
    const { fn } = fetchFake([
      new Response("<html>gateway timeout</html>", { status: 401 }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect((err as UnauthenticatedError).status).toBe(401);
  });

  it("maps the §4 'Authentication required' FORBIDDEN (403) to UnauthenticatedError", async () => {
    // This app's §4 vocabulary has no 401: session-less requests answer 403
    // (app/api/v1/_lib/auth.ts) — the exact wire shape the browser sees.
    const { fn } = fetchFake([
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Authentication required: session cookie or Authorization: Bearer ff_…" },
      }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthenticatedError);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as UnauthenticatedError).status).toBe(403);
    expect((err as UnauthenticatedError).code).toBe("FORBIDDEN");
  });

  it("keeps a scope-missing FORBIDDEN (403) as a plain TransportError", async () => {
    // A viewer hitting docs:write is NOT re-authable — no re-auth prompt.
    // (follow-up #8: answered with ForbiddenError, which still extends TransportError.)
    const { fn } = fetchFake([
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Missing required scope: docs:write" },
      }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TransportError);
    expect(err).not.toBeInstanceOf(UnauthenticatedError);
  });

  // §14 plan-limit answers (follow-up #8): 402 PLAN_LIMIT / 403 FORBIDDEN get
  // typed errors so the autosave controller explains instead of dead-ending.
  it("maps 402 PLAN_LIMIT to PlanLimitError carrying capability + requiredPlan", async () => {
    const { fn } = fetchFake([
      jsonResponse(402, {
        error: {
          code: "PLAN_LIMIT",
          message: "Plan limit reached",
          details: [
            { path: "capability", message: "notifyEmailsLimit" },
            { path: "requiredPlan", message: "pro" },
            { path: "need", message: "2" },
          ],
        },
      }),
    ]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PlanLimitError);
    expect((err as PlanLimitError).status).toBe(402);
    expect((err as PlanLimitError).code).toBe("PLAN_LIMIT");
    expect((err as PlanLimitError).capability).toBe("notifyEmailsLimit");
    expect((err as PlanLimitError).requiredPlan).toBe("pro");
  });

  it("maps a bare 402 (no details) to PlanLimitError with null capability", async () => {
    const { fn } = fetchFake([jsonResponse(402, { error: { message: "nope" } })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PlanLimitError);
    expect((err as PlanLimitError).capability).toBeNull();
    expect((err as PlanLimitError).requiredPlan).toBeNull();
  });

  it("maps 403 FORBIDDEN to ForbiddenError", async () => {
    const { fn } = fetchFake([jsonResponse(403, { error: { code: "FORBIDDEN", message: "read-only" } })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const err = await transport.patch("doc1", 1, ops).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).status).toBe(403);
    expect((err as ForbiddenError).code).toBe("FORBIDDEN");
  });
});

describe("ApiTransport.load", () => {
  it("returns the envelope and tolerates the { document } wrapper", async () => {
    const envelope = seedEnvelope("doc1");
    const { fn } = fetchFake([jsonResponse(200, { document: envelope })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    const loaded = await transport.load("doc1");

    expect(loaded.id).toBe("doc1");
    expect(loaded.rev).toBe(envelope.rev);
    expect(loaded.body).toEqual(envelope.body);
  });

  it("rejects malformed payloads with a TransportError", async () => {
    const { fn } = fetchFake([jsonResponse(200, { hello: "world" })]);
    const transport = new ApiTransport("/api/v1", fn as unknown as typeof fetch);

    await expect(transport.load("doc1")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("MockTransport", () => {
  it("reports the first failing op index on invalid batches", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    const err = await mock
      .patch("doc1", 1, [
        { op: "meta.update", patch: { title: "ok" } },
        { op: "block.update", id: "ghost-1", props: { label: "x" } },
        { op: "block.update", id: "ghost-2", props: { label: "y" } },
      ])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpRejectedError);
    expect((err as OpRejectedError).opIndex).toBe(1);
    expect((err as OpRejectedError).code).toBe("VALIDATION");
    expect((err as OpRejectedError).status).toBe(422);
  });

  it("still succeeds when every op applies", async () => {
    const mock = new MockTransport({ latencyMs: 0, seed: [seedEnvelope("doc1")] });
    const res = await mock.patch("doc1", 1, [
      { op: "meta.update", patch: { title: "a" } },
      { op: "meta.update", patch: { title: "b" } },
    ]);
    expect(res.rev).toBe(2);
  });
});
