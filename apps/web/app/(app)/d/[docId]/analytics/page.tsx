// T19 — Analytics tab (spec §14.1.5: views, starts, completes, completion rate,
// 30-day trend; issue #19: KPIs + trend render from analytics_daily rollups
// with a raw-event fallback before the first job run).
// SPEC-NOTE: the spec places Analytics as a tab of Results (/d/:id/results);
// per T19 ownership this page ships at its own route /d/:docId/analytics. The
// integrator can embed <AnalyticsTab> into the Results tabs once T16 lands.

import Link from "next/link";

import { DropOffPanel } from "./_components/DropOffPanel";
import { KpiCards } from "./_components/KpiCards";
import { TrendChart } from "./_components/TrendChart";
import { loadAnalyticsTabData } from "./_lib/load-summary";
import type { RangeSpec } from "../../../../../../../packages/core/src/analytics";

// Beacons/queries must never be cached at the page level.
export const dynamic = "force-dynamic";

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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Results</p>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Analytics</h1>
          <p className="mt-0.5 font-mono text-xs text-neutral-400 dark:text-neutral-500">{docId}</p>
        </div>
        <nav aria-label="Range" className="flex items-center gap-1 text-sm">
          <Link
            href={`/d/${docId}/analytics?range=7`}
            aria-current={spec.kind === "preset" && spec.preset === "7d" ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${
              spec.kind === "preset" && spec.preset === "7d"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            Last 7 days
          </Link>
          <Link
            href={`/d/${docId}/analytics?range=30`}
            aria-current={spec.kind === "preset" && spec.preset === "30d" ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${
              spec.kind === "preset" && spec.preset === "30d"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            Last 30 days
          </Link>
        </nav>
      </header>

      {data === null ? (
        <EmptyState
          title="Analytics unavailable"
          body="We couldn't load analytics right now. If this is a fresh environment, make sure DATABASE_URL is configured and the analytics tables exist."
        />
      ) : data.summary.kpis.views === 0 &&
        data.summary.kpis.starts === 0 &&
        data.summary.kpis.submissions === 0 ? (
        <EmptyState
          title="No responses yet — share your link"
          body="Once your document is live, views, starts and completions will appear here within minutes."
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
            <h2 id="trend-heading" className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Trend
            </h2>
            <TrendChart series={data.summary.series} />
          </section>
          <section aria-labelledby="dropoff-heading">
            <h2 id="dropoff-heading" className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Drop-off per question
            </h2>
            {data.dropOff === null ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                Drop-off is unavailable in this range.
              </p>
            ) : (
              <DropOffPanel enabled={data.dropOff.enabled} steps={data.dropOff.steps} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500 dark:text-neutral-400">{body}</p>
    </div>
  );
}
