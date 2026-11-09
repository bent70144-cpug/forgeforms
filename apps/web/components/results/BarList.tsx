// T15 — dependency-free horizontal bar chart (pure CSS, spec §14.1.5 +
// issue #15: "charts as small dependency-free SVG components").
// Meridian: every bar is --ff-chart-1 (ultramarine) on a recessed --ff-bg-2
// track — 8px, fully rounded, no gradients, no glow — and hovering the row
// swaps the bar to --ff-chart-2 (terracotta) so scanning stays interactive.
// Value labels are mono tabular-nums, right-aligned.

"use client";

import { formatPercent } from "../../lib/results";

export interface BarItem {
  label: string;
  value: number;
  /** Pre-rendered value string (e.g. "12" or "12 (40%)"). */
  display?: string;
}

export function BarList({ items, ariaLabel }: { items: BarItem[]; ariaLabel: string }) {
  const max = items.reduce((m, item) => Math.max(m, item.value), 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  return (
    <ul className="-mx-2 space-y-0.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = max > 0 ? Math.round((item.value / max) * 100) : 0;
        const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <li
            key={item.label}
            className="group grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ff-bg-2)_60%,transparent)]"
          >
            <span className="truncate text-sm text-[var(--ff-fg)]" title={item.label}>
              {item.label}
            </span>
            <span
              aria-hidden="true"
              className="h-2 overflow-hidden rounded-full bg-[var(--ff-bg-2)]"
            >
              <span
                className="block h-full rounded-full bg-[var(--ff-chart-1)] transition-colors group-hover:bg-[var(--ff-chart-2)]"
                style={{ width: `${pct}%` }}
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
