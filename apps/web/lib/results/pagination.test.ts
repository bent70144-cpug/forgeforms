import { describe, expect, it } from "vitest";
import type { SubmissionDTO } from "./types";
import {
  createInitialPaginationState,
  mergePolledRows,
  paginationReducer,
  sortKeyOf,
  type CursorPage,
  type PaginationState,
} from "./pagination";

function submission(id: string, completedAt: string): SubmissionDTO {
  return {
    id,
    documentId: "doc_1",
    versionId: "ver_1",
    status: "completed",
    publicToken: `tok_${id}`,
    answers: {},
    variables: {},
    hidden: {},
    meta: {},
    startedAt: completedAt,
    completedAt,
  };
}

function page(rows: SubmissionDTO[], nextCursor: string | null): CursorPage {
  return { rows, nextCursor };
}

const S = {
  newestFirst: [submission("a", "2026-11-06T10:00:00.000Z"), submission("b", "2026-11-05T09:00:00.000Z")],
  older: [submission("c", "2026-11-04T09:00:00.000Z")],
  fresh: [submission("z", "2026-11-07T10:00:00.000Z")],
};

function loadedState(): PaginationState {
  let state = createInitialPaginationState("all", "newest");
  state = paginationReducer(state, { type: "reset", queryId: 1, status: "all", sort: "newest" });
  state = paginationReducer(state, { type: "firstPage", queryId: 1, page: page(S.newestFirst, "cur_2") });
  return state;
}

describe("sortKeyOf", () => {
  it("prefers completed_at, falls back to started_at for drafts", () => {
    expect(sortKeyOf(submission("x", "2026-11-06T10:00:00.000Z"))).toBe("2026-11-06T10:00:00.000Z");
    const draft = { ...submission("y", "2026-11-06T10:00:00.000Z"), completedAt: null };
    expect(sortKeyOf(draft)).toBe(draft.startedAt);
  });
});

describe("paginationReducer — spec §4 cursor machine", () => {
  it("starts loading with empty rows", () => {
    const state = createInitialPaginationState();
    expect(state.loading).toBe(true);
    expect(state.rows).toEqual([]);
    expect(state.nextCursor).toBeNull();
  });

  it("reset clears rows and stamps the queryId", () => {
    const state = paginationReducer(loadedState(), {
      type: "reset",
      queryId: 7,
      status: "completed",
      sort: "oldest",
    });
    expect(state.queryId).toBe(7);
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(true);
    expect(state.status).toBe("completed");
    expect(state.sort).toBe("oldest");
  });

  it("firstPage stores rows, cursor history and stops loading", () => {
    const state = loadedState();
    expect(state.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(state.nextCursor).toBe("cur_2");
    expect(state.cursorHistory).toEqual(["cur_2"]);
    expect(state.loading).toBe(false);
    expect(state.pagesLoaded).toBe(1);
  });

  it("ignores stale firstPage responses (wrong queryId)", () => {
    const state = createInitialPaginationState();
    const next = paginationReducer(state, { type: "reset", queryId: 2, status: "all", sort: "newest" });
    const stale = paginationReducer(next, {
      type: "firstPage",
      queryId: 1, // older query
      page: page(S.newestFirst, "cur_2"),
    });
    expect(stale.rows).toEqual([]);
    expect(stale.loading).toBe(true);
  });

  it("ignores duplicate firstPage responses (loading already false)", () => {
    const state = loadedState();
    const dup = paginationReducer(state, {
      type: "firstPage",
      queryId: state.queryId,
      page: page(S.newestFirst, "cur_x"),
    });
    expect(dup).toBe(state);
  });

  it("loadMore is a no-op without a next cursor or while loading", () => {
    let state = createInitialPaginationState();
    expect(paginationReducer(state, { type: "loadMore" })).toBe(state);
    // fresh reset (loading=true) resolved with a terminal page (no cursor)
    state = paginationReducer(state, { type: "reset", queryId: 9, status: "all", sort: "newest" });
    state = paginationReducer(state, {
      type: "firstPage",
      queryId: 9,
      page: page(S.newestFirst, null),
    });
    expect(state.nextCursor).toBeNull();
    expect(paginationReducer(state, { type: "loadMore" })).toBe(state);
  });

  it("nextPage appends, dedupes by id and advances the cursor", () => {
    let state = paginationReducer(loadedState(), { type: "loadMore" });
    state = paginationReducer(state, {
      type: "nextPage",
      queryId: 1,
      page: page([S.newestFirst[0]!, ...S.older], "cur_3"),
    });
    expect(state.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(state.nextCursor).toBe("cur_3");
    expect(state.cursorHistory).toEqual(["cur_2", "cur_3"]);
    expect(state.loadingMore).toBe(false);
    expect(state.pagesLoaded).toBe(2);
  });

  it("nextPage is ignored when not loading more", () => {
    const state = loadedState();
    expect(paginationReducer(state, { type: "nextPage", queryId: 1, page: page(S.older, null) })).toBe(state);
  });

  it("breaks cursor loops: a repeated cursor terminates pagination", () => {
    let state = loadedState(); // history: ["cur_2"]
    state = paginationReducer(state, { type: "loadMore" });
    state = paginationReducer(state, {
      type: "nextPage",
      queryId: 1,
      page: page(S.older, "cur_2"), // server repeats itself
    });
    expect(state.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(state.nextCursor).toBeNull();
    expect(state.cursorHistory).toEqual(["cur_2"]);
  });

  it("error surfaces a message and clears both loading flags", () => {
    const state = paginationReducer(createInitialPaginationState(), {
      type: "error",
      message: "boom",
    });
    expect(state.error).toBe("boom");
    expect(state.loading).toBe(false);
    expect(state.loadingMore).toBe(false);
  });
});

describe("mergePolledRows (5s poll — new submissions appear in table)", () => {
  it("newest: prepends fresh rows, dedupes, reports 0 hidden new", () => {
    const merged = mergePolledRows(S.newestFirst, [S.fresh[0]!, S.newestFirst[1]!], "newest");
    expect(merged.rows.map((r) => r.id)).toEqual(["z", "a", "b"]);
    expect(merged.newCount).toBe(0);
  });

  it("oldest: keeps order and surfaces a newCount badge instead", () => {
    const merged = mergePolledRows(S.newestFirst, S.fresh, "oldest");
    expect(merged.rows).toBe(S.newestFirst);
    expect(merged.newCount).toBe(1);
  });

  it("returns the same array when nothing is new", () => {
    const merged = mergePolledRows(S.newestFirst, S.newestFirst, "newest");
    expect(merged.rows).toBe(S.newestFirst);
    expect(merged.newCount).toBe(0);
  });
});

describe("poll / dismissNew actions", () => {
  it("poll merges fresh rows when idle", () => {
    const state = paginationReducer(loadedState(), { type: "poll", rows: S.fresh });
    expect(state.rows.map((r) => r.id)).toEqual(["z", "a", "b"]);
  });

  it("poll is ignored while a page request is in flight", () => {
    const state = createInitialPaginationState();
    expect(paginationReducer(state, { type: "poll", rows: S.fresh })).toBe(state);
  });

  it("dismissNew clears the badge and is idempotent", () => {
    let state = paginationReducer(loadedState(), { type: "poll", rows: S.fresh });
    // newest sort auto-merged, badge stays 0
    expect(state.newCount).toBe(0);
    state = paginationReducer({ ...state, newCount: 3 }, { type: "dismissNew" });
    expect(state.newCount).toBe(0);
    expect(paginationReducer(state, { type: "dismissNew" })).toBe(state);
  });
});
