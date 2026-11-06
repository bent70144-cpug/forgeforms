// T19 — per-question drop-off (spec §13: gated by
// can(workspaceId,'advanced_analytics'); §13 UI rule: show an upgrade prompt
// when the capability is missing — never inside editing surfaces).
import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface DropOffPanelProps {
  enabled: boolean;
  steps: ReadonlyArray<{ blockId: string; views: number; passes: number; dropOffRate: number }>;
}

export function DropOffPanel({ enabled, steps }: DropOffPanelProps) {
  if (!enabled) {
    return (
      <div className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-6 text-sm text-[var(--ff-muted)]">
        <p className="font-medium text-[var(--ff-fg)]">Advanced analytics is a Pro feature.</p>
        <p className="mt-1">Upgrade your workspace to see per-question drop-off.</p>
      </div>
    );
  }
  if (steps.length === 0) {
    return (
      <p className="rounded-[var(--ff-radius)] border border-dashed border-[var(--ff-border)] p-6 text-sm text-[var(--ff-muted)]">
        No per-question activity in this range yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {steps.map((step) => (
        <li
          key={step.blockId}
          className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-card)] p-4"
        >
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium text-[var(--ff-fg)]">{step.blockId}</span>
            <span className="tabular-nums text-[var(--ff-muted)]">
              {formatInt(step.views)} views · {formatInt(step.passes)} passed
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)]"
            role="meter"
            aria-valuenow={Math.round((1 - step.dropOffRate) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${step.blockId} pass rate ${formatPct(1 - step.dropOffRate)}`}
          >
            <div
              className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
              style={{ width: `${Math.round((1 - step.dropOffRate) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs tabular-nums text-[var(--ff-muted)]">
            {formatPct(step.dropOffRate)} drop-off
          </p>
        </li>
      ))}
    </ul>
  );
}
