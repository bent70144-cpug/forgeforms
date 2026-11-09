'use client';

// Left pane (spec §4 + §12): "Add block" action, blocks tree, endings list and
// the logic hand-off link (spec §8.5).
//
// WINDOW EVENT CONTRACT — "ff:open-picker" (shared with the canvas, see
// lib/builder/canvas-ops.ts + useBlockPicker.ts)
//   emitOpenPicker({ index, parentId }) →
//   window CustomEvent("ff:open-picker", { detail: { index, parentId } })
//   • index/parentId: WHERE to insert — one past the selected block inside its
//     own list (root list or a container's children, see insertionTarget()),
//     otherwise the end of the root list.
//   • Consumer: the BlockPicker (useBlockPicker) listens on `window`, opens
//     anchored there and inserts via a block.insert op through the normal
//     store path (undo/redo + autosave stay unified).
//   • If nothing is selected, the pane first switches the right pane to the
//     Document settings tab (selection === null means "document selected").

import { useMemo } from "react";
import { Icon } from "@/components/ui/icons";
import { useBuilder } from "./context";
import { BlocksTree } from "./BlocksTree";
import { newId } from "@/lib/builder/id";
import { emitOpenPicker } from "@/lib/builder/canvas-ops";
import { findBlock } from "@/lib/builder/ops";
import type { Block, Rule } from "@/lib/bridge";

/** Where the picker should insert: after the selected block (in its own
 * list), otherwise appended at the end of the root list. */
export function insertionTarget(
  blocks: Block[],
  selection: string | null,
): { index: number; parentId: string | null } {
  if (!selection) return { index: blocks.length, parentId: null };
  const found = findBlock(blocks, selection);
  if (!found) return { index: blocks.length, parentId: null };
  const parent = found.trail.length > 0 ? (found.trail[found.trail.length - 1] ?? null) : null;
  return { index: found.index + 1, parentId: parent?.id ?? null };
}

const BLOCK_REF_PREFIX = "@block:";
const ENDING_TARGET_PREFIX = "end:";

/** True when a rule references a block id that no longer exists (dangling). */
export function ruleIsDangling(rule: Rule, blocks: readonly Block[]): boolean {
  const ids = new Set<string>();
  const collect = (list: readonly Block[]) => {
    for (const block of list) {
      ids.add(block.id);
      if (block.children) collect(block.children);
    }
  };
  collect(blocks);

  const refs: string[] = [];
  if (rule.scope !== "start") refs.push(rule.scope);
  for (const condition of rule.when) {
    if (condition.left.startsWith(BLOCK_REF_PREFIX)) {
      refs.push(condition.left.slice(BLOCK_REF_PREFIX.length));
    }
  }
  for (const action of rule.then) {
    if (action.type === "goto" && !action.target.startsWith(ENDING_TARGET_PREFIX)) {
      refs.push(action.target);
    }
  }
  return refs.some((id) => !ids.has(id));
}

export function LeftPane() {
  const { state, dispatch } = useBuilder();
  const rules = state.body.logic.rules;

  const hasDangling = useMemo(
    () => rules.some((rule) => ruleIsDangling(rule, state.body.blocks)),
    [rules, state.body.blocks],
  );

  const openPicker = () => {
    if (state.selection === null) dispatch({ type: "setPanel", panel: "document" });
    emitOpenPicker(insertionTarget(state.body.blocks, state.selection));
  };

  const addEnding = () => {
    // Ending requires { id, title } (packages/schema §7); body/redirectUrl are
    // optional, so a bare default ending is schema-valid.
    dispatch({
      type: "apply",
      ops: [{ op: "ending.upsert", ending: { id: newId(), title: "Thank you" } }],
      label: "Add ending",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="left-pane">
      <div className="ff-pane--bottom p-3">
        {/* the pane's primary action — Meridian ultramarine (canonical .ff-btn) */}
        <button type="button" className="ff-btn ff-btn-primary w-full" onClick={openPicker}>
          <Icon name="plus" size={16} />
          Add block
        </button>
      </div>

      <nav aria-label="Blocks" className="min-h-0 flex-1 overflow-y-auto p-2">
        <BlocksTree />
      </nav>

      <section aria-label="Endings" className="ff-pane--top p-2">
        <h2
          className="px-1 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[color:var(--ff-muted)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          Endings
        </h2>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {state.body.endings.map((ending) => (
            <li key={ending.id}>
              <button
                type="button"
                className="ff-tree-row w-full"
                onClick={() => dispatch({ type: "setPanel", panel: "endings" })}
                title="Open the endings editor"
              >
                <span aria-hidden="true">🏁</span>
                <span className="ff-tree-label" dir="auto">{ending.title}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="ff-tree-row w-full text-[color:var(--ff-muted)]"
              onClick={addEnding}
            >
              <Icon name="plus" size={14} />
              <span className="ff-tree-label">Add ending</span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-label="Logic" className="ff-pane--top p-2">
        <a
          href={`/d/${state.docId}/logic`}
          className="flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-medium text-[color:var(--ff-primary)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--ff-primary)_8%,transparent)] hover:underline"
        >
          Logic ({rules.length} {rules.length === 1 ? "rule" : "rules"})
          {hasDangling && (
            <span
              className="ff-issue-badge"
              title="A rule references a missing block"
              aria-label="A rule references a missing block"
            >
              !
            </span>
          )}
        </a>
      </section>
    </div>
  );
}
