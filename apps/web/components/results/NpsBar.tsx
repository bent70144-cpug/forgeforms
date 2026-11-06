// T15 — NPS segments bar (detractors / passives / promoters) per spec §14.1.5.
// Pure CSS stacking, no chart library. B5: segment hues come from the semantic
// tokens (--ff-danger/--ff-warning/--ff-success) so dark mode needs no variants.

"use client";

import type { NpsAggregate } from "../../lib/results";

const SEGMENTS = [
  {
    key: "detractors",
    label: "Detractors",
    hint: "0–6",
    color: "var(--ff-danger)",
  },
  {
    key: "passives",
    label: "Passives",
    hint: "7–8",
    color: "var(--ff-warning)",
  },
  {
    key: "promoters",
    label: "Promoters",
    hint: "9–10",
    color: "var(--ff-success)",
  },
] as const;

export function NpsBar({ aggregate }: { aggregate: NpsAggregate }) {
  const { totalResponses: total, detractors, passives, promoters, score } = aggregate;
  const width = (n: number): string => (total > 0 ? Math.max(2, (n / total) * 100) : 0) + "%";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm tabular-nums text-[var(--ff-muted)]">
          {total} {total === 1 ? "response" : "responses"}
        </p>
        <p className="text-sm text-[var(--ff-fg)]">
          <span className="text-2xl font-semibold tabular-nums text-[var(--ff-fg)]">{score}</span>{" "}
          NPS
        </p>
      </div>

      <div
        className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_6%,transparent)]"
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
              style={{ width: width(n), backgroundColor: seg.color }}
            />
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
        {SEGMENTS.map((seg) => {
          const n =
            seg.key === "detractors" ? detractors : seg.key === "passives" ? passives : promoters;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <li key={seg.key} className="flex items-center gap-1.5 text-xs text-[var(--ff-muted)]">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span className="font-medium text-[var(--ff-fg)]">{seg.label}</span>
              <span className="tabular-nums">
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
