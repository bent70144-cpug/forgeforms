// T19 — KPI cards for the Analytics tab (spec §14.1.5: views, starts,
// completes, completion rate, uniques). Server component, Tailwind only.
// Meridian redesign: quiet paper stat tiles — plain white .ff-panel cards,
// ink mono numerals with tabular figures, muted uppercase labels. Numbers,
// labels and hints unchanged.
import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface KpiCardsProps {
  views: number;
  uniques: number;
  starts: number;
  submissions: number;
  completionRate: number;
}

// Ink mono numerals. Inline styles keep the mono stack and tabular figures
// reactive to the active (dark/light) scheme.
const VALUE_STYLE = {
  fontFamily: "var(--ff-font-mono)",
  fontVariantNumeric: "tabular-nums",
  color: "var(--ff-fg)",
} as const;

export function KpiCards({ views, uniques, starts, submissions, completionRate }: KpiCardsProps) {
  const cards: Array<{ label: string; value: string; hint: string }> = [
    { label: "Views", value: formatInt(views), hint: "page opens" },
    { label: "Uniques", value: formatInt(uniques), hint: "anonymous visitors" },
    { label: "Starts", value: formatInt(starts), hint: "began answering" },
    { label: "Submissions", value: formatInt(submissions), hint: "completed" },
    { label: "Completion rate", value: formatPct(completionRate), hint: "submissions / starts" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="ff-panel p-4 sm:p-5">
          <dt
            title={card.label}
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ff-muted)]"
          >
            {card.label}
          </dt>
          <dd className="mt-2 text-[26px] font-semibold leading-none" style={VALUE_STYLE}>
            {card.value}
          </dd>
          <p className="mt-1.5 text-xs text-[var(--ff-muted)]">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
