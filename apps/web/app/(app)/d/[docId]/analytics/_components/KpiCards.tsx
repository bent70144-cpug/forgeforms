// T19 — KPI cards for the Analytics tab (spec §14.1.5: views, starts,
// completes, completion rate, uniques). Server component, Tailwind only.
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
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4"
        >
          <dt className="text-sm font-medium text-[var(--ff-muted)]">{card.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ff-fg)]">
            {card.value}
          </dd>
          <p className="mt-0.5 text-xs text-[var(--ff-muted)]">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
