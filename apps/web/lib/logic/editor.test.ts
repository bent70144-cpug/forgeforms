// Tests for the logic editor autosave loop (T20 acceptance: "editing a rule
// autosaves ≤2s with Saved chip" + rule.upsert/rule.remove wire format for
// `PATCH /api/v1/documents/:id`, spec §8).
//
// Two layers:
// 1. Runtime loop over MockTransport (fake timers) — ops → 500 ms debounce →
//    PATCH → Saved chip within 2 s.
// 2. ApiTransport against a fetch mock — the exact JSON body T07's endpoint
//    must accept for rule ops (TODO(merge) alignment checklist item).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiTransport, ConflictError, MockTransport, seedEnvelope } from "../builder/transport";
import type { DocumentEnvelope } from "../bridge";
import { removeRuleOp, ruleFromDraft, upsertRuleOp, type RuleDraft } from "./rules";
import { createLogicEditorRuntime, type LogicEditorRuntime } from "./editor";

function envelope(overrides: Partial<DocumentEnvelope> = {}): DocumentEnvelope {
  return {
    ...seedEnvelope("doc_logic"),
    id: "doc_logic",
    rev: 1,
    ...overrides,
  };
}

function gotoRuleDraft(scope: string, target: string): RuleDraft {
  return {
    id: "rule_t20",
    scope,
    conditions: [{ key: "c1", source: "block", ref: scope, op: "lte", right: "6" }],
    actions: [{ key: "a1", kind: "goto", target }],
    isFallback: false,
  };
}

describe("logic editor runtime (MockTransport, fake timers)", () => {
  let runtime: LogicEditorRuntime | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    runtime?.destroy();
    runtime = null;
    vi.useRealTimers();
  });

  function makeRuntime(): { rt: LogicEditorRuntime; transport: MockTransport } {
    const transport = new MockTransport({ seed: [envelope()], latencyMs: 0 });
    const rt = createLogicEditorRuntime({
      transport,
      docId: "doc_logic",
      envelope: envelope(),
    });
    runtime = rt;
    return { rt, transport };
  }

  it("autosaves a rule.upsert ≤2 s after the edit and lands on the Saved chip", async () => {
    const { rt } = makeRuntime();
    expect(rt.snapshot().save).toBe("idle");

    rt.apply([upsertRuleOp(gotoRuleDraft("q1", "end:end1"))]);
    expect(rt.snapshot().save).toBe("dirty");
    expect(rt.snapshot().body.logic.rules).toHaveLength(1);

    // Still inside the 500 ms debounce window…
    await vi.advanceTimersByTimeAsync(499);
    expect(rt.snapshot().save).toBe("dirty");

    // …then the flush fires (500 ms debounce + 0 ms transport latency) — far
    // inside the 2 s budget from spec §14.2.
    await vi.advanceTimersByTimeAsync(1);
    expect(rt.snapshot().save).toBe("saved");
    expect(rt.snapshot().savedAt).toBeTypeOf("number");
    expect(rt.snapshot().body.logic.rules[0]).toMatchObject({ id: "rule_t20", scope: "q1" });
  });

  it("merges rapid rule edits into debounced batches without data loss", async () => {
    const { rt } = makeRuntime();
    const draft1 = gotoRuleDraft("q1", "end:end1");
    rt.apply([upsertRuleOp(draft1)]);
    const updated: RuleDraft = {
      ...draft1,
      actions: [{ key: "a1", kind: "goto", target: "end:end2" }],
    };
    rt.apply([upsertRuleOp(updated)]); // upsert same rule id → replaces
    await vi.advanceTimersByTimeAsync(1000);
    expect(rt.snapshot().save).toBe("saved");
    expect(rt.snapshot().body.logic.rules).toHaveLength(1);
    expect(rt.snapshot().body.logic.rules[0]?.then[0]).toEqual({
      type: "goto",
      target: "end:end2",
    });
  });

  it("persists rule.remove and undo re-sends the inverse rule.upsert", async () => {
    const { rt } = makeRuntime();
    rt.apply([upsertRuleOp(gotoRuleDraft("q1", "end:end1"))]);
    await vi.advanceTimersByTimeAsync(600);
    expect(rt.snapshot().save).toBe("saved");

    rt.apply([removeRuleOp("rule_t20")]);
    await vi.advanceTimersByTimeAsync(600);
    expect(rt.snapshot().body.logic.rules).toHaveLength(0);
    expect(rt.snapshot().save).toBe("saved");

    rt.undo(); // inverse of rule.remove → rule.upsert (T08 ops invertOps)
    await vi.advanceTimersByTimeAsync(600);
    expect(rt.snapshot().body.logic.rules).toHaveLength(1);
    expect(rt.snapshot().save).toBe("saved");
  });

  it("recovers from a 409 (concurrent writer) without losing the rule edit", async () => {
    const { rt, transport } = makeRuntime();
    transport.bumpRev("doc_logic"); // concurrent writer → next PATCH 409s
    rt.apply([upsertRuleOp(gotoRuleDraft("q1", "end:end1"))]);
    await vi.advanceTimersByTimeAsync(500); // flush → 409 → reload + replay
    await vi.advanceTimersByTimeAsync(500); // re-send with the fresh rev
    expect(rt.snapshot().save).toBe("saved");
    expect(rt.snapshot().body.logic.rules[0]?.id).toBe("rule_t20");
  });
});

describe("ApiTransport wire format for rule ops (fetch-mocked)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes { baseRev, ops: [rule.upsert] } and acks the new rev", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ rev: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = new ApiTransport("/api/v1");
    const rule = ruleFromDraft(gotoRuleDraft("q_nps", "end:end_b"));
    const result = await transport.patch("doc_logic", 6, [
      upsertRuleOp({ ...gotoRuleDraft("q_nps", "end:end_b"), id: rule.id }),
    ]);

    expect(result.rev).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/documents/doc_logic");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as {
      baseRev: number;
      ops: Array<{ op: string; rule?: unknown; id?: string }>;
    };
    expect(body.baseRev).toBe(6);
    expect(body.ops).toHaveLength(1);
    expect(body.ops[0]?.op).toBe("rule.upsert");
    expect(body.ops[0]?.rule).toMatchObject({
      id: rule.id,
      scope: "q_nps",
      when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
      then: [{ type: "goto", target: "end:end_b" }],
      isFallback: false,
    });
  });

  it("PATCHes { op: 'rule.remove', id } for rule removals", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ rev: 9 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new ApiTransport("/api/v1");
    await transport.patch("doc_logic", 8, [removeRuleOp("rule_t20")]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      ops: Array<{ op: string; id?: string }>;
    };
    expect(body.ops[0]).toEqual({ op: "rule.remove", id: "rule_t20" });
  });

  it("maps a 409 to ConflictError carrying the server rev (409 recovery contract)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: "stale" }, rev: 12 }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new ApiTransport("/api/v1");
    const error = await transport
      .patch("doc_logic", 6, [removeRuleOp("rule_t20")])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).rev).toBe(12);
  });
});
