// Client op history for undo/redo (spec §14.2: Cmd/Ctrl+Z / Shift+Z, 100 entries).
// Pure data + functions — the editor reducer owns integration.

import type { Op } from "./ops";

export type HistoryEntry = {
  label?: string;
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
    future: [],
  };
}

export function popUndo(history: History): { history: History; entry: HistoryEntry } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
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
