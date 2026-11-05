// T15 — Summary tab (spec §14.1.5): headline cards (responses, completion
// rate), per-question aggregates — choice distributions, rating averages,
// NPS segments — all rendered with dependency-free CSS bars.

"use client";

import { useEffect, useState } from "react";
import type { DocumentBody } from "../../lib/results-bridge";
import {
  describeError,
  truncateLabel,
  type BlockAggregate,
  type ResultsClient,
  type SummaryResponse,
} from "../../lib/results";
import { BarList } from "./BarList";
import { CardsSkeleton, EmptyState, ErrorState, Skeleton } from "./Feedback";
import { NpsBar } from "./NpsBar";
import { StatCards } from "./StatCards";

const KIND_LABELS: Record<BlockAggregate["kind"], string> = {
  choice: "Choice",
  rating: "Rating",
  nps: "NPS",
  number: "Number",
  text: "Text",
  file: "Files",
  unsupported: "Other",
};

function formatAverage(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function AggregateCard({ aggregate }: { aggregate: BlockAggregate }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900" title={aggregate.label}>
            {truncateLabel(aggregate.label, 80)}
          </h3>
          <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-500">
            {KIND_LABELS[aggregate.kind]}
          </span>
        </div>
        <p className="shrink-0 text-xs text-slate-500">
          {aggregate.totalResponses} {aggregate.totalResponses === 1 ? "response" : "responses"}
        </p>
      </header>

      {aggregate.kind === "choice" ? (
        <BarList
          ariaLabel={`Distribution for ${aggregate.label}`}
          items={aggregate.distribution.map((bucket) => ({ label: bucket.label, value: bucket.count }))}
        />
      ) : aggregate.kind === "rating" ? (
        <div>
          <p className="mb-3 text-sm text-slate-600">
            Average{" "}
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {formatAverage(aggregate.average)}
            </span>{" "}
            <span className="text-slate-400">/ {aggregate.scale}</span>
          </p>
          <BarList
            ariaLabel={`Rating distribution for ${aggregate.label}`}
            items={aggregate.distribution.map((d) => ({
              label: `${d.value} ★`,
              value: d.count,
            }))}
          />
        </div>
      ) : aggregate.kind === "nps" ? (
        <NpsBar aggregate={aggregate} />
      ) : aggregate.kind === "number" ? (
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Average</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
              {formatAverage(aggregate.average)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Min</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
              {formatAverage(aggregate.min)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Max</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
              {formatAverage(aggregate.max)}
            </dd>
          </div>
        </dl>
      ) : aggregate.kind === "text" ? (
        aggregate.recent.length === 0 ? (
          <p className="text-sm text-slate-400">No written answers yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {aggregate.recent.map((text, i) => (
              <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <span aria-hidden="true" className="mr-1 text-slate-400">
                  “
                </span>
                {text}
                <span aria-hidden="true" className="ml-1 text-slate-400">
                  ”
                </span>
              </li>
            ))}
          </ul>
        )
      ) : aggregate.kind === "file" ? (
        <p className="text-sm text-slate-600">
          {aggregate.fileCount} {aggregate.fileCount === 1 ? "file" : "files"} uploaded across{" "}
          {aggregate.totalResponses} {aggregate.totalResponses === 1 ? "response" : "responses"}.
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          No chart for this block kind yet — {aggregate.totalResponses} responses recorded.
        </p>
      )}
    </section>
  );
}

export interface SummaryTabProps {
  docId: string;
  client: ResultsClient;
  body: DocumentBody;
  slug: string;
}

export function SummaryTab({ docId, client, body, slug }: SummaryTabProps) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getSummary(docId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, docId, nonce]);

  const copyShareLink = async () => {
    try {
      const url = `${window.location.origin}/p/${slug}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading summary">
        <CardsSkeleton />
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <ErrorState message={error ?? "Summary unavailable"} onRetry={() => setNonce((n) => n + 1)} />
    );
  }

  if (summary.counts.total === 0) {
    // spec §14.2 — empty states are actionable
    return (
      <EmptyState
        title="No responses yet — share your link"
        description="Summary charts appear here as soon as the first responses come in."
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
    );
  }

  return (
    <div className="space-y-6">
      <StatCards counts={summary.counts} />
      {summary.blocks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
          This document has no question blocks to summarize.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {summary.blocks.map((aggregate) => (
            <AggregateCard key={aggregate.blockId} aggregate={aggregate} />
          ))}
        </div>
      )}
    </div>
  );
}
