// Unit tests for the pure canvas-editing helpers (builder spec §5, §6.4).
// No React, no DOM — plain node env.
import { describe, expect, it } from "vitest";
import type { Block, Rule } from "@formforge/schema";
import {
  clipboardEnvelope,
  convertKindBlock,
  convertTargetKind,
  hasLogicReference,
  logicReferencedIds,
  moveByOffset,
  nextSelectionAfterRemove,
  quickInsertOp,
} from "./canvas-ops";
import { applyOps, emptyBody, type Op } from "./ops";

const q = (id: string, label: string, kind = "short-text"): Block => ({
  id,
  kind,
  props: { label },
});

const FIXTURE: Block[] = [
  q("a", "First"),
  {
    id: "sec",
    kind: "section",
    props: { background: "none", padding: "md" },
    children: [q("s1", "Inner one"), q("s2", "Inner two")],
  },
  q("c", "Last"),
];

const rule = (patch: {
  id: string;
  scope?: string;
  when?: Array<{ left: string }>;
  goto?: string;
}): Rule => ({
  id: patch.id,
  scope: patch.scope ?? "start",
  when: (patch.when ?? []).map((c) => ({ ...c, op: "eq" as const })),
  then: patch.goto ? [{ type: "goto" as const, target: patch.goto }] : [],
  isFallback: false,
});

describe("moveByOffset", () => {
  it("moves a root block down by one", () => {
    const op = moveByOffset(FIXTURE, "a", 1);
    expect(op).toEqual({ op: "block.move", id: "a", parentId: null, index: 1 });
    // ...and the op actually produces the intended order when applied.
    const doc = applyOps(
      { meta: { title: "t" }, body: { ...emptyBody("form"), blocks: FIXTURE } },
      [op as Op],
    );
    expect(doc.body.blocks.map((b) => b.id)).toEqual(["sec", "a", "c"]);
  });

  it("moves a root block up by one", () => {
    const op = moveByOffset(FIXTURE, "c", -1);
    expect(op).toEqual({ op: "block.move", id: "c", parentId: null, index: 1 });
  });

  it("clamps overshooting deltas to the list bounds", () => {
    expect(moveByOffset(FIXTURE, "a", 5)).toEqual({ op: "block.move", id: "a", parentId: null, index: 2 });
    expect(moveByOffset(FIXTURE, "c", -5)).toEqual({ op: "block.move", id: "c", parentId: null, index: 0 });
  });

  it("returns null at the boundaries and for no-op deltas", () => {
    expect(moveByOffset(FIXTURE, "a", -1)).toBeNull();
    expect(moveByOffset(FIXTURE, "c", 1)).toBeNull();
    expect(moveByOffset(FIXTURE, "a", 0)).toBeNull();
  });

  it("keeps nested moves inside their parent list (cross-parent safe)", () => {
    expect(moveByOffset(FIXTURE, "s1", -1)).toBeNull(); // first child, can't go up
    expect(moveByOffset(FIXTURE, "s2", -1)).toEqual({
      op: "block.move",
      id: "s2",
      parentId: "sec",
      index: 0,
    });
  });

  it("returns null for unknown ids", () => {
    expect(moveByOffset(FIXTURE, "ghost", 1)).toBeNull();
  });
});

describe("quickInsertOp", () => {
  it("builds a root-level block.insert op with default props", () => {
    const { op, block } = quickInsertOp("short-text", 2, null, () => "fresh1");
    expect(op).toEqual({ op: "block.insert", parentId: null, index: 2, block });
    expect(block.id).toBe("fresh1");
    expect(block.kind).toBe("short-text");
    expect(block.props.label).toBe("Short text question");
    expect(block.children).toBeUndefined();
  });

  it("targets a container parent and gives containers an empty children list", () => {
    const { op, block } = quickInsertOp("section", 0, "sec", () => "fresh2");
    expect(op).toMatchObject({ op: "block.insert", parentId: "sec", index: 0 });
    expect(block.children).toEqual([]);
  });

  it("still mints a block for kinds without catalog metadata", () => {
    const { block } = quickInsertOp("mystery-kind", 0, null, () => "fresh3");
    expect(block).toEqual({ id: "fresh3", kind: "mystery-kind", props: {} });
  });
});

describe("nextSelectionAfterRemove", () => {
  it("selects the following sibling", () => {
    expect(nextSelectionAfterRemove(FIXTURE, "a")).toBe("sec");
  });

  it("falls back to the previous sibling at the end of the list", () => {
    expect(nextSelectionAfterRemove(FIXTURE, "c")).toBe("sec");
  });

  it("returns null when the list becomes empty", () => {
    expect(nextSelectionAfterRemove([q("only", "Only")], "only")).toBeNull();
  });

  it("selects within the containing parent's children list", () => {
    expect(nextSelectionAfterRemove(FIXTURE, "s1")).toBe("s2");
  });

  it("returns null for unknown ids", () => {
    expect(nextSelectionAfterRemove(FIXTURE, "ghost")).toBeNull();
  });
});

describe("convertKindBlock", () => {
  const single: Block = {
    id: "s1",
    kind: "single-select",
    props: { label: "Pick one", options: [{ id: "o1", label: "One" }], allowOther: true, randomize: true },
  };
  const drop: Block = {
    id: "d1",
    kind: "dropdown",
    props: { label: "Choose", options: [{ id: "o1", label: "One" }], searchable: true },
  };

  it("converts single-select to dropdown, keeping shared props and id", () => {
    const out = convertKindBlock(single, "dropdown");
    expect(out).not.toBeNull();
    expect(out?.kind).toBe("dropdown");
    expect(out?.id).toBe("s1");
    expect(out?.props).toEqual({ label: "Pick one", options: [{ id: "o1", label: "One" }] });
  });

  it("converts dropdown to single-select, dropping kind-specific flags", () => {
    const out = convertKindBlock(drop, "single-select");
    expect(out?.kind).toBe("single-select");
    expect(out?.props).toEqual({ label: "Choose", options: [{ id: "o1", label: "One" }] });
  });

  it("rejects unsupported source kinds and mismatched targets", () => {
    expect(convertKindBlock(q("t", "Text"), "dropdown")).toBeNull();
    expect(convertKindBlock(single, "short-text")).toBeNull();
  });

  it("reports the legal conversion target per kind", () => {
    expect(convertTargetKind("single-select")).toBe("dropdown");
    expect(convertTargetKind("dropdown")).toBe("single-select");
    expect(convertTargetKind("short-text")).toBeNull();
  });
});

describe("hasLogicReference / logicReferencedIds", () => {
  const rules: Rule[] = [
    rule({ id: "r1", scope: "a" }),
    rule({ id: "r2", when: [{ left: "@block:b" }] }),
    rule({ id: "r3", goto: "c" }),
    rule({ id: "r4", goto: "end:end1" }),
  ];

  it("detects scope, condition and goto references", () => {
    expect(hasLogicReference(rules, "a")).toBe(true);
    expect(hasLogicReference(rules, "b")).toBe(true);
    expect(hasLogicReference(rules, "c")).toBe(true);
  });

  it("ignores ending targets and unrelated blocks", () => {
    expect(hasLogicReference(rules, "end1")).toBe(false);
    expect(hasLogicReference(rules, "zz")).toBe(false);
  });

  it("collects the referenced id set once", () => {
    expect(logicReferencedIds(rules)).toEqual(new Set(["a", "b", "c"]));
    expect(logicReferencedIds([])).toEqual(new Set());
  });
});

describe("clipboardEnvelope", () => {
  it("wraps a block in the versioned cross-tab envelope", () => {
    const block = q("x", "Hello");
    expect(JSON.parse(clipboardEnvelope(block))).toEqual({ formforge: 1, blocks: [block] });
  });
});
