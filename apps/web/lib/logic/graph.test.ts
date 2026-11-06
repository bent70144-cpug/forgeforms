// Tests for the logic canvas graph mapping (T20, spec §14.1.4).
// Asserted against spec literals: nodes = start, question blocks, endings;
// edges = default flow from document order; rule goto edges; lint errors via
// the T13 engine package (single import surface — spec §15 M5 acceptance).

import { describe, expect, it } from "vitest";
import type { DocumentBody } from "../bridge";
import {
  buildLogicGraph,
  endingNodeId,
  isDanglingTarget,
  logicLintErrors,
  questionBlocks,
  rulesWithDanglingTargets,
  START_NODE_ID,
} from "./graph";

function formBody(overrides: Partial<DocumentBody> = {}): DocumentBody {
  return {
    schemaVersion: 1,
    type: "form",
    theme: { tokens: {}, fontHeading: "Inter", fontBody: "Inter", radius: "md" },
    settings: {
      seo: {},
      locale: "en",
      progressBar: true,
      autoAdvance: true,
      showBranding: true,
      captcha: false,
      notifyEmails: [],
    },
    blocks: [],
    endings: [],
    logic: { rules: [] },
    ...overrides,
  };
}

const NPS_SCENARIO = formBody({
  blocks: [
    { id: "q_intro", kind: "hero", props: { title: "Welcome" } },
    { id: "q_nps", kind: "nps", props: { label: "How likely to recommend?" } },
    { id: "q_comment", kind: "long-text", props: { label: "What went wrong?" } },
  ],
  endings: [
    { id: "end_a", title: "Ending A — thanks!" },
    { id: "end_b", title: "Ending B — we're sorry" },
  ],
  logic: {
    rules: [
      {
        id: "r1",
        scope: "q_nps",
        when: [{ left: "@block:q_nps", op: "lte", right: 6 }],
        then: [{ type: "goto", target: "end:end_b" }],
        isFallback: false,
      },
      {
        id: "r2",
        scope: "q_nps",
        when: [],
        then: [{ type: "goto", target: "end:end_a" }],
        isFallback: true,
      },
    ],
  },
});

describe("buildLogicGraph", () => {
  it("renders start + question + ending nodes and skips non-question blocks", () => {
    const graph = buildLogicGraph(NPS_SCENARIO);
    expect(graph.nodes.map((n) => n.id)).toEqual([
      START_NODE_ID,
      "q_nps",
      "q_comment",
      "end:end_a",
      "end:end_b",
    ]);
    expect(graph.nodes[0]).toMatchObject({ kind: "start", label: "Start" });
    expect(graph.nodes[1]).toMatchObject({ kind: "question", questionKind: "nps" });
    expect(graph.nodes[3]).toMatchObject({ kind: "ending", endingId: "end_a" });
  });

  it("derives default-flow edges from document order (start → questions → first ending)", () => {
    const graph = buildLogicGraph(NPS_SCENARIO);
    const flow = graph.edges.filter((e) => !e.isRuleEdge);
    expect(flow).toEqual([
      { id: "flow:start->q_nps", source: "start", target: "q_nps", isRuleEdge: false },
      { id: "flow:q_nps->q_comment", source: "q_nps", target: "q_comment", isRuleEdge: false },
      {
        id: `flow:q_comment->${endingNodeId("end_a")}`,
        source: "q_comment",
        target: "end:end_a",
        isRuleEdge: false,
      },
    ]);
    expect(graph.order).toEqual(["q_nps", "q_comment"]);
  });

  it("renders rule goto edges as dashed rule edges", () => {
    const graph = buildLogicGraph(NPS_SCENARIO);
    const ruleEdges = graph.edges.filter((e) => e.isRuleEdge);
    expect(ruleEdges).toEqual([
      {
        id: "rule:r1:q_nps->end:end_b",
        source: "q_nps",
        target: "end:end_b",
        isRuleEdge: true,
        ruleId: "r1",
      },
      {
        id: "rule:r2:q_nps->end:end_a",
        source: "q_nps",
        target: "end:end_a",
        isRuleEdge: true,
        ruleId: "r2",
      },
    ]);
  });

  it("adds a virtual default ending node when no endings are configured", () => {
    const graph = buildLogicGraph(
      formBody({ blocks: [{ id: "q1", kind: "short-text", props: { label: "Name" } }] }),
    );
    expect(graph.nodes.map((n) => n.id)).toEqual([START_NODE_ID, "q1", "end:default"]);
    expect(graph.edges.at(-1)).toMatchObject({ source: "q1", target: "end:default" });
  });

  it("recurses into layout children for question blocks (document order)", () => {
    const body = formBody({
      blocks: [
        {
          id: "sec1",
          kind: "section",
          props: {},
          children: [{ id: "q_inner", kind: "email", props: { label: "Email" } }],
        },
        { id: "q2", kind: "short-text", props: { label: "Name" } },
      ],
    });
    expect(questionBlocks(body.blocks).map((b) => b.id)).toEqual(["q_inner", "q2"]);
  });

  it("produces no flow edges for an empty form", () => {
    const graph = buildLogicGraph(formBody());
    expect(graph.edges.filter((e) => !e.isRuleEdge)).toEqual([]);
    expect(graph.order).toEqual([]);
  });
});

describe("logicLintErrors (T13 engine, same package surface as publish gating)", () => {
  it("returns no errors for the valid NPS scenario", () => {
    expect(logicLintErrors(NPS_SCENARIO)).toEqual([]);
  });

  it("flags a dangling goto target as an error naming the rule", () => {
    const body = formBody({
      blocks: [{ id: "q1", kind: "short-text", props: { label: "Name" } }],
      endings: [{ id: "end_a", title: "A" }],
      logic: {
        rules: [
          {
            id: "rule_broken",
            scope: "q1",
            when: [{ left: "@block:q1", op: "eq", right: "x" }],
            then: [{ type: "goto", target: "end:missing_ending" }],
            isFallback: false,
          },
        ],
      },
    });
    const errors = logicLintErrors(body);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("dangling_goto");
    expect(errors[0]?.ruleId).toBe("rule_broken");
    // The rule id rides in the `ruleId` field; the publish adapter composes it
    // into the human-facing message (spec: "error naming the rule").
    expect(errors[0]?.message).toContain("end:missing_ending");
    expect(rulesWithDanglingTargets(body).map((r) => r.id)).toEqual(["rule_broken"]);
    expect(isDanglingTarget("end:missing_ending", body)).toBe(true);
    expect(isDanglingTarget("end:end_a", body)).toBe(false);
    expect(isDanglingTarget("q1", body)).toBe(false);
  });

  it("flags rules scoped to missing blocks", () => {
    const body = formBody({
      blocks: [{ id: "q1", kind: "short-text", props: {} }],
      logic: {
        rules: [
          { id: "r_lost", scope: "q_ghost", when: [], then: [], isFallback: false },
        ],
      },
    });
    const errors = logicLintErrors(body);
    expect(errors.some((e) => e.code === "unknown_scope" && e.ruleId === "r_lost")).toBe(true);
  });
});
