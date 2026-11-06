// T15 — dependency-free horizontal bar chart (pure CSS, spec §14.1.5 +
// issue #15: "charts as small dependency-free SVG components").
// B5: label / h-2 track / xs tabular value grid; fill uses --ff-chart-1.

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
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = max > 0 ? Math.round((item.value / max) * 100) : 0;
        const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <li key={item.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-sm text-[var(--ff-fg)]" title={item.label}>
              {item.label}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]">
              <span
                className="block h-full rounded-full bg-[var(--ff-chart-1)]"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-right text-xs tabular-nums text-[var(--ff-muted)]">
              {item.display ?? (share > 0 ? `${item.value} (${formatPercent(share)})` : "0")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
