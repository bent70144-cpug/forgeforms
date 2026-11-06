// T15 — Submissions tab (spec §14.1.5): cursor-paginated table with one column
// per question ("—" for empty), status filter, submitted_at sort, 5s poll so a
// fresh submission shows within 5s, row click → detail drawer.
// B5: ff-seg status filter, icon sort/refresh affordances, sticky tinted thead,
// progressive column disclosure on small screens, token-driven states.

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
import { BANNER_SUCCESS, BTN_PRIMARY, BTN_SECONDARY_SM, CARD, SEG, SEG_BTN } from "../../lib/ui";
import { EmptyState } from "../ui/empty-state";
import { Icon } from "../ui/icons";
import { ErrorState, TableSkeleton, errorCodeOf } from "./Feedback";
import { StatusPill } from "./StatusPill";
import { SubmissionDrawer } from "./SubmissionDrawer";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "draft", label: "Drafts" },
  { value: "spam", label: "Spam" },
];

const POLL_MS = 5000;

/** Progressive disclosure: token + first question from md, further questions from lg. */
const questionColClass = (index: number): string =>
  index === 0 ? "hidden md:table-cell" : "hidden lg:table-cell";

const TH = "px-3 py-2.5 text-left text-xs font-medium text-[var(--ff-muted)] whitespace-nowrap";
const TD = "px-3 py-2.5";

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
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const querySeq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const questionBlocks = useMemo(() => body.filter(isQuestionBlock), [body]);

  /** Fetch the first page for a filter/sort combo (also used by Retry/Refresh). */
  const load = useCallback(
    (nextStatus: StatusFilter, nextSort: SortDir) => {
      const qid = ++querySeq.current;
      setErrorCode(null);
      dispatch({ type: "reset", queryId: qid, status: nextStatus, sort: nextSort });
      client
        .listSubmissions(docId, { limit: DEFAULT_PAGE_SIZE, status: nextStatus, sort: nextSort })
        .then((page) => dispatch({ type: "firstPage", queryId: qid, page }))
        .catch((err) => {
          setErrorCode(errorCodeOf(err));
          dispatch({ type: "error", message: describeError(err) });
        });
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
      .catch((err) => {
        setErrorCode(errorCodeOf(err));
        dispatch({ type: "error", message: describeError(err) });
      });
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
        <div className={SEG} role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={SEG_BTN}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--ff-muted)]">
          <span className="flex items-center gap-1.5 tabular-nums">
            <Icon name="refresh" size={12} />
            Auto-refreshes every {POLL_MS / 1000}s
          </span>
          <button type="button" onClick={() => load(status, sort)} className={BTN_SECONDARY_SM}>
            Refresh
          </button>
        </div>
      </div>

      {/* New-responses banner (oldest sort keeps table order stable) */}
      {state.newCount > 0 ? (
        <div className="mt-3">
          <div className={`${BANNER_SUCCESS} flex flex-wrap items-center justify-between gap-3`}>
            <span className="tabular-nums">
              {state.newCount} new {state.newCount === 1 ? "response" : "responses"} arrived
            </span>
            <button
              type="button"
              onClick={() => load(state.status, state.sort)}
              className={BTN_SECONDARY_SM}
            >
              Refresh now
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <div className={`${CARD} overflow-hidden`}>
          {state.loading ? (
            <TableSkeleton />
          ) : state.error ? (
            <div className="p-6">
              <ErrorState message={state.error} code={errorCode} onRetry={() => load(status, sort)} />
            </div>
          ) : state.rows.length === 0 && status === "all" ? (
            // spec §14.2 — empty states are actionable
            <div className="p-6">
              <EmptyState
                icon={<Icon name="inbox" size={20} />}
                title="No responses yet — share your link"
                description="Responses land here in real time once people start filling in your form."
                action={
                  <button
                    type="button"
                    onClick={() => void copyShareLink()}
                    className={BTN_PRIMARY}
                  >
                    <Icon name={copied ? "check" : "link"} size={14} />
                    {copied ? "Link copied" : "Copy share link"}
                  </button>
                }
              />
            </div>
          ) : state.rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                compact
                icon={<Icon name="search" size={18} />}
                title="Nothing matches this filter"
                description="Try a different status filter."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Submissions, sorted by submitted time ({sort === "newest" ? "newest first" : "oldest first"})
                </caption>
                <thead className="sticky top-0 z-10 border-b border-[var(--ff-border)] bg-[var(--ff-card)]">
                  <tr>
                    <th scope="col" className={TH}>
                      <button
                        type="button"
                        onClick={toggleSort}
                        aria-label={`Sort by submitted time, currently ${sort === "newest" ? "newest first" : "oldest first"}`}
                        className="inline-flex items-center gap-1 rounded transition-colors hover:text-[var(--ff-fg)]"
                      >
                        Submitted
                        <Icon
                          name="chevronDown"
                          size={12}
                          className={sort === "oldest" ? "rotate-180" : undefined}
                        />
                      </button>
                    </th>
                    <th scope="col" className={TH}>
                      Status
                    </th>
                    <th scope="col" className={`${TH} hidden md:table-cell`}>
                      Token
                    </th>
                    {questionBlocks.map((block, i) => {
                      const label = questionLabel(block);
                      return (
                        <th
                          key={block.id}
                          scope="col"
                          title={label}
                          className={`${TH} ${questionColClass(i)} max-w-[12rem] truncate`}
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
                <tbody className="divide-y divide-[var(--ff-border)]">
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
                      className="cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_3%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ff-accent)]"
                    >
                      <td className={`${TD} whitespace-nowrap tabular-nums text-[var(--ff-muted)]`}>
                        {formatDateTimeShort(sortKeyOf(row))}
                      </td>
                      <td className={TD}>
                        <StatusPill status={row.status} />
                      </td>
                      <td
                        title={row.publicToken}
                        className={`${TD} hidden whitespace-nowrap font-mono text-xs text-[var(--ff-muted)] md:table-cell`}
                      >
                        {displayCell(row.publicToken, 16)}
                      </td>
                      {questionBlocks.map((block, i) => {
                        const text = formatAnswer(block, row.answers?.[block.id]);
                        return (
                          <td
                            key={block.id}
                            title={text === "—" ? undefined : text}
                            className={`${TD} ${questionColClass(i)} max-w-[14rem] truncate ${
                              text === "—" ? "text-[var(--ff-muted)]" : "text-[var(--ff-fg)]"
                            }`}
                          >
                            {text}
                          </td>
                        );
                      })}
                      <td className={`${TD} whitespace-nowrap text-right`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(row.id);
                          }}
                          className="rounded text-xs font-medium text-[var(--ff-accent)] underline decoration-[color-mix(in_srgb,var(--ff-accent)_40%,transparent)] underline-offset-2 transition-colors hover:decoration-current"
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
            <div className="flex items-center justify-between gap-3 border-t border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-fg)_3%,transparent)] px-4 py-3 text-xs text-[var(--ff-muted)]">
              <span className="tabular-nums">
                Showing {state.rows.length} loaded
                {state.pagesLoaded > 1 ? ` · ${state.pagesLoaded} pages` : ""}
              </span>
              {state.nextCursor ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={state.loadingMore}
                  className={BTN_SECONDARY_SM}
                >
                  {state.loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : (
                <span>End of results</span>
              )}
            </div>
          ) : null}
        </div>
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
