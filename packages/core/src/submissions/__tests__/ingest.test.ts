// packages/core/src/submissions/__tests__/ingest.test.ts
// T14 ingest service suite (issue #14 acceptance): full start→save→complete
// flow, idempotent replay, out-of-order saves, honeypot silence, rate limits,
// field-level validation and CONFLICT on double-complete.

import { describe, expect, it } from "vitest";
import { compile, evaluate, routeMap } from "../../logic/index.ts";
import type { Block, Rule } from "../../logic/types.ts";
import { shortId, uuidv7 } from "../../shared/ids.ts";
import type { IngestSnapshot } from "../types";
import {
  CaptureEventQueue,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  InMemorySubmissionsRepo,
  InMemoryUsageCounter,
  StubTurnstileVerifier,
  createBootstrapBlockRegistry,
  type BlockRegistry,
  type IngestDeps,
  type IngestRequestCtx,
  type SnapshotReader,
} from "../index";
import {
  MAX_PAYLOAD_BYTES,
  completeSubmission,
  payloadSizeError,
  saveStep,
  startSubmission,
} from "../ingest";

const registry: BlockRegistry = createBootstrapBlockRegistry();

const FORM_BLOCKS: Block[] = [
  { id: "b1", kind: "short-text", props: { label: "Name" } },
  { id: "b2", kind: "email", props: { label: "Email", required: true } },
  { id: "b3", kind: "single-select", props: { label: "Plan", options: [{ id: "opt_pro", label: "Pro" }] } },
];

function makeSnapshot(overrides: Partial<IngestSnapshot> = {}, rules: Rule[] = []): IngestSnapshot {
  // ISSUE #30: the canonical T13 `compile` lints goto targets against the
  // DECLARED endings, so the routing must be built from the snapshot's real
  // ending list (the old compileLite accepted any `end:*` target blindly).
  const endings = overrides.endings ?? [{ id: "end_1", title: "Thanks" }];
  return {
    documentId: uuidv7(),
    workspaceId: uuidv7(),
    versionId: uuidv7(),
    type: "form",
    title: "Test form",
    blocks: FORM_BLOCKS,
    endings,
    routing: routeMap(compile(rules, FORM_BLOCKS, endings.map((e) => e.id))),
    settings: { captcha: false },
    ...overrides,
  };
}

function makeDeps(snapshot: IngestSnapshot) {
  const repo = new InMemorySubmissionsRepo();
  const queue = new CaptureEventQueue();
  const usage = new InMemoryUsageCounter();
  const snapshots: SnapshotReader = {
    getPublishedSnapshot: async (documentId) =>
      documentId === snapshot.documentId ? snapshot : null,
  };
  const deps: IngestDeps = {
    repo,
    snapshots,
    blocks: registry,
    idempotency: new InMemoryIdempotencyStore(),
    rateLimiter: new InMemoryRateLimiter(),
    turnstile: new StubTurnstileVerifier(),
    queue,
    usage,
    now: () => new Date("2026-11-06T10:00:00.000Z"),
    generateId: uuidv7,
    evaluate,
  };
  return { deps, repo, queue, usage };
}

const ctx: IngestRequestCtx = {
  requestId: "req_test",
  actor: { type: "system", id: "public-ingest" },
  now: () => new Date("2026-11-06T10:00:00.000Z"),
};

const iso = (offsetSeconds: number) =>
  new Date(Date.parse("2026-11-06T10:00:00.000Z") + offsetSeconds * 1000).toISOString();

describe("startSubmission", () => {
  it("creates a draft submission, returns token + versionId, emits start event", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo, queue } = makeDeps(snapshot);

    const result = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.token.startsWith("sub_")).toBe(true);
    expect(result.value.versionId).toBe(snapshot.versionId);

    const stored = await repo.getSubmissionByToken(result.value.token);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("draft");
    expect(stored?.workspaceId).toBe(snapshot.workspaceId);
    expect(stored?.documentId).toBe(snapshot.documentId);

    expect(queue.byType("submission.started")).toHaveLength(1);
    expect(queue.byType("submission.completed")).toHaveLength(0);
  });

  it("accepts doc_ short ids and raw uuids alike", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);
    const shortForm = shortId("doc", snapshot.documentId);

    const viaShort = await startSubmission(deps, ctx, { documentId: shortForm });
    const viaUuid = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(viaShort.ok).toBe(true);
    expect(viaUuid.ok).toBe(true);
  });

  it("404s when the document is missing or not published", async () => {
    const { deps } = makeDeps(makeSnapshot());
    const result = await startSubmission(deps, ctx, { documentId: uuidv7() });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: "NOT_FOUND" }) });
  });

  it("rejects start past closeAt with FORBIDDEN", async () => {
    const snapshot = makeSnapshot({ settings: { captcha: false, closeAt: "2026-11-01T00:00:00.000Z" } });
    const { deps } = makeDeps(snapshot);
    const result = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: "FORBIDDEN" }) });
  });

  it("rejects start when maxSubmissions is reached", async () => {
    const snapshot = makeSnapshot({ settings: { captcha: false, maxSubmissions: 1 } });
    const { deps } = makeDeps(snapshot);

    const first = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await completeSubmission(deps, ctx, {
      token: first.value.token,
      answers: [{ blockId: "b2", value: "ana@example.com" }],
    });

    const second = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    expect(second).toEqual({ ok: false, error: expect.objectContaining({ code: "FORBIDDEN" }) });
  });

  it("verifies Turnstile when the document has captcha on", async () => {
    const snapshot = makeSnapshot({ settings: { captcha: true } });
    const { deps } = makeDeps(snapshot);
    deps.turnstile = new StubTurnstileVerifier(false);

    const result = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      turnstileToken: "bogus",
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: "FORBIDDEN" }) });

    deps.turnstile = new StubTurnstileVerifier(true);
    const okResult = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      turnstileToken: "good",
    });
    expect(okResult.ok).toBe(true);
  });

  it("honeypot hit is a silent success and stores nothing", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo, queue } = makeDeps(snapshot);

    const result = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      honeypot: "i-am-a-bot",
    });
    expect(result.ok).toBe(true);
    expect(repo.size).toBe(0);
    expect(queue.events).toHaveLength(0);
  });

  it("rate limits start at 60/min per IP with RATE_LIMITED", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);

    for (let i = 0; i < 60; i += 1) {
      const result = await startSubmission(deps, ctx, {
        documentId: snapshot.documentId,
        ip: "1.2.3.4",
      });
      expect(result.ok).toBe(true);
    }
    const limited = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      ip: "1.2.3.4",
    });
    expect(limited).toEqual({ ok: false, error: expect.objectContaining({ code: "RATE_LIMITED" }) });

    // A different IP still gets through.
    const otherIp = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      ip: "5.6.7.8",
    });
    expect(otherIp.ok).toBe(true);
  });

  it("replaying start with the same Idempotency-Key returns the same token", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = makeDeps(snapshot);

    const first = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      idempotencyKey: "key-start",
    });
    const replay = await startSubmission(deps, ctx, {
      documentId: snapshot.documentId,
      idempotencyKey: "key-start",
    });
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.value).toEqual(first.value);
    expect(repo.size).toBe(1);
  });
});

describe("saveStep", () => {
  async function started(deps: IngestDeps, snapshot: IngestSnapshot) {
    const result = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    if (!result.ok) throw new Error("start failed in test setup");
    return result.value.token;
  }

  it("validates, stores the answer and computes next via the logic engine", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const result = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b1", value: "Ana", clientTs: iso(1) }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next).toBe("b2");

    const answers = await repo.listAnswers((await repo.getSubmissionByToken(token))!.id);
    expect(answers).toEqual([
      { blockId: "b1", value: "Ana", updatedAt: new Date(iso(1)) },
    ]);
  });

  it("rejects answers failing the block answerSchema with field-level details", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const badEmail = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b2", value: "not-an-email", clientTs: iso(1) }],
    });
    expect(badEmail).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        details: [{ path: "answers[0].value", message: expect.stringContaining("email") }],
      },
    });

    const unknownBlock = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "nope", value: "x" }],
    });
    expect(unknownBlock).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        details: [{ path: "answers[0].blockId", message: expect.stringContaining("Unknown") }],
      },
    });

    // Server-side validate() runs even when the client bypasses it: option
    // not in the block's options list.
    const badOption = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b3", value: { optionId: "opt_unknown" } }],
    });
    expect(badOption).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", details: [{ path: "answers[0].value" }] },
    });
  });

  it("never overwrites a newer answer with an older one (out-of-order saves)", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const newer = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b1", value: "newer", clientTs: iso(30) }],
    });
    expect(newer.ok).toBe(true);

    const older = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b1", value: "older", clientTs: iso(10) }],
    });
    expect(older.ok).toBe(true); // stale save is accepted silently, just not applied

    const submission = (await repo.getSubmissionByToken(token))!;
    const answers = await repo.listAnswers(submission.id);
    expect(answers).toHaveLength(1);
    expect(answers[0]?.value).toBe("newer");
  });

  it("replaying a save with the same Idempotency-Key does not duplicate data", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const first = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b1", value: "Ana", clientTs: iso(1) }],
      idempotencyKey: "key-save-1",
    });
    const replay = await saveStep(deps, ctx, {
      token,
      // different payload — must NOT be applied; the stored response replays
      answers: [{ blockId: "b1", value: "Bob", clientTs: iso(2) }],
      idempotencyKey: "key-save-1",
    });

    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.value).toEqual(first.value);

    const submission = (await repo.getSubmissionByToken(token))!;
    const answers = await repo.listAnswers(submission.id);
    expect(answers).toEqual([{ blockId: "b1", value: "Ana", updatedAt: new Date(iso(1)) }]);
  });

  it("404s for unknown tokens and 409s once the submission is not draft", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);

    const missing = await saveStep(deps, ctx, {
      token: "sub_doesnotexist",
      answers: [],
    });
    expect(missing).toEqual({ ok: false, error: expect.objectContaining({ code: "NOT_FOUND" }) });

    const token = await started(deps, snapshot);
    await completeSubmission(deps, ctx, {
      token,
      answers: [{ blockId: "b2", value: "ana@example.com" }],
    });
    const afterComplete = await saveStep(deps, ctx, { token, answers: [] });
    expect(afterComplete).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CONFLICT" }),
    });
  });

  it("rate limits save at 120/min per token", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    for (let i = 0; i < 120; i += 1) {
      const result = await saveStep(deps, ctx, { token, answers: [] });
      expect(result.ok).toBe(true);
    }
    const limited = await saveStep(deps, ctx, { token, answers: [] });
    expect(limited).toEqual({ ok: false, error: expect.objectContaining({ code: "RATE_LIMITED" }) });
  });

  it("propagates set-variable rules through the logic engine", async () => {
    const rules: Rule[] = [
      {
        id: "r1",
        scope: "b3",
        when: [{ left: "@block:b3", op: "eq", right: "opt_pro" }],
        then: [{ type: "set", var: "plan", value: "pro" }],
      },
    ];
    const snapshot = makeSnapshot({}, rules);
    const { deps, repo } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const result = await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b3", value: { optionId: "opt_pro" }, clientTs: iso(1) }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variables).toEqual({ plan: "pro" });

    const submission = (await repo.getSubmissionByToken(token))!;
    expect(submission.variables).toEqual({ plan: "pro" });
  });
});

describe("completeSubmission", () => {
  async function started(deps: IngestDeps, snapshot: IngestSnapshot) {
    const result = await startSubmission(deps, ctx, { documentId: snapshot.documentId });
    if (!result.ok) throw new Error("start failed in test setup");
    return result.value.token;
  }

  it("finalizes the submission, reconciles answers and enqueues submission.completed", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo, queue, usage } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    await saveStep(deps, ctx, {
      token,
      answers: [{ blockId: "b2", value: "old@example.com", clientTs: iso(1) }],
    });

    // Reconcile: the final email value wins ("invalid email then corrected
    // stores only corrected value").
    const result = await completeSubmission(deps, ctx, {
      token,
      answers: [
        { blockId: "b1", value: "Ana", clientTs: iso(2) },
        { blockId: "b2", value: "ana@example.com", clientTs: iso(3) },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ endingId: "end_1", redirectUrl: null });

    const submission = (await repo.getSubmissionByToken(token))!;
    expect(submission.status).toBe("completed");
    expect(submission.completedAt).toEqual(new Date("2026-11-06T10:00:00.000Z"));
    const answers = await repo.listAnswers(submission.id);
    // ordered by updated_at: b1 saved at +2s, corrected b2 at +3s
    expect(answers.map((a) => [a.blockId, a.value])).toEqual([
      ["b1", "Ana"],
      ["b2", "ana@example.com"],
    ]);

    const completed = queue.byType("submission.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.workspaceId).toBe(snapshot.workspaceId);
    expect(completed[0]?.documentId).toBe(snapshot.documentId);
    expect(completed[0]?.data.submissionId).toBe(submission.id);
    expect(completed[0]?.data.answers).toEqual({
      b1: { label: "Name", value: "Ana" },
      b2: { label: "Email", value: "ana@example.com" },
    });
    expect(usage.counts.get(`${snapshot.workspaceId}:submissions.completed`)).toBe(1);
  });

  it("validates required blocks on the logic path", async () => {
    const snapshot = makeSnapshot();
    const { deps } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const result = await completeSubmission(deps, ctx, {
      token,
      answers: [{ blockId: "b1", value: "Ana" }], // b2 (required) unanswered
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        details: [{ path: "answers.b2", message: expect.stringContaining("required") }],
      },
    });
  });

  it("replays with the same Idempotency-Key and CONFLICTs without one", async () => {
    const snapshot = makeSnapshot();
    const { deps, repo, queue } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const first = await completeSubmission(deps, ctx, {
      token,
      answers: [{ blockId: "b2", value: "ana@example.com" }],
      idempotencyKey: "key-complete",
    });
    expect(first.ok).toBe(true);

    const replay = await completeSubmission(deps, ctx, {
      token,
      answers: [],
      idempotencyKey: "key-complete",
    });
    expect(first.ok && replay.ok && replay.value).toEqual(
      first.ok ? first.value : undefined,
    );
    expect(queue.byType("submission.completed")).toHaveLength(1); // no duplicate event
    expect(await repo.countCompleted(snapshot.documentId)).toBe(1);

    const otherSubmission = await started(deps, snapshot);
    await completeSubmission(deps, ctx, {
      token: otherSubmission,
      answers: [{ blockId: "b2", value: "x@y.dev" }],
    });
    const bareSecondCall = await completeSubmission(deps, ctx, {
      token: otherSubmission,
      answers: [],
    });
    expect(bareSecondCall).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "CONFLICT" }),
    });
  });

  it("honors goto rules and returns the matching ending + redirectUrl", async () => {
    const rules: Rule[] = [
      {
        id: "r1",
        scope: "b3",
        when: [{ left: "@block:b3", op: "eq", right: "opt_pro" }],
        then: [{ type: "goto", target: "end:end_pro" }],
      },
    ];
    const snapshot = makeSnapshot(
      {
        endings: [
          { id: "end_free", title: "Free" },
          { id: "end_pro", title: "Pro", redirectUrl: "https://example.com/pro" },
        ],
      },
      rules,
    );
    const { deps } = makeDeps(snapshot);
    const token = await started(deps, snapshot);

    const result = await completeSubmission(deps, ctx, {
      token,
      answers: [
        { blockId: "b1", value: "Ana" },
        { blockId: "b2", value: "ana@example.com" },
        { blockId: "b3", value: { optionId: "opt_pro" } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      endingId: "end_pro",
      redirectUrl: "https://example.com/pro",
    });
  });

  it("404s for unknown tokens", async () => {
    const { deps } = makeDeps(makeSnapshot());
    const result = await completeSubmission(deps, ctx, { token: "sub_nope", answers: [] });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: "NOT_FOUND" }) });
  });
});

describe("payload cap (spec §10.3)", () => {
  it("maps oversized payloads to a spec-shaped VALIDATION error", () => {
    expect(payloadSizeError(MAX_PAYLOAD_BYTES)).toBeNull();
    const error = payloadSizeError(MAX_PAYLOAD_BYTES + 1);
    expect(error).toBeInstanceOf(Error);
    expect(error?.code).toBe("VALIDATION");
  });
});
