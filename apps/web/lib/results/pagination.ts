// T15 — cursor pagination state machine (spec §4) + polled-rows merge.
// Pure reducer so the submissions table stays declarative and the tricky
// parts (dedupe, stale-response guards, cursor-loop protection) are testable.

import type { SortDir, StatusFilter, SubmissionDTO } from "./types";

/** A resolved page from any ResultsClient (spec §4 envelope). */
export interface CursorPage {
  data: SubmissionDTO[];
  nextCursor: string | null;
}

/** Sort key for submitted_at (drafts fall back to started_at). */
export function sortKeyOf(s: SubmissionDTO): string {
  return s.completedAt ?? s.startedAt;
}

function byId(rows: SubmissionDTO[]): Map<string, SubmissionDTO> {
  const map = new Map<string, SubmissionDTO>();
  for (const r of rows) map.set(r.id, r);
  return map;
}

/**
 * Merge a polled first page into the accumulated rows.
 * - `newest`: fresh rows sort to the top and appear immediately (acceptance
 *   criterion: a new submission shows in the table within 5s).
 * - `oldest`: order would reshuffle, so surface a `newCount` badge instead.
 */
export function mergePolledRows(
  existing: SubmissionDTO[],
  incoming: SubmissionDTO[],
  sort: SortDir,
): { rows: SubmissionDTO[]; newCount: number } {
  const seen = byId(existing);
  const fresh = incoming.filter((r) => !seen.has(r.id));
  if (fresh.length === 0) return { rows: existing, newCount: 0 };
  if (sort === "newest") {
    const merged = [...existing, ...fresh].sort((a, b) =>
      sortKeyOf(b).localeCompare(sortKeyOf(a)),
    );
    return { rows: merged, newCount: 0 };
  }
  return { rows: existing, newCount: fresh.length };
}

export interface PaginationState {
  /** Monotonic query token; responses from older queries are ignored. */
  queryId: number;
  status: StatusFilter;
  sort: SortDir;
  rows: SubmissionDTO[];
  /** Cursor history — protects against an API that repeats a cursor forever. */
  cursorHistory: string[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Rows fetched but not yet visible (oldest sort only). */
  newCount: number;
  pagesLoaded: number;
}

export type PaginationAction =
  | { type: "reset"; queryId: number; status: StatusFilter; sort: SortDir }
  | { type: "firstPage"; queryId: number; page: CursorPage }
  | { type: "loadMore" }
  | { type: "nextPage"; queryId: number; page: CursorPage }
  | { type: "error"; message: string }
  | { type: "poll"; rows: SubmissionDTO[] }
  | { type: "dismissNew" };

export function createInitialPaginationState(
  status: StatusFilter = "all",
  sort: SortDir = "newest",
): PaginationState {
  return {
    queryId: 0,
    status,
    sort,
    rows: [],
    cursorHistory: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
    newCount: 0,
    pagesLoaded: 0,
  };
}

/** Cursor is accepted only when non-empty and never seen before (loop guard). */
function acceptCursor(cursor: string | null, history: string[]): string | null {
  if (!cursor) return null;
  return history.includes(cursor) ? null : cursor;
}

/** Unique rows, preserving order; ids already present are skipped. */
function dedupeAppend(existing: SubmissionDTO[], incoming: SubmissionDTO[]): SubmissionDTO[] {
  if (incoming.length === 0) return existing;
  const seen = byId(existing);
  const out = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.set(row.id, row);
    out.push(row);
  }
  return out;
}

export function paginationReducer(state: PaginationState, action: PaginationAction): PaginationState {
  switch (action.type) {
    case "reset": {
      const fresh = createInitialPaginationState(action.status, action.sort);
      return { ...fresh, queryId: action.queryId };
    }
    case "firstPage": {
      // Stale-response guard: only the current query may resolve.
      if (state.queryId !== action.queryId || !state.loading) return state;
      const rows = dedupeAppend([], action.page.data);
      return {
        ...state,
        loading: false,
        rows,
        nextCursor: acceptCursor(action.page.nextCursor, []),
        cursorHistory: action.page.nextCursor ? [action.page.nextCursor] : [],
        pagesLoaded: 1,
        error: null,
        newCount: 0,
      };
    }
    case "loadMore": {
      if (!state.nextCursor || state.loading || state.loadingMore) return state;
      return { ...state, loadingMore: true };
    }
    case "nextPage": {
      if (state.queryId !== action.queryId || !state.loadingMore) return state;
      const rows = dedupeAppend(state.rows, action.page.data);
      // Loop guard runs against the OLD history — a fresh cursor is new here.
      const nextCursor = acceptCursor(action.page.nextCursor, state.cursorHistory);
      const history = nextCursor ? [...state.cursorHistory, nextCursor] : state.cursorHistory;
      return {
        ...state,
        loadingMore: false,
        rows,
        cursorHistory: history,
        nextCursor,
        pagesLoaded: state.pagesLoaded + 1,
        error: null,
      };
    }
    case "error":
      return { ...state, loading: false, loadingMore: false, error: action.message };
    case "poll": {
      if (state.loading || state.loadingMore) return state;
      const merged = mergePolledRows(state.rows, action.rows, state.sort);
      if (merged.rows === state.rows && merged.newCount === 0) return state;
      return { ...state, rows: merged.rows, newCount: state.newCount + merged.newCount };
    }
    case "dismissNew":
      return state.newCount === 0 ? state : { ...state, newCount: 0 };
    default:
      return state;
  }
}
