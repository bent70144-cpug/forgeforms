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
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-sm text-neutral-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
        <p className="font-medium text-neutral-900 dark:text-neutral-100">Advanced analytics is a Pro feature.</p>
        <p className="mt-1">Upgrade your workspace to see per-question drop-off.</p>
      </div>
    );
  }
  if (steps.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        No per-question activity in this range yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {steps.map((step) => (
        <li key={step.blockId} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{step.blockId}</span>
            <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
              {formatInt(step.views)} views · {formatInt(step.passes)} passed
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
            role="meter"
            aria-valuenow={Math.round((1 - step.dropOffRate) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${step.blockId} pass rate ${formatPct(1 - step.dropOffRate)}`}
          >
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.round((1 - step.dropOffRate) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            {formatPct(step.dropOffRate)} drop-off
          </p>
        </li>
      ))}
    </ul>
  );
}
