'use client';

// Blocks tree (spec §4 + §12): an ARIA `tree` rendered from a flat,
// visibility-ordered row model so canvas order and tree order are identical
// (both walk state.body.blocks depth-first). Roving tabindex; ArrowUp/Down
// move focus+selection, ArrowRight/Left expand/collapse (ArrowRight also
// steps into the first child when already expanded), Enter/Space select.
// Container kinds (section / columns / multi-question-page, per
// blockMeta.isContainerKind) are expandable. Missing-label blocks get a small
// issue badge (spec §8.1 "Block" level, kept deliberately simple).

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBuilder } from "./context";
import { blockDisplayLabel, blockIcon, getBlockMeta, isContainerKind } from "@/lib/builder/blockMeta";
import type { Block } from "@/lib/bridge";

export type TreeRow = {
  block: Block;
  depth: number;
  parentId: string | null;
  expandable: boolean;
  expanded: boolean;
};

/** Depth-first flat row model honouring the collapsed set. */
export function flattenBlocks(
  blocks: readonly Block[],
  collapsed: ReadonlySet<string>,
  depth = 0,
  parentId: string | null = null,
  out: TreeRow[] = [],
): TreeRow[] {
  for (const block of blocks) {
    const expandable = isContainerKind(block.kind) || (block.children?.length ?? 0) > 0;
    const expanded = expandable && !collapsed.has(block.id);
    out.push({ block, depth, parentId, expandable, expanded });
    if (expanded) flattenBlocks(block.children ?? [], collapsed, depth + 1, block.id, out);
  }
  return out;
}

/**
 * Field-level issue count for the tree badge (spec §8.1 "Block" level):
 * a block whose editor declares a `label` field but has an empty one counts
 * 1 issue. Full publish validation is a later milestone.
 */
export function validateLabelPresence(block: Block): number {
  const meta = getBlockMeta(block.kind);
  if (!meta?.fields.some((f) => f.key === "label")) return 0;
  const label = block.props.label;
  return typeof label === "string" && label.trim().length > 0 ? 0 : 1;
}

export function BlocksTree() {
  const { state, dispatch } = useBuilder();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Roving tabindex needs REAL focus movement (§12): dispatching selection
  // alone leaves DOM focus on the previous row, so screen readers (which
  // follow focus) would never see the arrow-key navigation.
  const treeRef = useRef<HTMLUListElement | null>(null);

  const rows = useMemo(
    () => flattenBlocks(state.body.blocks, collapsed),
    [state.body.blocks, collapsed],
  );

  // Roving tabindex: the focused row wins, else the selected one, else first.
  const activeId = focusedId ?? state.selection ?? rows[0]?.block.id ?? null;

  const focusRow = (id: string): void => {
    treeRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus();
  };

  const select = (id: string) => {
    setFocusedId(id);
    dispatch({ type: "select", id });
    focusRow(id); // keep DOM focus in lockstep with the roving tabindex
  };

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveFocus = (delta: 1 | -1, fromIdx: number) => {
    const next = rows[fromIdx + delta];
    if (next) select(next.block.id);
  };

  const onKeyDown = (event: KeyboardEvent, row: TreeRow, idx: number) => {
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        select(row.block.id);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1, idx);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1, idx);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (row.expandable && !row.expanded) {
          toggle(row.block.id);
        } else {
          const child = rows[idx + 1];
          if (child && child.parentId === row.block.id) select(child.block.id);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.expandable && row.expanded) toggle(row.block.id);
        else if (row.parentId) select(row.parentId);
        break;
      default:
        break;
    }
  };

  if (rows.length === 0) {
    return (
      <p className="m-0 p-2 text-xs text-[color:var(--ff-muted)]" data-testid="blocks-tree-empty">
        No blocks yet — use “Add block” to start.
      </p>
    );
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label="Blocks"
      data-testid="blocks-tree"
      className="m-0 flex list-none flex-col gap-0.5 p-0"
    >
      {rows.map((row, idx) => {
        const issues = validateLabelPresence(row.block);
        return (
          <li
            key={row.block.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={state.selection === row.block.id}
            aria-expanded={row.expandable ? row.expanded : undefined}
            tabIndex={row.block.id === activeId ? 0 : -1}
            className="ff-tree-row"
            style={{ paddingLeft: row.depth * 14 + 8 }}
            data-block-id={row.block.id}
            onClick={() => select(row.block.id)}
            onKeyDown={(e) => onKeyDown(e, row, idx)}
          >
            {row.expandable ? (
              <span
                className="ff-tree-toggle"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(row.block.id);
                }}
              >
                {row.expanded ? "▾" : "▸"}
              </span>
            ) : (
              <span className="ff-tree-toggle" aria-hidden="true" />
            )}
            <span aria-hidden="true">{blockIcon(row.block.kind)}</span>
            <span className="ff-tree-label" dir="auto">{blockDisplayLabel(row.block)}</span>
            {issues > 0 && (
              <span
                className="ff-issue-badge"
                title="Missing label"
                aria-label={`${issues} issue${issues === 1 ? "" : "s"}`}
              >
                {issues}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
