// T20 runtime integration tests — ingest computes `next` via the T13 logic
// engine (ticket #20: "ingest computes next via engine (T14) — verify it
// consumes T13's package unchanged").
//
// Drives the REAL T14 `saveStep` service over in-memory fakes with the
// production engine wiring from engine.ts. The "single engine package"
// acceptance (spec §15 M5) is asserted by identity checks between the root
// and ./logic import surfaces of @formforge/core.

import { describe, expect, it } from "vitest";
import * as coreRoot from "@formforge/core";
import * as coreLogic from "@formforge/core/logic";
import {
  CaptureEventQueue,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  InMemorySubmissionsRepo,
  InMemoryUsageCounter,
  StubTurnstileVerifier,
  createBootstrapBlockRegistry,
  saveStep,
  startSubmission,
  type IngestDeps,
  type IngestRequestCtx,
} from "@formforge/core/submissions";
import type { Snapshot } from "@formforge/core/bridge";
import { npsScenarioRules } from "../logic/rules";
import { compiledRouting, engineEvaluate } from "./engine";

function makeDeps(snapshot: Snapshot): IngestDeps {
  return {
    repo: new InMemorySubmissionsRepo(),
    snapshots: { getPublishedSnapshot: async () => snapshot },
    blocks: createBootstrapBlockRegistry(),
    idempotency: new InMemoryIdempotencyStore(),
    rateLimiter: new InMemoryRateLimiter(),
    turnstile: new StubTurnstileVerifier(),
    queue: new CaptureEventQueue(),
    usage: new InMemoryUsageCounter(),
    now: () => new Date("2026-11-06T10:00:00.000Z"),
    generateId: () => "22222222-2222-4222-8222-222222222222",
    evaluate: engineEvaluate,
  };
}

const request: IngestRequestCtx = {
  requestId: "req_t20",
  actor: { type: "system", id: "public" },
  now: () => new Date("2026-11-06T10:00:00.000Z"),
};

function npsSnapshot(rules: ReturnType<typeof npsScenarioRules> = []): Snapshot {
  return {
    documentId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "ws_a",
    versionId: "ver_1",
    type: "form",
    title: "NPS form",
    blocks: [
      { id: "q_nps", kind: "nps", props: { label: "How likely to recommend?" } },
      { id: "q_comment", kind: "long-text", props: { label: "What went wrong?" } },
    ],
    endings: [
      { id: "end_a", title: "Ending A" },
      { id: "end_b", title: "Ending B" },
    ],
    // Compiled through the T13 engine exactly like the production deps wiring
    // (toSnapshot fallback) and the T13-based publish compiler would.
    routing: compiledRouting(
      rules,
      [
        { id: "q_nps", kind: "nps", props: {} },
        { id: "q_comment", kind: "long-text", props: {} },
      ],
      [{ id: "end_a" }, { id: "end_b" }],
    ),
    settings: { progressBar: true, autoAdvance: true, showBranding: true, captcha: false },
  };
}

async function startAndSave(
  deps: IngestDeps,
  answers: Array<{ blockId: string; value: unknown }>,
  hidden: Record<string, unknown> = {},
): Promise<{ next: string; hidden: Record<string, unknown> }> {
  const started = await startSubmission(deps, request, {
    documentId: "11111111-1111-4111-8111-111111111111",
    hidden,
    honeypot: "",
  });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error("start failed");
  const saved = await saveStep(deps, request, {
    token: started.value.token,
    answers: answers.map((a) => ({ ...a, clientTs: "2026-11-06T10:00:01.000Z" })),
    idempotencyKey: `idem_${answers.map((a) => a.blockId).join("_")}`,
  });
  expect(saved.ok).toBe(true);
  if (!saved.ok) throw new Error(`save failed: ${saved.error.message}`);
  const row = await deps.repo.getSubmissionByToken(started.value.token);
  return { next: saved.value.next, hidden: row?.hidden ?? {} };
}

describe("single engine package (spec §15 M5 acceptance)", () => {
  it("root and ./logic import surfaces of @formforge/core expose the same engine", () => {
    expect(coreRoot.evaluate).toBe(coreLogic.evaluate);
    expect(coreRoot.compile).toBe(coreLogic.compile);
    expect(coreRoot.lint).toBe(coreLogic.lint);
  });

  it("production wiring injects the T13 engine as LogicEvaluate", () => {
    expect(engineEvaluate).toBe(coreLogic.evaluate);
  });
});

describe("ingest computes next via the T13 engine — 'If NPS ≤ 6 go to ending B, otherwise ending A'", () => {
  it("returns end:end_b for NPS 4 (detractor rule)", async () => {
    const deps = makeDeps(npsSnapshot(npsScenarioRules("q_nps", "end_a", "end_b")));
    const { next } = await startAndSave(deps, [{ blockId: "q_nps", value: 4 }]);
    expect(next).toBe("end:end_b");
  });

  it("returns end:end_a for NPS 9 (fallback rule)", async () => {
    const deps = makeDeps(npsSnapshot(npsScenarioRules("q_nps", "end_a", "end_b")));
    const { next } = await startAndSave(deps, [{ blockId: "q_nps", value: 9 }]);
    expect(next).toBe("end:end_a");
  });

  it("falls back to the default flow when no rules exist", async () => {
    const deps = makeDeps(npsSnapshot());
    const { next } = await startAndSave(deps, [{ blockId: "q_nps", value: 7 }]);
    expect(next).toBe("q_comment");
  });
});

describe("hidden fields captured end-to-end (UTM → submission row)", () => {
  it("startSubmission persists the UTM hidden context", async () => {
    const deps = makeDeps(npsSnapshot());
    const { hidden } = await startAndSave(
      deps,
      [{ blockId: "q_nps", value: 4 }],
      { utm_source: "twitter", utm_campaign: "launch-week" },
    );
    expect(hidden).toEqual({ utm_source: "twitter", utm_campaign: "launch-week" });
  });
});

describe("compiledRouting fallback", () => {
  it("compiles raw snapshot rules into engine-ready route nodes", () => {
    const routing = compiledRouting(
      npsScenarioRules("q_nps", "end_a", "end_b"),
      [{ id: "q_nps", kind: "nps", props: {} }],
      [{ id: "end_a" }, { id: "end_b" }],
    );
    expect(routing["q_nps"]?.defaultNext).toBe("end:end_a");
    const rules = (routing["q_nps"]?.rules ?? []) as Array<{
      id?: string;
      conditions?: Array<{ ref?: { name?: string } }>;
      actions?: Array<{ kind?: string; target?: string }>;
    }>;
    expect(rules[0]?.id).toBe("rule_nps_detractor");
    expect(rules[0]?.conditions?.[0]?.ref).toMatchObject({ name: "q_nps" });
    expect(rules[0]?.actions?.[0]).toMatchObject({ kind: "goto", target: "end:end_b" });
  });
});
