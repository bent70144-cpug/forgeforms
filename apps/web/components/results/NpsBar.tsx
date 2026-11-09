// T15 — NPS segments bar (detractors / passives / promoters) per spec §14.1.5.
// Pure CSS stacking, no chart library. Meridian: a segmented 0–10 scale — each
// band (0–6 / 7–8 / 9–10) fills with its semantic -soft token and carries a
// strong 2px leading edge of the matching strong token, so the red/amber/green
// reading survives on both paper and night surfaces. The score is a plain ink
// mono value (no gradient); the ruler and legend counts are mono tabular-nums.

"use client";

import type { NpsAggregate } from "../../lib/results";

const SEGMENTS = [
  {
    key: "detractors",
    label: "Detractors",
    hint: "0–6",
    soft: "var(--ff-danger-soft)",
    strong: "var(--ff-danger)",
  },
  {
    key: "passives",
    label: "Passives",
    hint: "7–8",
    soft: "var(--ff-warning-soft)",
    strong: "var(--ff-warning)",
  },
  {
    key: "promoters",
    label: "Promoters",
    hint: "9–10",
    soft: "var(--ff-success-soft)",
    strong: "var(--ff-success)",
  },
] as const;

export function NpsBar({ aggregate }: { aggregate: NpsAggregate }) {
  const { totalResponses: total, detractors, passives, promoters, score } = aggregate;
  const width = (n: number): string => (total > 0 ? Math.max(2, (n / total) * 100) : 0) + "%";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-sm tabular-nums text-[var(--ff-muted)]">
          {total} {total === 1 ? "response" : "responses"}
        </p>
        <p className="text-sm text-[var(--ff-muted)]">
          <span className="font-mono text-3xl font-semibold leading-none tabular-nums text-[var(--ff-fg)]">
            {score}
          </span>{" "}
          NPS
        </p>
      </div>

      <div
        className="mt-4 flex h-3 w-full gap-px overflow-hidden rounded-full bg-[var(--ff-bg-2)]"
        role="img"
        aria-label={`NPS ${score}: ${detractors} detractors, ${passives} passives, ${promoters} promoters`}
      >
        {SEGMENTS.map((seg) => {
          const n =
            seg.key === "detractors" ? detractors : seg.key === "passives" ? passives : promoters;
          return (
            <span
              key={seg.key}
              className="h-full"
              style={{
                width: width(n),
                backgroundColor: seg.soft,
                // strong leading edge marks each band's start (empty bands stay blank)
                borderLeft: n > 0 ? `2px solid ${seg.strong}` : undefined,
              }}
            />
          );
        })}
      </div>

      {/* share ruler — decorative, mirrors the bar proportions */}
      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-[var(--ff-muted)]"
      >
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
        {SEGMENTS.map((seg) => {
          const n =
            seg.key === "detractors" ? detractors : seg.key === "passives" ? passives : promoters;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <li
              key={seg.key}
              className="-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-[var(--ff-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--ff-bg-2)_60%,transparent)]"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: seg.strong }}
              />
              <span className="font-medium text-[var(--ff-fg)]">{seg.label}</span>
              <span className="font-mono tabular-nums">
                {n} · {pct}%
              </span>
              <span>({seg.hint})</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
