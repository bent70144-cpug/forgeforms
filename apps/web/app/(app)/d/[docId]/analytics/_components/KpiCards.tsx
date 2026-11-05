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
          className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {card.label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
            {card.value}
          </dd>
          <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
