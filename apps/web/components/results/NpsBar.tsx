// T15 — NPS segments bar (detractors / passives / promoters) per spec §14.1.5.
// Pure CSS stacking, no chart library.

"use client";

import type { NpsAggregate } from "../../lib/results";

// Semantic segment hues (detractor / passive / promoter) — mid-tones that hold
// up on both light and dark token surfaces.
const SEGMENTS = [
  {
    key: "detractors",
    label: "Detractors",
    hint: "0–6",
    bar: "bg-rose-500 dark:bg-rose-400",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
  {
    key: "passives",
    label: "Passives",
    hint: "7–8",
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  {
    key: "promoters",
    label: "Promoters",
    hint: "9–10",
    bar: "bg-emerald-500 dark:bg-emerald-400",
    dot: "bg-emerald-500 dark:bg-emerald-400",
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
        className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ff-fg)_8%,transparent)]"
        role="img"
        aria-label={`NPS ${score}: ${detractors} detractors, ${passives} passives, ${promoters} promoters`}
      >
        <span className={`h-full ${SEGMENTS[0]!.bar}`} style={{ width: width(detractors) }} />
        <span className={`h-full ${SEGMENTS[1]!.bar}`} style={{ width: width(passives) }} />
        <span className={`h-full ${SEGMENTS[2]!.bar}`} style={{ width: width(promoters) }} />
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
        {SEGMENTS.map((seg) => {
          const n =
            seg.key === "detractors" ? detractors : seg.key === "passives" ? passives : promoters;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <li key={seg.key} className="flex items-center gap-1.5 text-sm text-[var(--ff-muted)]">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${seg.dot}`} aria-hidden="true" />
              <span className="font-medium text-[var(--ff-fg)]">{seg.label}</span>
              <span className="tabular-nums">
                {n} · {pct}%
              </span>
              <span className="text-xs text-[var(--ff-muted)]">({seg.hint})</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
