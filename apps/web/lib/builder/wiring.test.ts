// Wave-3 integration glue — pure planning helpers behind BuilderPage's wiring
// (node env, no DOM). Covers §7.2 recovery planning, §6.4 clipboard planning,
// §7.4/§14 banner precedence, the §14 rejection notice copy and the §22.2
// offline-queue singleton's HMR guard.

import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/bridge";
import { emptyBody, type Op } from "./ops";
import { initialEditorState, type EditorState } from "./store";
import {
  bannerKindFor,
  countRecoveryEdits,
  planCopyBlocks,
  planPasteOps,
  planRecovery,
  rejectionNoticeText,
  sharedOfflineQueue,
} from "./wiring";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function block(id: string, kind: string, props: Record<string, unknown>, children?: Block[]): Block {
  return { id, kind, props, ...(children ? { children } : {}) };
}

const TREE: Block[] = [
  block("q1", "short-text", { label: "First" }),
  block("sec1", "section", {}, [block("q2", "email", { label: "Inside" })]),
  block("q3", "long-text", { label: "Last" }),
];

function stateWith(selection: string | null, blocks: Block[] = TREE): EditorState {
  return {
    ...initialEditorState("doc1"),
    ready: true,
    body: { ...emptyBody("form"), blocks },
    selection,
  };
}

const record = (baseRev: number, ops: unknown[] = [{ op: "meta.update", patch: { title: "x" } }]) =>
  ({ docId: "doc1", baseRev, ops, updatedAt: 1 }) as Parameters<typeof planRecovery>[0];

// ---------------------------------------------------------------------------
// planRecovery (§7.2)
// ---------------------------------------------------------------------------

describe("planRecovery (§7.2)", () => {
  it("offers restore when the stored baseRev matches the loaded rev", () => {
    expect(planRecovery(record(7), 7)).toBe("restore");
  });

  it("offers discard-only when the record predates the loaded rev", () => {
    expect(planRecovery(record(5), 7)).toBe("discard-stale");
  });

  it("returns null without a record, for empty ops, or a future baseRev", () => {
    expect(planRecovery(null, 7)).toBeNull();
    expect(planRecovery(undefined, 7)).toBeNull();
    expect(planRecovery(record(7, []), 7)).toBeNull(); // nothing to restore
    expect(planRecovery(record(9), 7)).toBeNull(); // nonsense; recoverPending drops these
  });

  it("counts ops for the prompt copy", () => {
    expect(countRecoveryEdits([1, 2, 3] as never[])).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// planCopyBlocks / planPasteOps (§6.4)
// ---------------------------------------------------------------------------

describe("planCopyBlocks (§6.4 copy = selected subtree)", () => {
  it("returns the selected block (with its children) as a single-root list", () => {
    const blocks = planCopyBlocks(stateWith("sec1"));
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]?.id).toBe("sec1");
    expect(blocks?.[0]?.children?.[0]?.id).toBe("q2");
  });

  it("returns null with no selection or a stale selection", () => {
    expect(planCopyBlocks(stateWith(null))).toBeNull();
    expect(planCopyBlocks(stateWith("missing"))).toBeNull();
  });
});

describe("planPasteOps (§6.4 paste after selection)", () => {
  it("inserts after the selected root block, in the root list", () => {
    const plan = planPasteOps(stateWith("q1"), [block("src1", "short-text", { label: "P" })], () => "n1");
    if (!plan) throw new Error("expected a paste plan");
    expect(plan.index).toBe(1);
    expect(plan.parentId).toBeNull();
    expect(plan.lastInsertedId).toBe("n1");
    expect(plan.ops).toHaveLength(1);
    const insert = plan.ops[0] as Extract<Op, { op: "block.insert" }>;
    expect(insert.op).toBe("block.insert");
    expect(insert.block.id).toBe("n1");
  });

  it("pastes inside the selected block's parent for nested selections", () => {
    const plan = planPasteOps(stateWith("q2"), [block("src1", "short-text", { label: "P" })], () => "n1");
    expect(plan?.parentId).toBe("sec1");
    expect(plan?.index).toBe(1); // after q2 inside sec1
  });

  it("appends at the end of the root list without a selection", () => {
    const plan = planPasteOps(stateWith(null), [block("src1", "short-text", { label: "P" })], () => "n1");
    expect(plan?.index).toBe(3);
    expect(plan?.parentId).toBeNull();
  });

  it("keeps multi-block order with running indexes and selects the last copy", () => {
    const sources = [block("a", "short-text", { label: "A" }), block("b", "email", { label: "B" })];
    const ids = ["n1", "n2"];
    const plan = planPasteOps(stateWith("q3"), sources, () => ids.shift() as string);
    if (!plan) throw new Error("expected a paste plan");
    expect(plan.ops.map((op) => (op as { index: number }).index)).toEqual([3, 4]);
    expect(plan.lastInsertedId).toBe("n2");
  });

  it("re-ids option lists nested in props on paste", () => {
    const source = block("src1", "single-select", {
      label: "Pick",
      options: [
        { id: "opt_free", label: "One" },
        { id: "plain", label: "Two" },
      ],
    });
    const plan = planPasteOps(stateWith("q1"), [source], () => "fresh");
    if (!plan) throw new Error("expected a paste plan");
    const pasted = plan.ops[0] as Extract<Op, { op: "block.insert" }>;
    const options = pasted.block.props.options as Array<{ id: string }>;
    expect(options[0]?.id).toBe("opt_fresh"); // opt_ prefix preserved
    expect(options[1]?.id).toBe("fresh");
  });

  it("is a no-op for an empty clipboard", () => {
    expect(planPasteOps(stateWith("q1"), [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// banner precedence + rejection notice copy
// ---------------------------------------------------------------------------

describe("bannerKindFor (§7.4 vs §14)", () => {
  it("archived always wins over multitab", () => {
    expect(bannerKindFor(true, true)).toBe("archived");
    expect(bannerKindFor(true, false)).toBe("archived");
  });

  it("a seen second tab shows the multitab banner", () => {
    expect(bannerKindFor(false, true)).toBe("multitab");
    expect(bannerKindFor(false, false)).toBe("none");
  });
});

describe("rejectionNoticeText (§14)", () => {
  it("prefers the server message and falls back to the code", () => {
    expect(rejectionNoticeText({ code: "NOT_FOUND", message: "Parent block was deleted" })).toBe(
      "One change was rejected: Parent block was deleted",
    );
    expect(rejectionNoticeText({ code: "INVALID", message: "  " })).toBe("One change was rejected: INVALID");
  });
});

// ---------------------------------------------------------------------------
// sharedOfflineQueue (§22.2 singleton, HMR-safe)
// ---------------------------------------------------------------------------

describe("sharedOfflineQueue", () => {
  it("hands out ONE instance across repeated calls (globalThis cache)", () => {
    expect(sharedOfflineQueue()).toBe(sharedOfflineQueue());
  });
});
