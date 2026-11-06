// T19 — Analytics tab (spec §14.1.5: views, starts, completes, completion rate,
// 30-day trend; issue #19: KPIs + trend render from analytics_daily rollups
// with a raw-event fallback before the first job run).
// SPEC-NOTE: the spec places Analytics as a tab of Results (/d/:id/results);
// per T19 ownership this page ships at its own route /d/:docId/analytics. The
// integrator can embed <AnalyticsTab> into the Results tabs once T16 lands.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DropOffPanel } from "./_components/DropOffPanel";
import { KpiCards } from "./_components/KpiCards";
import { TrendChart } from "./_components/TrendChart";
import { loadAnalyticsTabData } from "./_lib/load-summary";
import type { RangeSpec } from "../../../../../../../packages/core/src/analytics";

// Beacons/queries must never be cached at the page level.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics — FormForge",
};

interface AnalyticsPageProps {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ range?: string }>;
}

function toRangeSpec(rangeParam: string | undefined): RangeSpec {
  return rangeParam === "7" ? { kind: "preset", preset: "7d" } : { kind: "preset", preset: "30d" };
}

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { docId } = await params;
  const { range } = await searchParams;
  const spec = toRangeSpec(range);
  const data = await loadAnalyticsTabData(docId, spec);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={`/d/${docId}/results`}
            className="text-sm text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-fg)]"
          >
            ← Results
          </Link>
          <h1 className="text-2xl font-semibold text-balance text-[var(--ff-fg)]">Analytics</h1>
        </div>
        <nav aria-label="Range" className="flex items-center gap-1 text-sm">
          <Link
            href={`/d/${docId}/analytics?range=7`}
            aria-current={spec.kind === "preset" && spec.preset === "7d" ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              spec.kind === "preset" && spec.preset === "7d"
                ? "bg-[var(--ff-primary)] text-[var(--ff-primary-fg)]"
                : "text-[var(--ff-muted)] hover:text-[var(--ff-fg)]"
            }`}
          >
            Last 7 days
          </Link>
          <Link
            href={`/d/${docId}/analytics?range=30`}
            aria-current={spec.kind === "preset" && spec.preset === "30d" ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              spec.kind === "preset" && spec.preset === "30d"
                ? "bg-[var(--ff-primary)] text-[var(--ff-primary-fg)]"
                : "text-[var(--ff-muted)] hover:text-[var(--ff-fg)]"
            }`}
          >
            Last 30 days
          </Link>
        </nav>
      </header>

      {data === null ? (
        <EmptyState
          title="Analytics couldn’t load"
          body="Something went wrong loading analytics. Try again in a moment."
        />
      ) : data.summary.kpis.views === 0 &&
        data.summary.kpis.starts === 0 &&
        data.summary.kpis.submissions === 0 ? (
        <EmptyState
          title="No responses yet"
          body="Analytics appear here once your form starts collecting responses."
          hint={
            <>
              Want the raw answers? Open the{" "}
              <Link
                href={`/d/${docId}/results`}
                className="text-[var(--ff-primary)] underline underline-offset-2 hover:opacity-80"
              >
                Results tab
              </Link>
              .
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          <KpiCards
            views={data.summary.kpis.views}
            uniques={data.summary.kpis.uniques}
            starts={data.summary.kpis.starts}
            submissions={data.summary.kpis.submissions}
            completionRate={data.summary.kpis.completionRate}
          />
          <section aria-labelledby="trend-heading">
            <h2 id="trend-heading" className="mb-2 text-sm font-medium text-[var(--ff-fg)]">
              Trend
            </h2>
            <TrendChart series={data.summary.series} />
          </section>
          <section aria-labelledby="dropoff-heading">
            <h2 id="dropoff-heading" className="mb-2 text-sm font-medium text-[var(--ff-fg)]">
              Drop-off per question
            </h2>
            {data.dropOff === null ? (
              <p className="rounded-[var(--ff-radius)] border border-dashed border-[var(--ff-border)] p-6 text-sm text-[var(--ff-muted)]">
                Drop-off is unavailable in this range.
              </p>
            ) : (
              <DropOffPanel enabled={data.dropOff.enabled} steps={data.dropOff.steps} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, body, hint }: { title: string; body: string; hint?: ReactNode }) {
  return (
    <div className="ff-empty">
      <p className="text-base font-semibold text-[var(--ff-fg)]">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-[var(--ff-muted)]">{body}</p>
      {hint ? <p className="max-w-md text-sm text-[var(--ff-muted)]">{hint}</p> : null}
    </div>
  );
}
