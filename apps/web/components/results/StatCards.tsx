// T15 — headline cards for the Summary tab: response count + completion rate
// (spec §14.1.5 / issue #15). Aurora glass: .ff-panel cards with a muted xs
// label, a big mono gradient value (background-clip text over --ff-grad where
// the number is the hero; plain token color otherwise), a muted hint and a
// share-of-total micro bar so each card reads at a glance. Presentation only —
// every number derives from the SummaryCounts the caller already passes.

"use client";

import { CARD } from "../../lib/ui";
import { formatPercent, type SummaryCounts } from "../../lib/results";

/** Gradient-text hero value vs. plain token value. */
type Tone = "grad" | "fg" | "warning" | "danger";

export function StatCards({ counts }: { counts: SummaryCounts }) {
  const share = (n: number): number =>
    Math.min(1, Math.max(0, counts.total > 0 ? n / counts.total : 0));

  const cards: Array<{ label: string; value: string; sub: string; share: number; tone: Tone }> = [
    {
      label: "Responses",
      value: String(counts.completed),
      sub: `${counts.total} total submissions`,
      share: share(counts.completed),
      tone: "grad",
    },
    {
      label: "Completion rate",
      value: formatPercent(counts.completionRate),
      sub: "completed ÷ all submissions",
      share: Math.min(1, Math.max(0, counts.completionRate / 100)),
      tone: "grad",
    },
    {
      label: "In progress",
      value: String(counts.draft),
      sub: "started but not finished",
      share: share(counts.draft),
      tone: "warning",
    },
    {
      label: "Spam",
      value: String(counts.spam),
      sub: "flagged automatically",
      share: share(counts.spam),
      tone: "danger",
    },
  ];

  const toneFill: Record<Tone, string> = {
    grad: "var(--ff-grad)",
    fg: "color-mix(in srgb, var(--ff-primary) 55%, transparent)",
    warning: "color-mix(in srgb, var(--ff-warning) 55%, transparent)",
    danger: "color-mix(in srgb, var(--ff-danger) 55%, transparent)",
  };

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`${CARD} overflow-hidden p-5`}>
          <p className="text-xs font-medium text-[var(--ff-muted)]">{card.label}</p>
          <p
            className={`mt-1.5 font-mono text-3xl font-semibold leading-none tabular-nums ${
              card.tone === "grad" ? "bg-clip-text text-transparent" : "text-[var(--ff-fg)]"
            }`}
            style={card.tone === "grad" ? { backgroundImage: "var(--ff-grad)" } : undefined}
          >
            {card.value}
          </p>
          <p className="mt-1.5 text-xs text-[var(--ff-muted)]">{card.sub}</p>
          <div
            aria-hidden="true"
            className="mt-3 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_7%,transparent)]"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.round(card.share * 100)}%`,
                background: toneFill[card.tone],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
