// T19 — per-question drop-off (spec §13: gated by
// can(workspaceId,'advanced_analytics'); §13 UI rule: show an upgrade prompt
// when the capability is missing — never inside editing surfaces).
// Aurora redesign: vertical funnel — each step is a full-width track whose
// fill width maps to retention, painted with --ff-grad at an alpha that
// descends step by step; per-step drop-off renders as danger/warning badge
// chips; step labels keep their mono counts. Meter aria attributes, pass-rate
// math, copy and all values unchanged.
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";

import { BADGE_DANGER, BADGE_MUTED, BADGE_WARNING } from "@/lib/ui";

import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface DropOffPanelProps {
  enabled: boolean;
  steps: ReadonlyArray<{ blockId: string; views: number; passes: number; dropOffRate: number }>;
}

// Numbers read in the design-system mono face with tabular figures.
const MONO = {
  fontFamily: "var(--ff-font-mono)",
  fontVariantNumeric: "tabular-nums",
} as const;

// Drop-off chip severity: a quarter or more of the step's viewers lost →
// danger, anything measurable → warning, none → muted. The pct text mirrors
// the meter's complement so the chip and the aria label never disagree.
function dropOffChip(dropOffRate: number): { className: string; text: string } {
  if (dropOffRate <= 0) return { className: BADGE_MUTED, text: "0%" };
  const text = `−${formatPct(dropOffRate)}`;
  return dropOffRate >= 0.25 ? { className: BADGE_DANGER, text } : { className: BADGE_WARNING, text };
}

export function DropOffPanel({ enabled, steps }: DropOffPanelProps) {
  return (
    <section aria-labelledby="dropoff-heading" className="ff-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="dropoff-heading" className="text-base font-semibold text-[var(--ff-fg)]">
            Drop-off
          </h2>
          <p className="mt-1 text-sm text-[var(--ff-muted)]">
            Where respondents leave the form, question by question.
          </p>
        </div>
        {/* decorative legend: gradient fill = retained, faint track = lost */}
        {enabled && steps.length > 0 ? (
          <span aria-hidden="true" className="flex items-center gap-3 text-xs text-[var(--ff-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-5 rounded-full" style={{ background: "var(--ff-grad)" }} />
              retained
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-5 rounded-full"
                style={{
                  background: "color-mix(in srgb, var(--ff-fg) 6%, transparent)",
                  boxShadow: "inset 0 0 0 1px var(--ff-glass-border)",
                }}
              />
              lost
            </span>
          </span>
        ) : null}
      </div>
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
          <ol className="space-y-5">
            {steps.map((step, index) => {
              const passRate = Math.round((1 - step.dropOffRate) * 100);
              // Descending aurora: the first step's fill runs at full strength
              // and each deeper step fades toward 30% alpha (single step → 1).
              const alpha =
                steps.length > 1 ? Math.max(0.3, 1 - index * (0.7 / (steps.length - 1))) : 1;
              const chip = dropOffChip(step.dropOffRate);
              return (
                <li key={step.blockId}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        aria-hidden="true"
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] text-[var(--ff-fg)]"
                        style={{
                          ...MONO,
                          background: "color-mix(in srgb, var(--ff-primary) 16%, transparent)",
                        }}
                      >
                        {index + 1}
                      </span>
                      <code
                        className="rounded-md px-1.5 py-0.5 text-xs text-[var(--ff-fg)]"
                        style={{ ...MONO, background: "color-mix(in srgb, var(--ff-fg) 6%, transparent)" }}
                      >
                        {step.blockId}
                      </code>
                      <span className="text-xs text-[var(--ff-muted)]" style={MONO}>
                        {formatInt(step.views)} views · {formatInt(step.passes)} passed
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={chip.className} title={`${formatPct(step.dropOffRate)} drop-off at this step`}>
                        {chip.text}
                        <span className="sr-only"> drop-off at this step</span>
                      </span>
                      <span
                        title="Pass rate"
                        className="text-sm font-medium text-[var(--ff-fg)]"
                        style={MONO}
                      >
                        {formatPct(1 - step.dropOffRate)}
                      </span>
                    </div>
                  </div>
                  {/* funnel bar: full-width track, fill width = retention */}
                  <div
                    role="meter"
                    aria-valuenow={passRate}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${step.blockId} pass rate ${formatPct(1 - step.dropOffRate)}`}
                    className="mt-2 h-8 overflow-hidden rounded-lg"
                    style={{
                      background: "color-mix(in srgb, var(--ff-fg) 4%, transparent)",
                      boxShadow: "inset 0 0 0 1px var(--ff-glass-border)",
                    }}
                  >
                    <div
                      className="h-full rounded-lg"
                      style={{ width: `${passRate}%`, background: "var(--ff-grad)", opacity: alpha }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
