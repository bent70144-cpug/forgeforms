// T19 — KPI cards for the Analytics tab (spec §14.1.5: views, starts,
// completes, completion rate, uniques). Server component, Tailwind only.
// Aurora redesign: glass stat tiles — frosted --ff-glass chrome over the
// ff-panel hairline, mono gradient values (--ff-grad clipped to the glyphs,
// tabular numerals) and muted uppercase labels with an aurora tick along the
// top edge. Numbers, labels and hints unchanged.
import { formatInt, formatPct } from "../_lib/chart-geometry";

export interface KpiCardsProps {
  views: number;
  uniques: number;
  starts: number;
  submissions: number;
  completionRate: number;
}

// Mono gradient numerals. Inline styles keep the mono stack, tabular figures
// and the gradient text-clip reactive to the active (dark/light) scheme —
// var() inside Tailwind arbitrary values would work, but clip-path text needs
// the -webkit prefix inline anyway.
const VALUE_STYLE = {
  fontFamily: "var(--ff-font-mono)",
  fontVariantNumeric: "tabular-nums",
  backgroundImage: "var(--ff-grad)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
} as const;

// Frosted stat tile: ff-panel supplies radius + glass hairline + shadow; the
// inline background swaps the solid card fill for the translucent glass token
// with a soft backdrop blur.
const TILE_STYLE = {
  background: "var(--ff-glass)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
} as const;

export function KpiCards({ views, uniques, starts, submissions, completionRate }: KpiCardsProps) {
  const cards: Array<{ label: string; value: string; hint: string }> = [
    { label: "Views", value: formatInt(views), hint: "page opens" },
    { label: "Uniques", value: formatInt(uniques), hint: "anonymous visitors" },
    { label: "Starts", value: formatInt(starts), hint: "began answering" },
    { label: "Submissions", value: formatInt(submissions), hint: "completed" },
    { label: "Completion rate", value: formatPct(completionRate), hint: "submissions / starts" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="ff-panel relative overflow-hidden p-4 sm:p-5" style={TILE_STYLE}>
          {/* aurora tick — gradient hairline along the tile's top edge */}
          <span
            aria-hidden="true"
            className="absolute inset-x-4 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--ff-primary) 35%, var(--ff-primary-2) 65%, transparent)",
              opacity: 0.55,
            }}
          />
          <dt
            title={card.label}
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ff-muted)]"
          >
            {card.label}
          </dt>
          <dd className="mt-2 text-2xl font-semibold leading-none" style={VALUE_STYLE}>
            {card.value}
          </dd>
          <p className="mt-1.5 text-xs text-[var(--ff-muted)]">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
