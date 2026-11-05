// Smoke test — sanity-check core semantics before the golden suite lands.
import { describe, expect, it } from "vitest";
import { compile, evaluate, lint, routeMap } from "../index.js";

const blocks = [
  { id: "b1", kind: "short-text", props: {} },
  { id: "b2", kind: "single-select", props: {} },
  { id: "b3", kind: "rating", props: {} },
];
const endings = ["done"];

describe("smoke", () => {
  it("default next walks document order and ends at end:<first>", () => {
    const routing = compile([], blocks, endings);
    expect(evaluate(routing, { answers: {}, variables: {}, hidden: {}, currentBlockId: "b1" }).nextBlockId).toBe("b2");
    expect(evaluate(routing, { answers: {}, variables: {}, hidden: {}, currentBlockId: "b3" }).nextBlockId).toBe("end:done");
    expect(evaluate(routing, { answers: {}, variables: {}, hidden: {}, currentBlockId: "start" }).nextBlockId).toBe("b1");
  });

  it("first matching rule wins and can goto backward/forward", () => {
    const routing = compile(
      [
        { id: "r2", scope: "b2", when: [{ left: "@block:b2", op: "eq", right: "optA" }], then: [{ type: "goto", target: "b1" }] },
        { id: "r1", scope: "b2", when: [{ left: "@block:b2", op: "eq", right: "optA" }], then: [{ type: "goto", target: "end:done" }] },
      ],
      blocks,
      endings,
    );
    const r = evaluate(routing, {
      answers: { b2: { optionId: "optA" } },
      variables: {},
      hidden: {},
      currentBlockId: "b2",
    });
    expect(r.nextBlockId).toBe("b1"); // r2 listed first wins
  });

  it("normalizes select answers to optionId", () => {
    const routing = compile(
      [{ id: "r", scope: "b1", when: [{ left: "@block:b2", op: "eq", right: "optB" }], then: [{ type: "set", var: "x", value: 1 }] }],
      blocks,
      endings,
    );
    const r = evaluate(routing, { answers: { b2: { optionId: "optB" } }, variables: {}, hidden: {}, currentBlockId: "b1" });
    expect(r.variables.x).toBe(1);
    expect(r.nextBlockId).toBe("b2");
  });

  it("unknown goto target falls back to default next at runtime", () => {
    const routing = compile(
      [{ id: "r", scope: "b1", when: [], then: [{ type: "goto", target: "nope" }] }],
      blocks,
      endings,
    );
    expect(routing.diagnostics.map((d) => d.code)).toContain("dangling_goto");
    expect(evaluate(routing, { answers: {}, variables: {}, hidden: {}, currentBlockId: "b1" }).nextBlockId).toBe("b2");
  });

  it("lint flags dangling, unknown scope, cycles, fallbacks", () => {
    const diags = lint(
      [
        { id: "a", scope: "ghost", when: [], then: [] },
        { id: "b", scope: "b1", when: [], then: [{ type: "goto", target: "end:missing" }] },
        { id: "c", scope: "b1", isFallback: true, when: [], then: [] },
        { id: "d", scope: "b1", isFallback: true, when: [], then: [] },
      ],
      [...blocks, { id: "b1", kind: "short-text", props: {} }],
      ["done"],
    );
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("unknown_scope");
    expect(codes).toContain("dangling_goto");
    expect(codes).toContain("multiple_fallbacks");
  });

  it("cycle with no exit is flagged; cycle with exit is not", () => {
    const bad = lint(
      [
        { id: "r1", scope: "b1", isFallback: true, when: [], then: [{ type: "goto", target: "b2" }] },
        { id: "r2", scope: "b2", isFallback: true, when: [], then: [{ type: "goto", target: "b1" }] },
      ],
      blocks,
      ["done"],
    );
    expect(bad.map((d) => d.code)).toContain("cycle_no_exit");

    const ok = lint(
      [{ id: "r1", scope: "b1", when: [{ left: "@block:b1", op: "eq", right: "x" }], then: [{ type: "goto", target: "b1" }] }],
      blocks,
      ["done"],
    );
    expect(ok.map((d) => d.code)).not.toContain("cycle_no_exit");
  });

  it("routeMap projects the flat snapshot shape", () => {
    const routing = compile([], blocks, endings);
    const map = routeMap(routing);
    expect(Object.keys(map).sort()).toEqual(["b1", "b2", "b3", "start"]);
    // evaluate accepts the flat shape directly
    expect(evaluate(map, { answers: {}, variables: {}, hidden: {}, currentBlockId: "b1" }).nextBlockId).toBe("b2");
  });
});
