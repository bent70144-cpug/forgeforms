// Client op history for undo/redo (spec §6.3: Cmd/Ctrl+Z / Shift+Z, 100 entries).
// Pure data + functions — the editor reducer owns integration.
//
// B1 additions (spec §3.3, §6.3, §11):
//  - entries may carry a `group` id: undo pops the WHOLE contiguous run of
//    entries sharing that group in one step (AI multi-op apply);
//  - entries may carry a coalesce `coalesceKey` + `coalesceAt` stamp (injectable
//    clock — never Date.now in here) so the store can merge typing/drag
//    dispatches within the §3.3 window.

import type { Op } from "./ops";

export type HistoryEntry = {
  label?: string;
  /** Group id (e.g. an AI apply batch): undo reverts the whole group at once. */
  group?: string;
  /** Coalescing key (e.g. `update:<blockId>`) — only set when the entry accepts merges. */
  coalesceKey?: string;
  /** Timestamp of the latest dispatch merged into this entry (injectable clock). */
  coalesceAt?: number;
  /** Ops that produced the change (re-applied on redo). */
  ops: Op[];
  /** Ops that revert the change (applied on undo). */
  inverse: Op[];
};

export type History = {
  readonly past: readonly HistoryEntry[];
  readonly future: readonly HistoryEntry[];
};

export const HISTORY_LIMIT = 100;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export function pushEntry(history: History, entry: HistoryEntry): History {
  const past = [...history.past, entry];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    // A new user edit always clears the redo stack (spec §6.3).
    future: [],
  };
}

/**
 * Pop the entry to undo. When the newest entries share a non-undefined `group`
 * id, the WHOLE contiguous run is popped and returned as one merged entry
 * (one undo step, one redo step), with inverses ordered newest-first.
 */
export function popUndo(history: History): { history: History; entry: HistoryEntry } | null {
  const last = history.past[history.past.length - 1];
  if (!last) return null;

  if (last.group === undefined) {
    return {
      entry: last,
      history: {
        past: history.past.slice(0, -1),
        future: [...history.future, last],
      },
    };
  }

  // Contiguous run of entries sharing the top entry's group id.
  const groupId = last.group;
  let start = history.past.length;
  while (start > 0 && history.past[start - 1]?.group === groupId) start--;
  const run = history.past.slice(start);
  const merged: HistoryEntry = {
    label: last.label,
    group: groupId,
    ops: run.flatMap((e) => e.ops),
    // Undo applies newest changes first → reverse the collected inverses.
    inverse: run
      .slice()
      .reverse()
      .flatMap((e) => e.inverse),
  };
  return {
    entry: merged,
    history: {
      past: history.past.slice(0, start),
      future: [...history.future, merged],
    },
  };
}

export function popRedo(history: History): { history: History; entry: HistoryEntry } | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: {
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
    },
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}
