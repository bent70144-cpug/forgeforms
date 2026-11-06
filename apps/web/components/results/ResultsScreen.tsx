// T15 — Results screen shell (`/d/:docId/results`, spec §14.1.5): document
// header, Submissions / Summary / Analytics tabs, client seam for data.

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createResultsClient,
  describeError,
  type DocumentSummary,
} from "../../lib/results";
import { EmptyState, ErrorState, Skeleton, errorCodeOf } from "./Feedback";
import { SubmissionsTable } from "./SubmissionsTable";
import { SummaryTab } from "./SummaryTab";

type Tab = "submissions" | "summary" | "analytics";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "submissions", label: "Submissions" },
  { id: "summary", label: "Summary" },
  { id: "analytics", label: "Analytics" },
];

const TAB_ACTIVE = "border-[var(--ff-primary)] text-[var(--ff-fg)]";
const TAB_IDLE = "border-transparent text-[var(--ff-muted)] hover:text-[var(--ff-fg)]";

function typeBadge(type: DocumentSummary["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
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
      <header className="border-b border-[var(--ff-border)] bg-[var(--ff-card)]">
        <div className="mx-auto max-w-7xl px-6 pt-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-80" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : docError ? (
            <div className="pb-6">
              <ErrorState
                message={docError}
                code={docErrorCode}
                onRetry={() => setNonce((n) => n + 1)}
              />
            </div>
          ) : doc ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-semibold text-[var(--ff-fg)]">{doc.title}</h1>
                  <span className="ff-badge">{typeBadge(doc.type)}</span>
                  <span
                    className={`ff-badge ${
                      doc.status === "published" ? "ff-badge--positive" : "ff-badge--muted"
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="ff-button ff-button-ghost text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)]"
              >
                {copied ? "Link copied ✓" : "Copy public link"}
              </button>
            </div>
          ) : null}

          <nav role="tablist" aria-label="Results sections" className="-mb-px mt-5 flex gap-6">
            {TABS.map((t) => {
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setTab(t.id)}
                  className={`border-b-2 pb-3 text-sm font-medium transition-colors ${selected ? TAB_ACTIVE : TAB_IDLE}`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {docError ? (
          <p className="text-sm text-[var(--ff-muted)]">Load the document above to see its results.</p>
        ) : !doc ? (
          <div className="space-y-3" role="status" aria-label="Loading results">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : tab === "submissions" ? (
          <SubmissionsTable docId={docId} client={client} body={doc.body.blocks} slug={doc.slug} />
        ) : tab === "summary" ? (
          <SummaryTab docId={docId} client={client} slug={doc.slug} />
        ) : (
          // Analytics placeholder — the real screen is owned by T19 (issue #19).
          <EmptyState
            title="Analytics lives in its own workspace"
            description="Views, starts, completes and the 30-day trend are tracked in the Analytics screen."
            action={
              <Link
                href={`/d/${docId}/analytics`}
                className="ff-button ff-button-primary text-sm"
              >
                Open analytics →
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
