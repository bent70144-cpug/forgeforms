// T19 — KPI cards for the Analytics tab (spec §14.1.5: views, starts,
// completes, completion rate, uniques). Server component, Tailwind only.
// B6 redesign: canonical .ff-panel cards, 12px muted labels, tabular-nums
// values. Numbers and labels unchanged.
import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface KpiCardsProps {
  views: number;
  uniques: number;
  starts: number;
  submissions: number;
  completionRate: number;
}

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
          <dt title={card.label} className="text-xs font-medium text-[var(--ff-muted)]">
            {card.label}
          </dt>
          <dd className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--ff-fg)]">
            {card.value}
          </dd>
          <p className="mt-0.5 text-xs text-[var(--ff-muted)]">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
