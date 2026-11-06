// T-B4 — keyboard shortcut tests (builder spec §6.5) + delete/move selection
// planning helpers (§6.4). Pure node — KeyboardEvent-ish plain objects, no DOM.

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SHORTCUT_EVENTS,
  ShortcutsHelpDialog,
  adjacentRootId,
  deleteSelection,
  duplicateSelection,
  moveSelectionOp,
  ruleReferencesAnyId,
  shouldIgnoreShortcut,
} from "./useShortcuts";
import { initialEditorState, type EditorState } from "@/lib/builder/store";
import { emptyBody } from "@/lib/builder/ops";
import type { Block, Rule } from "@/lib/bridge";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function key(partial: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }) {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...partial };
}

const INPUT = ({ tagName: "INPUT" } as unknown) as EventTarget;
const BODY = ({ tagName: "BODY" } as unknown) as EventTarget;
const CONTENT_EDITABLE = ({ tagName: "DIV", isContentEditable: true } as unknown) as EventTarget;

function block(id: string, kind: string, props: Record<string, unknown>, children?: Block[]): Block {
  return { id, kind, props, ...(children ? { children } : {}) };
}

const RULE_SCOPE: Rule = {
  id: "r1",
  scope: "b1",
  when: [],
  then: [{ type: "goto", target: "end:thanks" }],
  isFallback: false,
};
const RULE_WHEN: Rule = {
  id: "r2",
  scope: "start",
  when: [{ left: "@block:child-1", op: "eq", right: "x" }],
  then: [{ type: "set", var: "score", value: 1 }],
  isFallback: false,
};
const RULE_GOTO: Rule = {
  id: "r3",
  scope: "start",
  when: [],
  then: [{ type: "goto", target: "b3" }],
  isFallback: false,
};
const RULE_ENDING_GOTO: Rule = {
  id: "r4",
  scope: "start",
  when: [],
  then: [{ type: "goto", target: "end:b1" }], // "end:"-prefixed → NOT a block id
  isFallback: false,
};

function makeState(blocks: Block[], selection: string | null, rules: Rule[] = []): EditorState {
  return {
    ...initialEditorState("doc1"),
    body: { ...emptyBody("form"), blocks, logic: { rules } },
    selection,
  };
}

const THREE = [
  block("b1", "short-text", { label: "First question" }),
  block("b2", "email", { label: "Email address" }),
  block("b3", "single-select", { label: "Pick one", options: [{ id: "opt_a", label: "A" }] }),
];

// ---------------------------------------------------------------------------
// shouldIgnoreShortcut — §6.5 typing-ignore matrix
// ---------------------------------------------------------------------------

describe("shouldIgnoreShortcut (§6.5)", () => {
  it("ignores plain keys while an input is focused", () => {
    expect(shouldIgnoreShortcut(INPUT, key({ key: "a" }))).toBe(true);
    expect(shouldIgnoreShortcut(INPUT, key({ key: "Backspace" }))).toBe(true);
    expect(shouldIgnoreShortcut(INPUT, key({ key: "Escape" }))).toBe(true);
    expect(shouldIgnoreShortcut(INPUT, key({ key: "?" }))).toBe(true);
  });

  it("always allows Cmd/Ctrl+Z (undo/redo chord), Cmd/Ctrl+S and Cmd/Ctrl+K while typing", () => {
    expect(shouldIgnoreShortcut(INPUT, key({ key: "z", metaKey: true }))).toBe(false);
    expect(shouldIgnoreShortcut(INPUT, key({ key: "z", ctrlKey: true, shiftKey: true }))).toBe(false); // redo
    expect(shouldIgnoreShortcut(INPUT, key({ key: "s", ctrlKey: true }))).toBe(false);
    expect(shouldIgnoreShortcut(INPUT, key({ key: "k", metaKey: true }))).toBe(false);
    // Ctrl+Y (redo) is NOT in the §6.5 exception list → ignored while typing.
    expect(shouldIgnoreShortcut(INPUT, key({ key: "y", ctrlKey: true }))).toBe(true);
  });

  it("never ignores outside typing targets", () => {
    expect(shouldIgnoreShortcut(BODY, key({ key: "a" }))).toBe(false);
    expect(shouldIgnoreShortcut(BODY, key({ key: "Backspace" }))).toBe(false);
    expect(shouldIgnoreShortcut(null, key({ key: "z", metaKey: true }))).toBe(false);
    expect(shouldIgnoreShortcut(CONTENT_EDITABLE, key({ key: "a" }))).toBe(true); // contentEditable counts
  });
});

// ---------------------------------------------------------------------------
// deleteSelection — §6.4 delete + §12 focus move + logic warning
// ---------------------------------------------------------------------------

describe("deleteSelection", () => {
  it("builds a block.remove op for the selected block", () => {
    const result = deleteSelection(makeState(THREE, "b2"));
    expect(result?.ops).toEqual([{ op: "block.remove", id: "b2" }]);
  });

  it("picks the next sibling as the new selection, else the previous, else none", () => {
    expect(deleteSelection(makeState(THREE, "b1"))?.nextSelectionId).toBe("b2");
    expect(deleteSelection(makeState(THREE, "b2"))?.nextSelectionId).toBe("b3");
    expect(deleteSelection(makeState(THREE, "b3"))?.nextSelectionId).toBe("b2"); // last → previous
    expect(deleteSelection(makeState([THREE[0] as Block], "b1"))?.nextSelectionId).toBeNull(); // only block
  });

  it("uses the display label (primary prop) for the toast text", () => {
    expect(deleteSelection(makeState(THREE, "b2"))?.label).toBe("Email address");
  });

  it("flags hadLogic when a rule scope, condition or goto references the removed subtree", () => {
    expect(deleteSelection(makeState(THREE, "b1", [RULE_SCOPE]))?.hadLogic).toBe(true);
    expect(deleteSelection(makeState(THREE, "b3", [RULE_GOTO]))?.hadLogic).toBe(true); // goto targets b3
    expect(deleteSelection(makeState(THREE, "b2", [RULE_GOTO]))?.hadLogic).toBe(false); // rule references b3, not b2
    const nested = [block("sec", "section", {}, [block("child-1", "text", {})])];
    expect(deleteSelection(makeState(nested, "child-1", [RULE_WHEN]))?.hadLogic).toBe(true); // condition on child id
    expect(deleteSelection(makeState(THREE, "b1", [RULE_ENDING_GOTO]))?.hadLogic).toBe(false); // "end:" goto is not a block ref
    expect(deleteSelection(makeState(THREE, "b1", []))?.hadLogic).toBe(false);
  });

  it("returns null without a selection or with a stale one", () => {
    expect(deleteSelection(makeState(THREE, null))).toBeNull();
    expect(deleteSelection(makeState(THREE, "ghost"))).toBeNull();
  });

  it("deleting a nested block moves selection to the neighbor of its root ancestor", () => {
    const blocks = [block("sec", "section", {}, [block("child", "text", {})]), block("b3", "email", { label: "Next" })];
    const result = deleteSelection(makeState(blocks, "child"));
    expect(result?.ops).toEqual([{ op: "block.remove", id: "child" }]);
    expect(result?.nextSelectionId).toBe("b3");
  });
});

// ---------------------------------------------------------------------------
// ruleReferencesAnyId
// ---------------------------------------------------------------------------

describe("ruleReferencesAnyId", () => {
  const IDS = new Set(["b1", "child-1"]);
  it("detects scope, @block: conditions and block gotos; ignores endings and unrelated rules", () => {
    expect(ruleReferencesAnyId(RULE_SCOPE, IDS)).toBe(true);
    expect(ruleReferencesAnyId(RULE_WHEN, IDS)).toBe(true);
    expect(ruleReferencesAnyId(RULE_GOTO, new Set(["b3"]))).toBe(true);
    expect(ruleReferencesAnyId(RULE_ENDING_GOTO, IDS)).toBe(false);
    expect(ruleReferencesAnyId(RULE_SCOPE, new Set(["b9"]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// duplicateSelection — §6.4 duplicate (new ids incl. nested option ids)
// ---------------------------------------------------------------------------

describe("duplicateSelection", () => {
  it("inserts a clone right after the original with fresh block AND option ids", () => {
    const blocks = [
      block("b1", "single-select", { label: "Pick one", options: [{ id: "opt_a", label: "A" }, { id: "opt_b", label: "B" }] }),
      block("b2", "email", { label: "Email address" }),
    ];
    const result = duplicateSelection(makeState(blocks, "b1"));
    expect(result).not.toBeNull();
    const insert = result?.ops[0] as { op: string; index: number; parentId: string | null; block: Block };
    expect(insert.op).toBe("block.insert");
    expect(insert.index).toBe(1); // directly after the original
    expect(insert.parentId).toBeNull();

    const copy = result?.clone as Block;
    expect(insert.block).toBe(copy);
    expect(copy.id).not.toBe("b1");
    expect(copy.props.label).toBe("Pick one"); // labels preserved
    const options = copy.props.options as Array<{ id: string; label: string }>;
    expect(options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(options.map((o) => o.id)).not.toContain("opt_a");
    expect(options.map((o) => o.id)).not.toContain("opt_b");
    expect(options[0]?.id.startsWith("opt_")).toBe(true); // prefix pattern kept
  });

  it("re-ids descendants of duplicated containers", () => {
    const blocks = [block("sec", "section", {}, [block("child", "text", {})])];
    const result = duplicateSelection(makeState(blocks, "sec"));
    const copy = result?.clone as Block;
    expect(copy.id).not.toBe("sec");
    expect(copy.children?.[0]?.id).not.toBe("child");
  });

  it("returns null without a selection or with a stale one", () => {
    expect(duplicateSelection(makeState(THREE, null))).toBeNull();
    expect(duplicateSelection(makeState(THREE, "ghost"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// moveSelectionOp — §6.5 Alt+↑/↓
// ---------------------------------------------------------------------------

describe("moveSelectionOp", () => {
  it("moves down: final index = current + 1 (post-removal slot)", () => {
    const result = moveSelectionOp(makeState(THREE, "b1"), 1);
    expect(result?.op).toEqual({ op: "block.move", id: "b1", parentId: null, index: 1 });
  });

  it("moves up: final index = current - 1", () => {
    const result = moveSelectionOp(makeState(THREE, "b3"), -1);
    expect(result?.op).toEqual({ op: "block.move", id: "b3", parentId: null, index: 1 });
  });

  it("clamps at the edges (no-op) and without/stale selection", () => {
    expect(moveSelectionOp(makeState(THREE, "b1"), -1)).toBeNull();
    expect(moveSelectionOp(makeState(THREE, "b3"), 1)).toBeNull();
    expect(moveSelectionOp(makeState(THREE, null), 1)).toBeNull();
    expect(moveSelectionOp(makeState(THREE, "ghost"), 1)).toBeNull();
  });

  it("moves nested blocks within their parent list", () => {
    const blocks = [block("sec", "section", {}, [block("c1", "text", {}), block("c2", "text", {})])];
    const result = moveSelectionOp(makeState(blocks, "c2"), -1);
    expect(result?.op).toEqual({ op: "block.move", id: "c2", parentId: "sec", index: 0 });
  });
});

// ---------------------------------------------------------------------------
// adjacentRootId — §6.5 ↑/↓ root-level selection walk
// ---------------------------------------------------------------------------

describe("adjacentRootId", () => {
  it("walks root-level ids and wraps around", () => {
    const body = makeState(THREE, null).body;
    expect(adjacentRootId(body, "b1", 1)).toBe("b2");
    expect(adjacentRootId(body, "b3", 1)).toBe("b1"); // wrap
    expect(adjacentRootId(body, "b1", -1)).toBe("b3"); // wrap
    expect(adjacentRootId(body, "b2", -1)).toBe("b1");
  });

  it("no selection: ↓ picks the first, ↑ the last; empty doc / stale selection → null", () => {
    const body = makeState(THREE, null).body;
    expect(adjacentRootId(body, null, 1)).toBe("b1");
    expect(adjacentRootId(body, null, -1)).toBe("b3");
    expect(adjacentRootId(makeState([], null).body, null, 1)).toBeNull();
    expect(adjacentRootId(body, "ghost", 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Event name constants + help dialog smoke (static render)
// ---------------------------------------------------------------------------

describe("SHORTCUT_EVENTS contract", () => {
  it("pins the exact window-event names consumers rely on", () => {
    expect(SHORTCUT_EVENTS.openPicker).toBe("ff:open-picker");
    expect(SHORTCUT_EVENTS.forceSave).toBe("ff:force-save");
    expect(SHORTCUT_EVENTS.blockDeleted).toBe("ff:block-deleted");
    expect(SHORTCUT_EVENTS.editSelected).toBe("ff:edit-selected");
    expect(SHORTCUT_EVENTS.openPreview).toBe("ff:open-preview");
  });
});

describe("<ShortcutsHelpDialog>", () => {
  it("renders the §6.5 table with kbd styling when open; nothing when closed", () => {
    const html = renderToStaticMarkup(h(ShortcutsHelpDialog, { open: true, onClose: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Keyboard shortcuts"');
    expect(html).toContain("<kbd");
    expect(html).toContain("Open block picker");
    expect(html).toContain("Duplicate selected block");
    expect(html).toContain("ignored while typing");
    expect(renderToStaticMarkup(h(ShortcutsHelpDialog, { open: false, onClose: () => {} }))).toBe("");
  });
});
