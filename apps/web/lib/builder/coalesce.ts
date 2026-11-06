// Coalescing utilities (spec §3.3 + §21 "Coalescing" column, milestone B1).
//
// Consecutive `block.update` ops on the SAME block id within 800 ms (typing)
// merge into one undo entry and one outgoing op; repeated `block.move` ops on
// the same id (keyboard repeat) merge into a single final move. Coalescing
// never crosses a different block id or op type.
//
// The window is checked against INJECTED timestamps (`at`), never Date.now —
// spec §14 (clock skew): client time must never order ops, so it is only used
// for this local UX window, and tests pass explicit stamps.

import type { Op } from "./ops";
import type { History, HistoryEntry } from "./history";

export const COALESCE_WINDOW_MS = 800;

export type UpdateOp = Extract<Op, { op: "block.update" }>;
export type MoveOp = Extract<Op, { op: "block.move" }>;
export type CoalescableOp = UpdateOp | MoveOp;

/** Only `block.update` and `block.move` ever coalesce (§3.3, §21). */
export function isCoalescableOp(op: Op): op is CoalescableOp {
  return op.op === "block.update" || op.op === "block.move";
}

/** True when `nextAt` is within `windowMs` of `prevAt` (inclusive; negative gaps never merge). */
export function withinWindow(prevAt: number, nextAt: number, windowMs = COALESCE_WINDOW_MS): boolean {
  return nextAt >= prevAt && nextAt - prevAt <= windowMs;
}

function sameCoalesceTarget(a: Op, b: Op): boolean {
  if (a.op !== b.op) return false;
  if (a.op === "block.update" && b.op === "block.update") return a.id === b.id;
  if (a.op === "block.move" && b.op === "block.move") return a.id === b.id;
  return false;
}

/**
 * Merge two coalescable ops into one, or return null when they must NOT merge
 * (different op types, different block ids, or a window gap when `times` given).
 *
 * - `block.update`: props patches merge (later value wins per key; `null`
 *   delete-tokens are preserved values and override like any other).
 * - `block.move`: only the FINAL destination matters (keyboard repeat). With
 *   the final-index-after-removal semantics this is exact: relocating an item
 *   and removing it again leaves the other items in their original order.
 *
 * The merged entry's INVERSE is merged separately via `coalesceInverses`
 * (§21: "keep the earliest inverse").
 */
export function coalesceOps(
  prev: Op,
  next: Op,
  windowMs = COALESCE_WINDOW_MS,
  times?: { prevAt: number; nextAt: number },
): Op | null {
  if (times && !withinWindow(times.prevAt, times.nextAt, windowMs)) return null;
  if (!sameCoalesceTarget(prev, next)) return null;

  if (prev.op === "block.update" && next.op === "block.update") {
    return { op: "block.update", id: prev.id, props: { ...prev.props, ...next.props } };
  }
  if (prev.op === "block.move" && next.op === "block.move") {
    return { op: "block.move", id: next.id, parentId: next.parentId, index: next.index };
  }
  return null;
}

/**
 * Merge the INVERSE ops of two coalesced ops, keeping the EARLIEST inverse per
 * §21: on key conflicts the earliest inverse's value wins (it is the value from
 * before the whole run); the later inverse only contributes keys the earliest
 * did not already cover. For `block.move` the earliest inverse (restore the
 * original parent + index) is exactly right on its own.
 */
export function coalesceInverses(earliest: Op, later: Op): Op | null {
  if (!sameCoalesceTarget(earliest, later)) return null;
  if (earliest.op === "block.update" && later.op === "block.update") {
    return {
      op: "block.update",
      id: earliest.id,
      props: { ...later.props, ...earliest.props },
    };
  }
  return earliest;
}

/**
 * Store-side coalescing (§3.3): merge a new single-op dispatch into the LAST
 * history entry when it carries the same coalesce key and arrives within the
 * window. Returns the updated history (redo stack cleared — a new user edit
 * always clears it) plus the single MERGED op to emit, or null when the
 * dispatch must be pushed as a fresh entry instead.
 *
 * Merging keeps the entry's earliest inverse (§21) and replaces the label.
 * Only single-op entries of coalescable type merge — group applies (AI batch)
 * and multi-op dispatches never merge.
 */
export function mergeCoalescedEntry(
  history: History,
  next: { key: string; at: number; op: Op; inverse: Op | undefined; label?: string },
): { history: History; ops: Op[] } | null {
  const last = history.past[history.past.length - 1];
  if (!last || last.ops.length !== 1) return null;
  if (last.coalesceKey === undefined || last.coalesceAt === undefined) return null;
  if (last.coalesceKey !== next.key) return null;
  if (!withinWindow(last.coalesceAt, next.at)) return null;

  const lastOp = last.ops[0];
  if (!lastOp) return null;
  const mergedOp = coalesceOps(lastOp, next.op);
  if (!mergedOp || !isCoalescableOp(lastOp)) return null;

  const lastInverse = last.inverse[0];
  const mergedInverse =
    next.inverse && lastInverse
      ? coalesceInverses(lastInverse, next.inverse)
      : (lastInverse ?? next.inverse ?? null);
  const merged: HistoryEntry = {
    ...last,
    label: next.label ?? last.label,
    ops: [mergedOp],
    inverse: mergedInverse ? [mergedInverse] : last.inverse,
    coalesceAt: next.at,
  };
  return {
    history: { past: [...history.past.slice(0, -1), merged], future: [] },
    ops: [mergedOp],
  };
}
