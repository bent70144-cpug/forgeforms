'use client';

// Global keyboard map (builder spec §6.5) + delete/move selection helpers.
//
// Wave-3 wiring: mount `useShortcuts()` ONCE inside the builder page (inside
// <BuilderProvider>), and render <ShortcutsHelpDialog> next to it:
//
//   const { helpOpen, closeHelp } = useShortcuts();
//   <ShortcutsHelpDialog open={helpOpen} onClose={closeHelp} />
//
// ---------------------------------------------------------------------------
// WINDOW EVENT CONTRACTS (emitted by this hook; consumers in parentheses)
// ---------------------------------------------------------------------------
// - "ff:open-picker"   detail {}                       (useBlockPicker)
// - "ff:force-save"    detail {}                       (BuilderPage → flushNow)
// - "ff:block-deleted" detail { label: string; hadLogic: boolean }  (UndoToast)
// - "ff:edit-selected" detail { id: string }           (Canvas inline edit)
// - "ff:open-preview"  detail {}                       (BuilderPage → preview lift)
// All are `CustomEvent`s dispatched on `window`.
//
// Ignore-while-typing rule (§6.5): every shortcut is ignored while an
// input/textarea/select/contentEditable is focused, EXCEPT Cmd/Ctrl+Z,
// Cmd/Ctrl+S and Cmd/Ctrl+K (Cmd/Ctrl+Shift+Z rides on the "z" chord).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, createElement as h, type ReactElement } from "react";
import type { Block, DocumentBody, Rule } from "@/lib/bridge";
import { useBuilder } from "./context";
import { blockDisplayLabel } from "@/lib/builder/blockMeta";
import { regeneratePropIds } from "@/lib/builder/clipboard";
import { duplicateBlockOp, findBlock, type Op } from "@/lib/builder/ops";
import { isBlockPickerOpen } from "./useBlockPicker";
import type { EditorState } from "@/lib/builder/store";

// ---------------------------------------------------------------------------
// Event names (single source of truth for emitters + wave-3 consumers)
// ---------------------------------------------------------------------------

export const SHORTCUT_EVENTS = {
  openPicker: "ff:open-picker",
  forceSave: "ff:force-save",
  blockDeleted: "ff:block-deleted",
  editSelected: "ff:edit-selected",
  openPreview: "ff:open-preview",
} as const;

// ---------------------------------------------------------------------------
// Pure helpers (exported for node tests)
// ---------------------------------------------------------------------------

/** KeyboardEvent-ish subset so tests can pass plain objects. */
export type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** True when the event target is a text-entry surface (inputs, etc.). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * §6.5 ignore-while-typing rule: returns true when the shortcut must be
 * ignored. While a typing target is focused only Cmd/Ctrl+Z (undo/redo chord),
 * Cmd/Ctrl+S and Cmd/Ctrl+K pass through; outside typing targets nothing is
 * ignored.
 */
export function shouldIgnoreShortcut(target: EventTarget | null, e: ShortcutKeyEvent): boolean {
  if (!isTypingTarget(target)) return false;
  const mod = e.metaKey || e.ctrlKey;
  const key = typeof e.key === "string" ? e.key.toLowerCase() : "";
  return !(mod && (key === "z" || key === "s" || key === "k"));
}

function collectSubtreeIds(block: Block, into: Set<string> = new Set()): Set<string> {
  into.add(block.id);
  for (const child of block.children ?? []) collectSubtreeIds(child, into);
  return into;
}

/** Does this rule reference any of the given block ids (scope / when / goto)? */
export function ruleReferencesAnyId(rule: Rule, ids: ReadonlySet<string>): boolean {
  if (ids.has(rule.scope)) return true;
  for (const condition of rule.when) {
    if (condition.left.startsWith("@block:") && ids.has(condition.left.slice("@block:".length))) return true;
  }
  for (const action of rule.then) {
    // goto targets are blockId or "end:<endingId>" — endings are not blocks.
    if (action.type === "goto" && !action.target.startsWith("end:") && ids.has(action.target)) return true;
  }
  return false;
}

export type DeleteSelectionResult = {
  ops: readonly Op[];
  /** Next block to select after removal (sibling after, else before, else none). */
  nextSelectionId: string | null;
  /** Display label of the deleted block — UndoToast shows "Deleted <label>". */
  label: string;
  /** True when any logic rule references an id in the removed subtree. */
  hadLogic: boolean;
};

/**
 * Plan deleting the selected block (§6.4): builds the `block.remove` op, picks
 * the next selection (§12: next block, else previous, else none) and detects
 * logic references for the UndoToast warning. Pure — no dispatching.
 */
export function deleteSelection(state: EditorState): DeleteSelectionResult | null {
  if (!state.selection) return null;
  const found = findBlock(state.body.blocks, state.selection);
  if (!found) return null;

  const removedIds = collectSubtreeIds(found.block);
  // Root-level anchor for the "next block" walk (nested blocks move focus to
  // the neighbor of their root ancestor).
  const rootAncestorId = found.trail.length > 0 ? found.trail[0]!.id : found.block.id;
  const rootIndex = state.body.blocks.findIndex((b) => b.id === rootAncestorId);
  const rootList = state.body.blocks;
  const next = rootList[rootIndex + 1] ?? rootList[rootIndex - 1] ?? null;

  return {
    ops: [{ op: "block.remove", id: found.block.id }],
    nextSelectionId: next ? next.id : null,
    label: blockDisplayLabel(found.block),
    hadLogic: state.body.logic.rules.some((rule) => ruleReferencesAnyId(rule, removedIds)),
  };
}

/**
 * Plan duplicating the selected block (§6.4): cloneWithNewIds re-ids the node
 * subtree, and `regeneratePropIds` re-ids option lists nested in props (spec:
 * "Option labels/ids inside the copy are regenerated"). Null when there is no
 * (live) selection. Pure — no dispatching.
 */
export function duplicateSelection(state: EditorState): { ops: readonly Op[]; clone: Block } | null {
  if (!state.selection) return null;
  try {
    const { op, clone } = duplicateBlockOp({ meta: state.meta, body: state.body }, state.selection);
    if (op.op !== "block.insert") return null; // narrow the union (duplicate always inserts)
    const copy = { ...clone, props: regeneratePropIds(clone.props) };
    return { ops: [{ op: "block.insert", parentId: op.parentId, index: op.index, block: copy }], clone: copy };
  } catch {
    return null; // stale selection
  }
}

/**
 * Plan moving the selected block one slot up (-1) / down (+1) among its
 * siblings (§6.5 Alt+↑/↓). Returns the `block.move` op (index = final slot
 * after removal) or null at the edges / without a selection — no-op then.
 */
export function moveSelectionOp(state: EditorState, delta: 1 | -1): { op: Op } | null {
  if (!state.selection) return null;
  const found = findBlock(state.body.blocks, state.selection);
  if (!found) return null;
  const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
  const siblings = parent ? (parent.children ?? []) : state.body.blocks;
  const targetIndex = found.index + delta;
  if (targetIndex < 0 || targetIndex >= siblings.length) return null; // clamped: already at the edge
  return { op: { op: "block.move", id: found.block.id, parentId: parent?.id ?? null, index: targetIndex } };
}

/**
 * Prev/next ROOT-level block id for ↑/↓ selection (§6.5), wrapping around.
 * No selection yet: ↓ picks the first block, ↑ the last. Unknown selection →
 * null (caller ignores).
 */
export function adjacentRootId(body: DocumentBody, selection: string | null, delta: 1 | -1): string | null {
  const ids = body.blocks.map((b) => b.id);
  if (ids.length === 0) return null;
  if (!selection) return (delta === 1 ? ids[0] : ids[ids.length - 1]) ?? null;
  const current = ids.indexOf(selection);
  if (current === -1) return null;
  return ids[(current + delta + ids.length) % ids.length] ?? null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function emit(name: string, detail: unknown = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function useShortcuts(): { helpOpen: boolean; closeHelp: () => void } {
  const { state, dispatch } = useBuilder();
  const [helpOpen, setHelpOpen] = useState(false);
  const latest = useRef({ state, helpOpen });
  latest.current = { state, helpOpen };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { state: s, helpOpen: help } = latest.current;
      if (shouldIgnoreShortcut(e.target, e)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod) {
        const lower = key.toLowerCase();
        if (lower === "k") {
          // Redo's chord (Cmd/Ctrl+Shift+Z) is separate; Cmd+K always opens the picker.
          if (e.shiftKey) return;
          e.preventDefault();
          emit(SHORTCUT_EVENTS.openPicker, {});
          return;
        }
        if (lower === "z") {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? "redo" : "undo" });
          return;
        }
        if (lower === "y" && !e.shiftKey && e.ctrlKey) {
          e.preventDefault();
          dispatch({ type: "redo" });
          return;
        }
        if (lower === "s") {
          e.preventDefault();
          emit(SHORTCUT_EVENTS.forceSave, {});
          return;
        }
        if (lower === "d" && !e.shiftKey) {
          e.preventDefault(); // stops the browser bookmark dialog
          const duplication = duplicateSelection(s);
          if (!duplication) return;
          dispatch({ type: "apply", ops: [...duplication.ops], label: "Duplicate" });
          dispatch({ type: "select", id: duplication.clone.id });
          return;
        }
        if (lower === "p" && e.shiftKey) {
          e.preventDefault();
          emit(SHORTCUT_EVENTS.openPreview, {});
          return;
        }
        return;
      }

      switch (key) {
        case "/": {
          if (e.altKey) return;
          e.preventDefault();
          emit(SHORTCUT_EVENTS.openPicker, {});
          return;
        }
        case "?": {
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        }
        case "Delete":
        case "Backspace": {
          const deletion = deleteSelection(s);
          if (!deletion) return;
          e.preventDefault();
          dispatch({ type: "apply", ops: [...deletion.ops], label: `Delete ${deletion.label}` });
          dispatch({ type: "select", id: deletion.nextSelectionId });
          emit(SHORTCUT_EVENTS.blockDeleted, { label: deletion.label, hadLogic: deletion.hadLogic });
          return;
        }
        case "ArrowUp":
        case "ArrowDown": {
          if (e.altKey) {
            const delta: 1 | -1 = key === "ArrowUp" ? -1 : 1;
            const move = moveSelectionOp(s, delta);
            if (!move) return;
            e.preventDefault();
            dispatch({ type: "apply", ops: [move.op], label: "Move question" });
            return;
          }
          if (e.shiftKey) return;
          e.preventDefault();
          const delta: 1 | -1 = key === "ArrowUp" ? -1 : 1;
          const nextId = adjacentRootId(s.body, s.selection, delta);
          if (nextId) dispatch({ type: "select", id: nextId });
          return;
        }
        case "Enter": {
          if (!s.selection) return;
          e.preventDefault();
          emit(SHORTCUT_EVENTS.editSelected, { id: s.selection });
          return;
        }
        case "Escape": {
          if (help) {
            setHelpOpen(false);
            return;
          }
          if (isBlockPickerOpen()) return; // the picker handles its own Escape
          dispatch({ type: "select", id: null });
          return;
        }
        default:
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  const closeHelp = useCallback(() => setHelpOpen(false), []);
  return { helpOpen, closeHelp };
}

// ---------------------------------------------------------------------------
// Help dialog (§6.5 "Provide a visible help dialog")
// ---------------------------------------------------------------------------

const SHORTCUT_ROWS: ReadonlyArray<readonly [keys: string, action: string]> = [
  ["⌘/Ctrl + K or /", "Open block picker"],
  ["⌘/Ctrl + Z", "Undo"],
  ["⌘/Ctrl + Shift + Z · Ctrl + Y", "Redo"],
  ["⌘/Ctrl + S", "Force save now"],
  ["⌘/Ctrl + D", "Duplicate selected block"],
  ["Delete / Backspace", "Delete selected block"],
  ["↑ / ↓", "Select previous / next block"],
  ["Alt + ↑ / Alt + ↓", "Move selected block up / down"],
  ["Enter", "Edit selected block's primary text"],
  ["Esc", "Cancel edit · close picker · deselect"],
  ["⌘/Ctrl + Shift + P", "Open preview"],
  ["?", "Show this help"],
];

export function ShortcutsHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  if (!open) return null;
  return h(
    "div",
    {
      className: "fixed inset-0 z-50",
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      },
    },
    h("div", { className: "absolute inset-0 bg-stone-900/40", "aria-hidden": true, onClick: onClose }),
    h(
      "div",
      {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Keyboard shortcuts",
        className:
          "relative mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-900",
      },
      h("h2", { className: "mb-4 text-base font-semibold" }, "Keyboard shortcuts"),
      h(
        "table",
        { className: "w-full text-sm" },
        h(
          "tbody",
          null,
          SHORTCUT_ROWS.map(([keys, action]) =>
            h(
              "tr",
              { key: keys, className: "border-b border-stone-100 last:border-0 dark:border-stone-800" },
              h("td", { className: "py-1.5 pr-4" }, h("kbd", { className: "ff-kbd rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 font-mono text-xs dark:border-stone-600 dark:bg-stone-800" }, keys)),
              h("td", { className: "py-1.5 text-stone-600 dark:text-stone-300" }, action),
            ),
          ),
        ),
      ),
      h("p", { className: "mt-4 text-xs text-stone-500" }, "Shortcuts are ignored while typing, except ⌘/Ctrl + Z, S and K."),
    ),
  );
}
