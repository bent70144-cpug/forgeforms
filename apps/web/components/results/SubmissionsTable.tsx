// T15 — Submissions tab (spec §14.1.5): cursor-paginated table with one column
// per question ("—" for empty), status filter, submitted_at sort, 5s poll so a
// fresh submission shows within 5s, row click → detail drawer.

"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Block } from "../../lib/results-bridge";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createInitialPaginationState,
  describeError,
  displayCell,
  formatAnswer,
  formatDateTimeShort,
  isQuestionBlock,
  paginationReducer,
  questionLabel,
  sortKeyOf,
  truncateLabel,
  type ResultsClient,
  type SortDir,
  type StatusFilter,
} from "../../lib/results";
import { EmptyState, ErrorState, TableSkeleton } from "./Feedback";
import { StatusPill } from "./StatusPill";
import { SubmissionDrawer } from "./SubmissionDrawer";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "draft", label: "Drafts" },
  { value: "spam", label: "Spam" },
];

const POLL_MS = 5000;

const FILTER_BUTTON_ACTIVE =
  "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm";
const FILTER_BUTTON_IDLE =
  "rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900";

export interface SubmissionsTableProps {
  docId: string;
  client: ResultsClient;
  body: Block[];
  /** Document slug — powers the actionable empty state ("share your link"). */
  slug: string;
}

export function SubmissionsTable({ docId, client, body, slug }: SubmissionsTableProps) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortDir>("newest");
  const [state, dispatch] = useReducer(
    paginationReducer,
    undefined,
    () => createInitialPaginationState(),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const querySeq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const questionBlocks = useMemo(() => body.filter(isQuestionBlock), [body]);

  /** Fetch the first page for a filter/sort combo (also used by Retry/Refresh). */
  const load = useCallback(
    (nextStatus: StatusFilter, nextSort: SortDir) => {
      const qid = ++querySeq.current;
      dispatch({ type: "reset", queryId: qid, status: nextStatus, sort: nextSort });
      client
        .listSubmissions(docId, { limit: DEFAULT_PAGE_SIZE, status: nextStatus, sort: nextSort })
        .then((page) => dispatch({ type: "firstPage", queryId: qid, page }))
        .catch((err) => dispatch({ type: "error", message: describeError(err) }));
    },
    [client, docId],
  );

  useEffect(() => {
    load(status, sort);
  }, [load, status, sort]);

  // spec/issue AC: a submission made in e2e appears in the table within 5s.
  // Poll always fetches newest-first (with the active status filter): under the
  // default "newest" sort fresh rows merge straight into the table; under
  // "oldest" they surface as a "new responses" badge instead of reshuffling.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const s = stateRef.current;
      if (s.loading || s.loadingMore || s.error) return;
      client
        .listSubmissions(docId, {
          limit: Math.min(MAX_PAGE_SIZE, Math.max(DEFAULT_PAGE_SIZE, s.rows.length)),
          status,
          sort: "newest",
        })
        .then((page) => dispatch({ type: "poll", rows: page.data }))
        .catch(() => undefined); // transient poll errors retry on the next tick
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [client, docId, status]);

  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (!s.nextCursor || s.loading || s.loadingMore) return;
    dispatch({ type: "loadMore" });
    client
      .listSubmissions(docId, {
        limit: DEFAULT_PAGE_SIZE,
        cursor: s.nextCursor,
        status: s.status,
        sort: s.sort,
      })
      .then((page) => dispatch({ type: "nextPage", queryId: s.queryId, page }))
      .catch((err) => dispatch({ type: "error", message: describeError(err) }));
  }, [client, docId]);

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/p/${slug}` : `/p/${slug}`;
  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — nothing to do.
    }
  }, [shareUrl]);

  const toggleSort = () => setSort((s) => (s === "newest" ? "oldest" : "newest"));
  const openRow = state.rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      {/* Toolbar: status filter + auto-refresh controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={status === f.value ? FILTER_BUTTON_ACTIVE : FILTER_BUTTON_IDLE}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Auto-refreshes every {POLL_MS / 1000}s</span>
          <button
            type="button"
            onClick={() => load(status, sort)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* New-responses badge (oldest sort keeps table order stable) */}
      {state.newCount > 0 ? (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          <span>
            {state.newCount} new {state.newCount === 1 ? "response" : "responses"} arrived
          </span>
          <button
            type="button"
            onClick={() => load(state.status, state.sort)}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            Refresh now
          </button>
        </div>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {state.loading ? (
          <TableSkeleton />
        ) : state.error ? (
          <div className="p-6">
            <ErrorState message={state.error} onRetry={() => load(status, sort)} />
          </div>
        ) : state.rows.length === 0 && status === "all" ? (
          // spec §14.2 — empty states are actionable
          <div className="p-6">
            <EmptyState
              title="No responses yet — share your link"
              description="Responses land here in real time once people start filling in your form."
              action={
                <button
                  type="button"
                  onClick={() => void copyShareLink()}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
                >
                  {copied ? "Link copied ✓" : "Copy share link"}
                </button>
              }
            />
          </div>
        ) : state.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing matches this filter"
              description="Try a different status filter."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">
                Submissions, sorted by submitted time ({sort === "newest" ? "newest first" : "oldest first"})
              </caption>
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    <button
                      type="button"
                      onClick={toggleSort}
                      aria-label={`Sort by submitted time, currently ${sort === "newest" ? "newest first" : "oldest first"}`}
                      className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Submitted
                      <span aria-hidden="true" className="text-slate-400">
                        {sort === "newest" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">
                    Token
                  </th>
                  {questionBlocks.map((block) => {
                    const label = questionLabel(block);
                    return (
                      <th
                        key={block.id}
                        scope="col"
                        title={label}
                        className="max-w-[12rem] truncate px-4 py-3 text-left font-semibold text-slate-600"
                      >
                        {truncateLabel(label, 24)}
                      </th>
                    );
                  })}
                  <th scope="col" className="sr-only">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.rows.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    onClick={() => setOpenId(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(row.id);
                      }
                    }}
                    aria-label={`Open submission ${row.id}`}
                    className="cursor-pointer transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatDateTimeShort(sortKeyOf(row))}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={row.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">
                      {displayCell(row.publicToken, 16)}
                    </td>
                    {questionBlocks.map((block) => {
                      const text = formatAnswer(block, row.answers?.[block.id]);
                      return (
                        <td
                          key={block.id}
                          title={text === "—" ? undefined : text}
                          className={`max-w-[14rem] truncate px-4 py-3 ${
                            text === "—" ? "text-slate-300" : "text-slate-700"
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(row.id);
                        }}
                        className="rounded text-xs font-semibold text-indigo-600 transition hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer: cursor pagination controls (spec §4) */}
        {!state.loading && !state.error && state.rows.length > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
            <span>
              Showing {state.rows.length} loaded
              {state.pagesLoaded > 1 ? ` · ${state.pagesLoaded} pages` : ""}
            </span>
            {state.nextCursor ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={state.loadingMore}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : (
              <span>End of results</span>
            )}
          </div>
        ) : null}
      </div>

      {openRow ? (
        <SubmissionDrawer
          docId={docId}
          client={client}
          submission={openRow}
          blocks={body}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
