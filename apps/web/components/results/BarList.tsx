// T15 — dependency-free horizontal bar chart (pure CSS, spec §14.1.5 +
// issue #15: "charts as small dependency-free SVG components").
// Aurora: the top-ranked bar gets the full --ff-grad violet→cyan fill (plus a
// faint glow); the rest step down in alpha so the eye lands on the leader.
// Values are muted mono, rows carry a quiet violet hover wash.

"use client";

import { formatPercent } from "../../lib/results";

export interface BarItem {
  label: string;
  value: number;
  /** Pre-rendered value string (e.g. "12" or "12 (40%)"). */
  display?: string;
}

/**
 * Fill for a bar by rank: rank 0 = full aurora gradient, the rest fade
 * stepwise (floored at 30% alpha) so ranking stays readable without shouting.
 */
function fillFor(rank: number): string {
  const alpha = rank === 0 ? 1 : Math.max(0.3, 0.62 - (rank - 1) * 0.16);
  const pct = Math.round(alpha * 100);
  return `linear-gradient(135deg, color-mix(in srgb, var(--ff-primary) ${pct}%, transparent), color-mix(in srgb, var(--ff-primary-2) ${pct}%, transparent))`;
}

export function BarList({ items, ariaLabel }: { items: BarItem[]; ariaLabel: string }) {
  const max = items.reduce((m, item) => Math.max(m, item.value), 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  // Rank by value (descending) so the hero gradient lands on the top segment
  // even when the caller passes rows unsorted. Ties share a tier.
  const rankOfIndex = new Map<number, number>();
  items
    .map((item, index) => ({ index, value: item.value }))
    .sort((a, b) => b.value - a.value)
    .forEach((entry, position) => {
      if (!rankOfIndex.has(entry.index)) rankOfIndex.set(entry.index, position);
    });

  return (
    <ul className="-mx-2 space-y-0.5" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const pct = max > 0 ? Math.round((item.value / max) * 100) : 0;
        const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const rank = rankOfIndex.get(index) ?? index;
        return (
          <li
            key={item.label}
            className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ff-primary)_7%,transparent)]"
          >
            <span className="truncate text-sm text-[var(--ff-fg)]" title={item.label}>
              {item.label}
            </span>
            <span
              aria-hidden="true"
              className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-primary)_10%,transparent)]"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: fillFor(rank),
                  boxShadow:
                    rank === 0 && pct > 0
                      ? "0 0 10px -2px color-mix(in srgb, var(--ff-primary) 55%, transparent)"
                      : undefined,
                }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-[var(--ff-muted)]">
              {item.display ?? (share > 0 ? `${item.value} (${formatPercent(share)})` : "0")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
