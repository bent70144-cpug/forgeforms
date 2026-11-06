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
import { EmptyState, ErrorState, Skeleton } from "./Feedback";
import { SubmissionsTable } from "./SubmissionsTable";
import { SummaryTab } from "./SummaryTab";

type Tab = "submissions" | "summary" | "analytics";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "submissions", label: "Submissions" },
  { id: "summary", label: "Summary" },
  { id: "analytics", label: "Analytics" },
];

const TAB_ACTIVE = "border-indigo-600 text-slate-900";
const TAB_IDLE = "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700";

function typeBadge(type: DocumentSummary["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function ResultsScreen({ docId }: { docId: string }) {
  const client = useMemo(() => createResultsClient(), []);
  const [tab, setTabState] = useState<Tab>("submissions");
  const [doc, setDoc] = useState<DocumentSummary | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
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
    client
      .getDocument(docId)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err) => {
        if (!cancelled) setDocError(describeError(err));
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 pt-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-80" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : docError ? (
            <div className="pb-6">
              <ErrorState message={docError} onRetry={() => setNonce((n) => n + 1)} />
            </div>
          ) : doc ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-semibold text-slate-900">{doc.title}</h1>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {typeBadge(doc.type)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      doc.status === "published"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                        : "bg-slate-50 text-slate-600 ring-slate-500/20"
                    }`}
                  >
                    {doc.status}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-slate-500">/d/{docId}/results</p>
              </div>
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                  className={`border-b-2 pb-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? TAB_ACTIVE : TAB_IDLE}`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {docError ? (
          <p className="text-sm text-slate-500">Load the document above to see its results.</p>
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
                className="inline-flex items-center rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
              >
                Open analytics →
              </Link>
            }
          />
        )}
      </main>
    </div>
  );
}
