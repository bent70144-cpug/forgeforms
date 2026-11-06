// Coalescing unit tests (spec §3.3 + §21 "Coalescing" column — milestone B1).

import { describe, expect, it } from "vitest";
import {
  COALESCE_WINDOW_MS,
  coalesceInverses,
  coalesceOps,
  isCoalescableOp,
  mergeCoalescedEntry,
  withinWindow,
} from "./coalesce";
import { emptyHistory, pushEntry } from "./history";
import type { HistoryEntry } from "./history";
import type { Op } from "./ops";

const upd = (id: string, props: Record<string, unknown>): Op => ({ op: "block.update", id, props });
const mov = (id: string, index: number, parentId: string | null = null): Op => ({
  op: "block.move",
  id,
  parentId,
  index,
});

describe("withinWindow / isCoalescableOp", () => {
  it("800 ms window is inclusive", () => {
    expect(COALESCE_WINDOW_MS).toBe(800);
    expect(withinWindow(0, 800)).toBe(true);
    expect(withinWindow(0, 801)).toBe(false);
    expect(withinWindow(100, 0, 800)).toBe(false); // negative gap never merges
  });

  it("only block.update and block.move are coalescable", () => {
    expect(isCoalescableOp(upd("a", {}))).toBe(true);
    expect(isCoalescableOp(mov("a", 0))).toBe(true);
    expect(isCoalescableOp({ op: "block.remove", id: "a" })).toBe(false);
    expect(isCoalescableOp({ op: "meta.update", patch: { title: "x" } })).toBe(false);
  });
});

describe("coalesceOps — block.update (typing)", () => {
  it("merges props patches of updates on the same id (later value wins per key)", () => {
    const merged = coalesceOps(upd("q", { label: "H" }), upd("q", { label: "He", maxLength: 5 }));
    expect(merged).toEqual({ op: "block.update", id: "q", props: { label: "He", maxLength: 5 } });
  });

  it("null delete-tokens survive the merge", () => {
    const merged = coalesceOps(upd("q", { placeholder: "x" }), upd("q", { placeholder: null }));
    expect(merged).toEqual({ op: "block.update", id: "q", props: { placeholder: null } });
  });

  it("never merges across different block ids or op types", () => {
    expect(coalesceOps(upd("a", {}), upd("b", {}))).toBeNull();
    expect(coalesceOps(upd("a", {}), mov("a", 1))).toBeNull();
    expect(coalesceOps(mov("a", 1), upd("a", {}))).toBeNull();
  });

  it("non-coalescable op types never merge, even with matching ids", () => {
    expect(
      coalesceOps({ op: "block.remove", id: "a" }, { op: "block.remove", id: "a" }),
    ).toBeNull();
  });

  it("honours the window when timestamps are provided", () => {
    expect(coalesceOps(upd("a", {}), upd("a", {}), 800, { prevAt: 0, nextAt: 800 })).toEqual(
      upd("a", {}),
    );
    expect(coalesceOps(upd("a", {}), upd("a", {}), 800, { prevAt: 0, nextAt: 801 })).toBeNull();
  });
});

describe("coalesceOps — block.move (keyboard repeat)", () => {
  it("merges consecutive moves of the same id into the FINAL destination", () => {
    expect(coalesceOps(mov("a", 1), mov("a", 2))).toEqual(mov("a", 2));
    expect(coalesceOps(mov("a", 1), mov("a", 2, "sec"))).toEqual(mov("a", 2, "sec"));
  });

  it("moves of different ids never merge", () => {
    expect(coalesceOps(mov("a", 1), mov("b", 2))).toBeNull();
  });
});

describe("coalesceInverses — §21 'keep the earliest inverse'", () => {
  it("earliest inverse wins on key conflicts; later only fills uncovered keys", () => {
    // Original label "A": op1 sets label→"H" (inv label→"A"); op2 sets maxLength→5 (inv maxLength→null).
    const merged = coalesceInverses(upd("q", { label: "A" }), upd("q", { maxLength: null }));
    expect(merged).toEqual({ op: "block.update", id: "q", props: { maxLength: null, label: "A" } });
  });

  it("move inverses: earliest restores the original position", () => {
    expect(coalesceInverses(mov("a", 0), mov("a", 5))).toEqual(mov("a", 0));
  });

  it("mismatched pairs return null", () => {
    expect(coalesceInverses(upd("a", {}), upd("b", {}))).toBeNull();
    expect(coalesceInverses(mov("a", 0), upd("a", {}))).toBeNull();
  });
});

describe("mergeCoalescedEntry — store-side entry merging", () => {
  const baseEntry = (op: Op, inverse: Op): HistoryEntry => ({
    label: "Typed",
    ops: [op],
    inverse: [inverse],
    coalesceKey: "update:q",
    coalesceAt: 0,
  });

  it("merges into the last entry when key matches within the window", () => {
    const h = pushEntry(emptyHistory(), baseEntry(upd("q", { label: "H" }), upd("q", { label: "O" })));
    const merged = mergeCoalescedEntry(h, {
      key: "update:q",
      at: 300,
      op: upd("q", { label: "He" }),
      inverse: upd("q", { label: "H" }),
      label: "Typing…",
    });
    expect(merged?.ops).toEqual([upd("q", { label: "He" })]);
    expect(merged?.history.past.length).toBe(1);
    const entryMerged = merged?.history.past[0];
    expect(entryMerged?.inverse).toEqual([upd("q", { label: "O" })]); // earliest inverse kept
    expect(entryMerged?.label).toBe("Typing…"); // replaced
    expect(entryMerged?.coalesceAt).toBe(300); // sliding window stamp
    expect(merged?.history.future).toEqual([]); // new edit clears redo
  });

  it("rejects when the key, window, or single-op shape does not match", () => {
    const h = pushEntry(emptyHistory(), baseEntry(upd("q", { label: "H" }), upd("q", { label: "O" })));
    // Different key.
    expect(
      mergeCoalescedEntry(h, { key: "update:other", at: 10, op: upd("q", {}), inverse: upd("q", {}) }),
    ).toBeNull();
    // Window elapsed.
    expect(
      mergeCoalescedEntry(h, { key: "update:q", at: 801, op: upd("q", {}), inverse: upd("q", {}) }),
    ).toBeNull();
    // No history at all.
    expect(
      mergeCoalescedEntry(emptyHistory(), { key: "update:q", at: 10, op: upd("q", {}), inverse: upd("q", {}) }),
    ).toBeNull();
    // Last entry is not coalescable (multi-op group apply).
    const groupEntry: HistoryEntry = {
      label: "AI apply",
      group: "ai-1",
      ops: [upd("q", {}), upd("r", {})],
      inverse: [upd("q", {}), upd("r", {})],
    };
    const hg = pushEntry(emptyHistory(), groupEntry);
    expect(
      mergeCoalescedEntry(hg, { key: "update:q", at: 10, op: upd("q", {}), inverse: upd("q", {}) }),
    ).toBeNull();
  });

  it("move coalescing keeps the earliest inverse and the final forward op", () => {
    const h = pushEntry(
      emptyHistory(),
      {
        label: "Moved",
        ops: [mov("a", 1)],
        inverse: [mov("a", 0)],
        coalesceKey: "move:a",
        coalesceAt: 0,
      },
    );
    const merged = mergeCoalescedEntry(h, {
      key: "move:a",
      at: 100,
      op: mov("a", 2),
      inverse: mov("a", 1),
    });
    expect(merged?.ops).toEqual([mov("a", 2)]);
    expect(merged?.history.past[0]?.inverse).toEqual([mov("a", 0)]);
  });
});
