// T15 — headline cards for the Summary tab: response count + completion rate
// (spec §14.1.5 / issue #15). B5: canonical .ff-panel cards, xs label /
// 2xl tabular value / xs hint.

"use client";

import { CARD } from "../../lib/ui";
import { formatPercent, type SummaryCounts } from "../../lib/results";

export function StatCards({ counts }: { counts: SummaryCounts }) {
  const cards = [
    {
      label: "Responses",
      value: String(counts.completed),
      sub: `${counts.total} total submissions`,
    },
    {
      label: "Completion rate",
      value: formatPercent(counts.completionRate),
      sub: "completed ÷ all submissions",
    },
    {
      label: "In progress",
      value: String(counts.draft),
      sub: "started but not finished",
    },
    {
      label: "Spam",
      value: String(counts.spam),
      sub: "flagged automatically",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`${CARD} p-5`}>
          <p className="text-xs font-medium text-[var(--ff-muted)]">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--ff-fg)]">{card.value}</p>
          <p className="mt-0.5 text-xs text-[var(--ff-muted)]">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
