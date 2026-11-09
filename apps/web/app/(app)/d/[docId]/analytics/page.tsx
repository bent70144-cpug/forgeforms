// T19 — Analytics tab (spec §14.1.5: views, starts, completes, completion rate,
// 30-day trend; issue #19: KPIs + trend render from analytics_daily rollups
// with a raw-event fallback before the first job run).
// SPEC-NOTE: the spec places Analytics as a tab of Results (/d/:id/results);
// per T19 ownership this page ships at its own route /d/:docId/analytics. The
// integrator can embed <AnalyticsTab> into the Results tabs once T16 lands.
// B6 redesign: shell-aligned container, segmented range control, shared
// EmptyState primitives, self-titled panels (trend + drop-off carry their own
// headers). Data loading and range logic unchanged.
// Meridian redesign: quiet analytics on paper — Sora heading with muted
// subtitle, range .ff-seg pinned in a sticky paper toolbar just under the app
// shell header so it stays above the fold, white KPI panels and the funnel
// drop-off panel below. Queries, range state and copy unchanged.

import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { BTN_GHOST_SM, BTN_SECONDARY_SM, SEG, SEG_BTN } from "@/lib/ui";

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

// Visual "pressed" state for the active range link. .ff-seg-btn has no
// aria-current recipe in globals.css, and unlayered recipes beat Tailwind
// utilities, so the active look is applied as inline styles.
const RANGE_ACTIVE_STYLE = {
  background: "var(--ff-card)",
  color: "var(--ff-fg)",
  fontWeight: 500,
  boxShadow: "var(--ff-shadow-sm)",
} as const;

// Sticky range toolbar: a paper strip pinned just under the app shell header
// (3.75rem tall, z-40) so the range control rides above the fold while the
// funnel scrolls beneath it. --ff-glass is the design system's sticky-chrome
// token (near-opaque paper); no backdrop blur — Meridian keeps chrome crisp.
// Inline styles because unlayered recipes beat Tailwind utilities.
const RANGE_BAR_STYLE = {
  background: "var(--ff-glass)",
  border: "1px solid var(--ff-glass-border)",
  borderRadius: "var(--ff-radius)",
  boxShadow: "var(--ff-shadow-sm)",
} as const;

// Sora display heading, tightened to the Meridian editorial scale.
const HEADING_STYLE = {
  fontFamily: "var(--ff-font-heading)",
  fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
  letterSpacing: "-0.02em",
  fontWeight: 600,
} as const;

const MONO_STYLE = {
  fontFamily: "var(--ff-font-mono)",
} as const;

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { docId } = await params;
  const { range } = await searchParams;
  const spec = toRangeSpec(range);
  const data = await loadAnalyticsTabData(docId, spec);
  const is7d = spec.kind === "preset" && spec.preset === "7d";

  return (
    <div className="space-y-6">
      <header className="min-w-0">
        <Link href={`/d/${docId}/results`} className={`${BTN_GHOST_SM} -ml-2`}>
          <Icon name="arrowLeft" size={14} />
          Results
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[var(--ff-fg)]" style={HEADING_STYLE}>
            Analytics
          </h1>
          {/* INTEGRATION-DEBT: the document title lives behind the client-side
              results client; until the analytics loader returns it, show the
              docId as the muted secondary identifier. */}
          <span title={docId} className="min-w-0 truncate text-sm text-[var(--ff-muted)]" style={MONO_STYLE}>
            {docId}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-[var(--ff-muted)]">
          Views, starts, completions and per-question drop-off for the selected range.
        </p>
      </header>

      <div className="sticky top-[3.75rem] z-30 flex justify-end px-2 py-1.5" style={RANGE_BAR_STYLE}>
        <nav aria-label="Range" className={SEG}>
          <Link
            href={`/d/${docId}/analytics?range=7`}
            aria-current={is7d ? "page" : undefined}
            style={is7d ? RANGE_ACTIVE_STYLE : undefined}
            className={SEG_BTN}
          >
            7 days
          </Link>
          <Link
            href={`/d/${docId}/analytics?range=30`}
            aria-current={!is7d ? "page" : undefined}
            style={is7d ? undefined : RANGE_ACTIVE_STYLE}
            className={SEG_BTN}
          >
            30 days
          </Link>
        </nav>
      </div>

      {data === null ? (
        <EmptyState
          icon={<Icon name="alert" size={20} />}
          title="Analytics couldn’t load"
          description="Something went wrong loading analytics. Try again in a moment."
          action={
            <Link
              href={`/d/${docId}/analytics?range=${is7d ? "7" : "30"}`}
              className={BTN_SECONDARY_SM}
            >
              <Icon name="refresh" size={14} />
              Try again
            </Link>
          }
        />
      ) : data.summary.kpis.views === 0 &&
        data.summary.kpis.starts === 0 &&
        data.summary.kpis.submissions === 0 ? (
        <EmptyState
          icon={<Icon name="inbox" size={20} />}
          title="No responses yet"
          description="Analytics appear here once your form starts collecting responses. Want the raw answers?"
          action={
            <Link href={`/d/${docId}/results`} className={BTN_SECONDARY_SM}>
              Open the Results tab
            </Link>
          }
        />
      ) : (
        <>
          <KpiCards
            views={data.summary.kpis.views}
            uniques={data.summary.kpis.uniques}
            starts={data.summary.kpis.starts}
            submissions={data.summary.kpis.submissions}
            completionRate={data.summary.kpis.completionRate}
          />
          <TrendChart series={data.summary.series} />
          {data.dropOff === null ? (
            <EmptyState
              compact
              icon={<Icon name="chart" size={18} />}
              title="Drop-off is unavailable in this range."
            />
          ) : (
            <DropOffPanel enabled={data.dropOff.enabled} steps={data.dropOff.steps} />
          )}
        </>
      )}
    </div>
  );
}
