// T15 — headline cards for the Summary tab: response count + completion rate
// (spec §14.1.5 / issue #15). Meridian: quiet white .ff-panel cards — an
// uppercase 11px muted label, the number as a 30px JetBrains ink value with
// tabular-nums (no gradient, no glow), a muted hint and a token-colored share
// micro bar on a recessed --ff-bg-2 track so each card reads at a glance.
// Presentation only — every number derives from the SummaryCounts the caller
// already passes.

"use client";

import { CARD } from "../../lib/ui";
import { formatPercent, type SummaryCounts } from "../../lib/results";

/** Semantic tint for the share micro bar; the value itself always stays ink. */
type Tone = "fg" | "warning" | "danger";

export function StatCards({ counts }: { counts: SummaryCounts }) {
  const share = (n: number): number =>
    Math.min(1, Math.max(0, counts.total > 0 ? n / counts.total : 0));

  const cards: Array<{ label: string; value: string; sub: string; share: number; tone: Tone }> = [
    {
      label: "Responses",
      value: String(counts.completed),
      sub: `${counts.total} total submissions`,
      share: share(counts.completed),
      tone: "fg",
    },
    {
      label: "Completion rate",
      value: formatPercent(counts.completionRate),
      sub: "completed ÷ all submissions",
      share: Math.min(1, Math.max(0, counts.completionRate / 100)),
      tone: "fg",
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
    fg: "var(--ff-primary)",
    warning: "var(--ff-warning)",
    danger: "var(--ff-danger)",
  };

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`${CARD} p-5`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--ff-muted)]">
            {card.label}
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold leading-none tabular-nums text-[var(--ff-fg)]">
            {card.value}
          </p>
          <p className="mt-1.5 text-xs text-[var(--ff-muted)]">{card.sub}</p>
          <div
            aria-hidden="true"
            className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--ff-bg-2)]"
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
