// T19 — per-question drop-off (spec §13: gated by
// can(workspaceId,'advanced_analytics'); §13 UI rule: show an upgrade prompt
// when the capability is missing — never inside editing surfaces).
// B6 redesign: self-titled .ff-panel, accent-washed pro-gate card, compact
// shared EmptyState, numbered meter rows with mono blockId chips and token
// success bars. Meter aria attributes and all copy unchanged.
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";

import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface DropOffPanelProps {
  enabled: boolean;
  steps: ReadonlyArray<{ blockId: string; views: number; passes: number; dropOffRate: number }>;
}

export function DropOffPanel({ enabled, steps }: DropOffPanelProps) {
  return (
    <section aria-labelledby="dropoff-heading" className="ff-panel p-5">
      <h2 id="dropoff-heading" className="text-base font-semibold text-[var(--ff-fg)]">
        Drop-off
      </h2>
      <p className="mt-1 text-sm text-[var(--ff-muted)]">
        Where respondents leave the form, question by question.
      </p>
      <div className="mt-4">
        {!enabled ? (
          <div
            className="rounded-xl border p-5"
            style={{
              background: "color-mix(in srgb, var(--ff-accent) 6%, var(--ff-card))",
              borderColor: "color-mix(in srgb, var(--ff-accent) 25%, var(--ff-border))",
            }}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[var(--ff-accent)]"
                style={{ background: "color-mix(in srgb, var(--ff-accent) 12%, var(--ff-card))" }}
              >
                <Icon name="sparkles" size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ff-fg)]">
                  Advanced analytics is a Pro feature.
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
                  Upgrade your workspace to see per-question drop-off.
                </p>
              </div>
            </div>
          </div>
        ) : steps.length === 0 ? (
          <EmptyState
            compact
            icon={<Icon name="inbox" size={18} />}
            title="No per-question activity in this range yet."
          />
        ) : (
          <ol className="space-y-3">
            {steps.map((step, index) => {
              const passRate = Math.round((1 - step.dropOffRate) * 100);
              return (
                <li
                  key={step.blockId}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3"
                  style={{
                    background: "color-mix(in srgb, var(--ff-fg) 2%, var(--ff-bg))",
                    borderColor: "var(--ff-border)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-6 w-6 place-items-center rounded-full font-mono text-xs text-[var(--ff-fg)]"
                    style={{ background: "color-mix(in srgb, var(--ff-accent) 12%, var(--ff-card))" }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <code
                        className="rounded-md px-1.5 py-0.5 font-mono text-xs text-[var(--ff-fg)]"
                        style={{ background: "color-mix(in srgb, var(--ff-fg) 5%, transparent)" }}
                      >
                        {step.blockId}
                      </code>
                      <span className="text-xs tabular-nums text-[var(--ff-muted)]">
                        {formatInt(step.views)} views · {formatInt(step.passes)} passed
                      </span>
                    </div>
                    <div
                      role="meter"
                      aria-valuenow={passRate}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${step.blockId} pass rate ${formatPct(1 - step.dropOffRate)}`}
                      className="mt-2 h-2 overflow-hidden rounded-full"
                      style={{ background: "color-mix(in srgb, var(--ff-fg) 6%, transparent)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${passRate}%`, background: "var(--ff-success)" }}
                      />
                    </div>
                  </div>
                  <span title="Pass rate" className="text-sm font-medium tabular-nums text-[var(--ff-fg)]">
                    {formatPct(1 - step.dropOffRate)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
