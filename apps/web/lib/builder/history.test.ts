// History unit tests (spec §6.3, §3.3, §11 — milestone B1):
// 100-entry cap, redo-stack clearing, group undo (AI multi-op apply), and
// popUndo/popRedo LIFO semantics.

import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  emptyHistory,
  HISTORY_LIMIT,
  popRedo,
  popUndo,
  pushEntry,
  type HistoryEntry,
} from "./history";
import type { Op } from "./ops";

const upd = (id: string, label: string): Op => ({ op: "block.update", id, props: { label } });

const entry = (name: string, patch: Partial<HistoryEntry> = {}): HistoryEntry => ({
  label: name,
  ops: [upd(`id-${name}`, name)],
  inverse: [upd(`id-${name}`, `undo-${name}`)],
  ...patch,
});

describe("history — 100-entry cap (§6.3)", () => {
  it(`keeps at most ${HISTORY_LIMIT} entries, dropping the OLDEST`, () => {
    let h = emptyHistory();
    for (let i = 0; i < 105; i++) {
      h = pushEntry(h, entry(`e${i}`));
    }
    expect(h.past.length).toBe(100);
    expect(h.past[0]?.label).toBe("e5"); // oldest five dropped
    expect(h.past[99]?.label).toBe("e104"); // newest kept
  });

  it("pushing a new edit clears the redo stack", () => {
    let h = pushEntry(emptyHistory(), entry("a"));
    const step = popUndo(h);
    if (!step) throw new Error("expected an undo step");
    h = step.history;
    expect(h.future.length).toBe(1);
    h = pushEntry(h, entry("b"));
    expect(h.future.length).toBe(0);
  });
});

describe("history — undo/redo semantics", () => {
  it("popUndo is LIFO and moves the entry to the future stack", () => {
    let h = pushEntry(pushEntry(emptyHistory(), entry("a")), entry("b"));
    const undo1 = popUndo(h);
    expect(undo1?.entry.label).toBe("b");
    h = undo1?.history ?? h;
    const undo2 = popUndo(h);
    expect(undo2?.entry.label).toBe("a");
    h = undo2?.history ?? h;
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);

    const redo1 = popRedo(h);
    expect(redo1?.entry.label).toBe("a"); // last undone, first redone
  });

  it("popRedo/popUndo return null on empty stacks", () => {
    expect(popUndo(emptyHistory())).toBeNull();
    expect(popRedo(emptyHistory())).toBeNull();
  });
});

describe("history — group undo (§6.3/§11)", () => {
  it("undo pops the WHOLE contiguous group run as one merged entry", () => {
    let h = emptyHistory();
    h = pushEntry(h, entry("a1", { group: "ai-1" }));
    h = pushEntry(h, entry("a2", { group: "ai-1" }));
    h = pushEntry(h, entry("a3", { group: "ai-1" }));

    const step = popUndo(h);
    expect(step?.entry.group).toBe("ai-1");
    // Forward ops oldest→newest; inverses newest→oldest.
    expect(step?.entry.ops.map((o) => (o as typeof o & { props: { label: string } }).props.label))
      .toEqual(["a1", "a2", "a3"]);
    expect(step?.entry.inverse.map((o) => (o as typeof o & { props: { label: string } }).props.label))
      .toEqual(["undo-a3", "undo-a2", "undo-a1"]);

    h = step?.history ?? h;
    expect(h.past.length).toBe(0);
    expect(h.future.length).toBe(1); // redo replays the whole group in one step

    const redo = popRedo(h);
    expect(redo?.entry.ops.length).toBe(3);
  });

  it("only the contiguous run sharing the top group is popped (mixed stacks stay stable)", () => {
    let h = emptyHistory();
    h = pushEntry(h, entry("solo"));
    h = pushEntry(h, entry("g1", { group: "g1" }));
    h = pushEntry(h, entry("solo2"));
    h = pushEntry(h, entry("g2a", { group: "g2" }));
    h = pushEntry(h, entry("g2b", { group: "g2" }));

    const step = popUndo(h);
    expect(step?.entry.label).toBe("g2b"); // newest label names the action
    expect(step?.entry.ops.length).toBe(2);
    h = step?.history ?? h;
    expect(h.past.length).toBe(3); // solo, g1, solo2 untouched

    // A non-grouped entry undoes alone, as before.
    const step2 = popUndo(h);
    expect(step2?.entry.label).toBe("solo2");
    expect(step2?.entry.ops.length).toBe(1);
  });

  it("ungrouped and differently-grouped adjacent entries do NOT merge", () => {
    let h = pushEntry(pushEntry(emptyHistory(), entry("x", { group: "a" })), entry("y", { group: "b" }));
    const step = popUndo(h);
    expect(step?.entry.ops.length).toBe(1);
    expect(step?.entry.group).toBe("b");
    h = step?.history ?? h;
    expect(h.past.length).toBe(1);
  });
});
