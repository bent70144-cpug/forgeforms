'use client';

// Blocks tree (spec §4 + §12): an ARIA `tree` rendered from a flat,
// visibility-ordered row model so canvas order and tree order are identical
// (both walk state.body.blocks depth-first). Roving tabindex; ArrowUp/Down
// move focus+selection, ArrowRight/Left expand/collapse (ArrowRight also
// steps into the first child when already expanded), Enter/Space select.
// Container kinds (section / columns / multi-question-page, per
// blockMeta.isContainerKind) are expandable. Missing-label blocks get a small
// issue badge (spec §8.1 "Block" level, kept deliberately simple).
//
// §13 WINDOWING (builder-audit follow-up #10): above TREE_VIRTUALIZE_THRESHOLD
// rows the tree renders a sliding window of the flat row model instead of all
// rows — hand-rolled (no dependency), fixed row height, top/bottom spacer
// <li>s keep the scroll height exact. Selection and keyboard navigation are
// window-boundary aware: the reveal effect scrolls a selected/focused row that
// sits outside the rendered window back into view (which is what keeps
// IssuesList "Go to" — ff:goto-block → store select — working for deep rows),
// and tree-internal navigation finishes with DOM focus on the revealed row.
// Typing/selection on the canvas never touch this component's scroll state,
// so the §13 <16 ms keystroke budget is unaffected.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type UIEvent } from "react";
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

// ---------------------------------------------------------------------------
// §13 windowing math (pure — exported for unit tests; no dependency)
// ---------------------------------------------------------------------------

/** Fixed row height for windowed trees (matches .ff-tree-row min-height 2rem). */
export const TREE_ROW_HEIGHT_PX = 32;
/** Rows rendered beyond the visible range on each side (scroll headroom). */
export const TREE_OVERSCAN_ROWS = 8;
/** Windowing kicks in above this many rows (§13 "virtualize above ~200"). */
export const TREE_VIRTUALIZE_THRESHOLD = 200;
/** Viewport estimate before the container can be measured once on mount. */
export const TREE_VIEWPORT_ESTIMATE_PX = 320;

export type TreeWindow = { start: number; end: number }; // end exclusive

/**
 * Visible row range for `scrollTop` on a fixed-height list: the rows that
 * intersect the viewport plus TREE_OVERSCAN_ROWS on each side, clamped to
 * [0, rowCount].
 */
export function computeWindowRange({
  rowCount,
  viewportHeight,
  scrollTop,
  rowHeight = TREE_ROW_HEIGHT_PX,
  overscan = TREE_OVERSCAN_ROWS,
}: {
  rowCount: number;
  viewportHeight: number;
  scrollTop: number;
  rowHeight?: number;
  overscan?: number;
}): TreeWindow {
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: Math.max(0, rowCount) };
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight));
  const visible = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : 1;
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(rowCount, Math.max(start + 1, firstVisible + visible + 1 + overscan));
  return { start, end };
}

/**
 * scrollTop (block:"nearest" semantics for fixed-height rows) that brings row
 * `index` into a viewport of `viewportHeight` currently scrolled to
 * `scrollTop`. Returns `scrollTop` unchanged when the row is already visible.
 */
export function scrollTopForIndex(
  index: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = index * rowHeight;
  if (top < scrollTop) return top;
  const bottom = top + rowHeight;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}

// ---------------------------------------------------------------------------

export function BlocksTree() {
  const { state, dispatch } = useBuilder();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Roving tabindex needs REAL focus movement (§12): dispatching selection
  // alone leaves DOM focus on the previous row, so screen readers (which
  // follow focus) would never see the arrow-key navigation.
  const treeRef = useRef<HTMLUListElement | null>(null);
  // §13: the scrollable element when the tree is windowed (the <ul> itself —
  // the surrounding LeftPane nav keeps its own overflow as a fallback).
  const scrollRef = useRef<HTMLUListElement | null>(null);

  const rows = useMemo(
    () => flattenBlocks(state.body.blocks, collapsed),
    [state.body.blocks, collapsed],
  );

  const windowed = rows.length > TREE_VIRTUALIZE_THRESHOLD;

  // Selection index over the full row model (only used when windowed).
  const selectionIndex = useMemo(() => {
    if (!state.selection) return -1;
    return rows.findIndex((row) => row.block.id === state.selection);
  }, [rows, state.selection]);

  // §13 windowing state. The initial scrollTop is seeded from the selection
  // so a deep selection (IssuesList "Go to", canvas select) is INSIDE the
  // first paint's window; the reveal effect below keeps it exact afterwards.
  const [scrollTop, setScrollTop] = useState(() => {
    // Seed from a deep selection (IssuesList "Go to", canvas select, deep link)
    // so the selected row is INSIDE the first paint's window; without a
    // selection — or when it sits near the top — start at the top.
    if (selectionIndex < 0) return 0;
    return Math.max(0, selectionIndex - TREE_OVERSCAN_ROWS) * TREE_ROW_HEIGHT_PX;
  });
  const [viewportHeight, setViewportHeight] = useState(TREE_VIEWPORT_ESTIMATE_PX);

  const range = useMemo<TreeWindow>(() => {
    if (!windowed) return { start: 0, end: rows.length };
    return computeWindowRange({ rowCount: rows.length, viewportHeight, scrollTop });
  }, [windowed, rows.length, viewportHeight, scrollTop]);

  const renderedRows = windowed ? rows.slice(range.start, range.end) : rows;

  // Measure the scroll viewport ONCE per container mount (§13 budget); a
  // ResizeObserver (when available) keeps the range honest across pane
  // resizes/zone switches without re-measuring on every render.
  useEffect(() => {
    if (!windowed) return;
    const container = scrollRef.current;
    if (!container) return;
    if (container.clientHeight > 0) setViewportHeight(container.clientHeight);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (container.clientHeight > 0) setViewportHeight(container.clientHeight);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [windowed]);

  // §13 reveal: keep the selected row inside the rendered window. This is
  // what carries selection across the window boundary — keyboard navigation
  // from this tree AND external selections (IssuesList "Go to" → store
  // select; canvas card click) all land here. Tree-internal navigation also
  // finishes with DOM focus on the revealed row (roving tabindex, §12).
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!windowed) return;
    const container = scrollRef.current;
    if (!container) return;
    const target = state.selection;
    if (!target) return;
    const idx = rows.findIndex((row) => row.block.id === target);
    if (idx < 0) return;
    const aligned = scrollTopForIndex(
      idx,
      TREE_ROW_HEIGHT_PX,
      container.scrollTop,
      container.clientHeight,
    );
    // Capture BEFORE mutating — after the assignment `aligned ===
    // container.scrollTop` holds and a naive re-check would always read false.
    const scrolled = aligned !== container.scrollTop;
    if (scrolled) {
      container.scrollTop = aligned; // native scroll event re-syncs state
      setScrollTop(aligned); // render the right window immediately
    }
    if (pendingFocusRef.current === target) {
      pendingFocusRef.current = null;
      const focusTarget = () => {
        treeRef.current?.querySelector<HTMLElement>(`[data-block-id="${target}"]`)?.focus();
      };
      // A reveal that scrolled renders the row on the NEXT React commit —
      // wait two frames so the element exists before moving DOM focus
      // (roving tabindex, §12). In-window selections focus immediately.
      if (scrolled) requestAnimationFrame(() => requestAnimationFrame(focusTarget));
      else focusTarget();
    }
  }, [windowed, rows, state.selection, range.start, range.end]);

  // Roving tabindex: the focused row wins, else the selected one, else the
  // first RENDERED row — exactly one tab stop among rendered rows even when
  // the active row is outside the window (the reveal effect scrolls it in).
  const activeCandidate = focusedId ?? state.selection ?? renderedRows[0]?.block.id ?? null;
  const activeId = renderedRows.some((row) => row.block.id === activeCandidate)
    ? activeCandidate
    : renderedRows[0]?.block.id ?? null;

  const focusRow = (id: string): void => {
    treeRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.focus();
  };

  const select = (id: string) => {
    setFocusedId(id);
    pendingFocusRef.current = id; // the reveal effect completes boundary crossings
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
      <p className="m-2 rounded-lg border border-dashed border-[color:var(--ff-border)] p-2 text-xs text-[color:var(--ff-muted)]" data-testid="blocks-tree-empty">
        No blocks yet — use “Add block” to start.
      </p>
    );
  }

  // §13: exact spacer heights keep the scroll geometry identical to a fully
  // rendered list. The <ul> itself becomes the scroll container (gap 0 — the
  // fixed row height replaces it so row offset == index * height).
  const topSpacer = range.start * TREE_ROW_HEIGHT_PX;
  const bottomSpacer = Math.max(0, rows.length - range.end) * TREE_ROW_HEIGHT_PX;

  return (
    <ul
      ref={(node) => {
        treeRef.current = node;
        scrollRef.current = node;
      }}
      role="tree"
      aria-label="Blocks"
      data-testid="blocks-tree"
      data-virtualized={windowed ? "true" : undefined}
      className="m-0 flex list-none flex-col gap-0.5 p-0"
      style={windowed ? { gap: 0, overflowY: "auto", maxHeight: "100%" } : undefined}
      onScroll={
        windowed
          ? (event: UIEvent<HTMLUListElement>) => setScrollTop(event.currentTarget.scrollTop)
          : undefined
      }
    >
      {topSpacer > 0 && <li role="none" aria-hidden="true" style={{ height: topSpacer }} />}
      {renderedRows.map((row, i) => {
        const idx = range.start + i;
        const issues = validateLabelPresence(row.block);
        // Meridian selected row: ultramarine 8% tint + a 2px left ultramarine
        // bar (inset shadow follows the row radius). Height is untouched —
        // the §13 windowing math depends on the fixed 32px row box.
        const rowChrome: CSSProperties =
          state.selection === row.block.id
            ? {
                background: "color-mix(in srgb, var(--ff-primary) 8%, transparent)",
                boxShadow: "inset 2px 0 0 0 var(--ff-primary)",
              }
            : {};
        return (
          <li
            key={row.block.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={state.selection === row.block.id}
            aria-expanded={row.expandable ? row.expanded : undefined}
            tabIndex={row.block.id === activeId ? 0 : -1}
            className="ff-tree-row [&:not([aria-selected='true']):hover]:bg-[color:var(--ff-bg-2)]!"
            style={
              windowed
                ? { height: TREE_ROW_HEIGHT_PX, paddingLeft: row.depth * 14 + 8, ...rowChrome }
                : { paddingLeft: row.depth * 14 + 8, ...rowChrome }
            }
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
            <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px] text-[color:var(--ff-muted)]">
              {blockIcon(row.block.kind)}
            </span>
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
      {bottomSpacer > 0 && <li role="none" aria-hidden="true" style={{ height: bottomSpacer }} />}
    </ul>
  );
}
