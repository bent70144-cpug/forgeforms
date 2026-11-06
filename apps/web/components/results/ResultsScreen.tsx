// T15 — Results screen shell (`/d/:docId/results`, spec §14.1.5): document
// header, Submissions / Summary / Analytics tabs, client seam for data.
// B5: width follows the app shell (no extra max-w), underline tabs matching
// SettingsTabs (icons + coral inset underline, roving arrow-key focus), shared
// EmptyState for the Analytics pointer, token-driven badges/actions.

"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  createResultsClient,
  describeError,
  type DocumentSummary,
} from "../../lib/results";
import {
  BADGE_MUTED,
  BADGE_POSITIVE,
  BADGE_WARNING,
  BTN_GHOST_SM,
  BTN_PRIMARY,
  BTN_SECONDARY_SM,
} from "../../lib/ui";
import { EmptyState } from "../ui/empty-state";
import { Icon, type IconName } from "../ui/icons";
import { ErrorState, Skeleton, errorCodeOf } from "./Feedback";
import { SubmissionsTable } from "./SubmissionsTable";
import { SummaryTab } from "./SummaryTab";

type Tab = "submissions" | "summary" | "analytics";

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "submissions", label: "Submissions", icon: "list" },
  { id: "summary", label: "Summary", icon: "layers" },
  { id: "analytics", label: "Analytics", icon: "chart" },
];

function typeBadge(type: DocumentSummary["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function statusBadgeClass(status: DocumentSummary["status"]): string {
  if (status === "published") return BADGE_POSITIVE;
  if (status === "draft") return BADGE_WARNING;
  return BADGE_MUTED; // archived
}

export function ResultsScreen({ docId }: { docId: string }) {
  const client = useMemo(() => createResultsClient(), []);
  const [tab, setTabState] = useState<Tab>("submissions");
  const [doc, setDoc] = useState<DocumentSummary | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docErrorCode, setDocErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Deep-link support: /d/:docId/results?tab=summary (kept out of useSearchParams
  // so the server shell needs no Suspense boundary).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param === "summary" || param === "analytics") setTabState(param);
  }, []);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      const url = next === "submissions" ? `/d/${docId}/results` : `/d/${docId}/results?tab=${next}`;
      window.history.replaceState(null, "", url);
    },
    [docId],
  );

  // Roving focus for the tab strip: ←/→ moves focus AND selection (wraps).
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    if (next == null) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (!nextTab) return;
    setTab(nextTab.id);
    tabRefs.current[next]?.focus();
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDocError(null);
    setDocErrorCode(null);
    client
      .getDocument(docId)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setDocError(describeError(err));
          setDocErrorCode(errorCodeOf(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, docId, nonce]);

  const copyShareLink = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${doc.slug}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <div>
      <header>
        <div>
          <Link href="/dashboard" className={`${BTN_GHOST_SM} -ml-2`}>
            <Icon name="arrowLeft" size={14} />
            Dashboard
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          {loading ? (
            <div className="min-w-0 space-y-2 py-1">
              <Skeleton className="h-7 w-64 sm:w-80" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : docError ? (
            <div className="min-w-0 flex-1">
              <ErrorState
                message={docError}
                code={docErrorCode}
                onRetry={() => setNonce((n) => n + 1)}
              />
            </div>
          ) : doc ? (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h1 className="min-w-0 text-xl font-semibold tracking-tight text-balance text-[var(--ff-fg)] sm:text-2xl">
                  {doc.title}
                </h1>
                <span className={BADGE_MUTED}>{typeBadge(doc.type)}</span>
                <span className={statusBadgeClass(doc.status)}>{doc.status}</span>
              </div>
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className={BTN_SECONDARY_SM}
              >
                <Icon name={copied ? "check" : "link"} size={14} />
                {copied ? "Link copied" : "Copy public link"}
              </button>
            </>
          ) : null}
        </div>

        <nav
          role="tablist"
          aria-label="Results sections"
          className="mt-6 flex gap-6 overflow-x-auto border-b border-[var(--ff-border)]"
        >
          {TABS.map((t, i) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                type="button"
                id={`results-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={selected ? `results-panel-${t.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-3 pt-1 text-sm font-medium transition-colors hover:text-[var(--ff-fg)] ${
                  selected ? "" : "text-[var(--ff-muted)]"
                }`}
                style={
                  selected
                    ? {
                        color: "var(--ff-fg)",
                        fontWeight: 550,
                        boxShadow: "inset 0 -2px 0 0 var(--ff-accent)",
                      }
                    : undefined
                }
              >
                <Icon name={t.icon} size={14} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="py-6">
        {docError ? (
          <p className="text-sm text-[var(--ff-muted)]">Load the document above to see its results.</p>
        ) : !doc ? (
          <div className="space-y-3" role="status" aria-label="Loading results">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div role="tabpanel" id={`results-panel-${tab}`} aria-labelledby={`results-tab-${tab}`}>
            {tab === "submissions" ? (
              <SubmissionsTable docId={docId} client={client} body={doc.body.blocks} slug={doc.slug} />
            ) : tab === "summary" ? (
              <SummaryTab docId={docId} client={client} slug={doc.slug} />
            ) : (
              // Analytics lives at its own route (T19) — this tab points there.
              <EmptyState
                icon={<Icon name="chart" size={20} />}
                title="Analytics live in their own view"
                description="Views, starts, completes and the 30-day trend are tracked in the Analytics screen."
                action={
                  <Link href={`/d/${docId}/analytics`} className={BTN_PRIMARY}>
                    Open analytics →
                  </Link>
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
