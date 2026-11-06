// T19 — 30-day trend chart: PURE SVG (spec §14.1.5, issue #19: no chart lib).
// Server component; three series over the same UTC day axis.
// B6 redesign: token-driven series colors (--ff-chart-1/2/3, dark-mode safe),
// gradient wash under the primary series, non-scaling strokes, 12px mono axis
// labels with tabular numerals, canonical .ff-panel chrome with header legend.
// Geometry helpers (chart-geometry.ts) are untouched.
// R3 mobile: the svg carries .ff-trend-axis + data-alt on odd axis labels so
// globals.css can enlarge/thin labels on phones (viewBox scaling would
// otherwise render the 12px labels at ~5.5px on a 390px screen).
import {
  buildAreaPath,
  buildLinePath,
  formatInt,
  niceMax,
  scaleX,
  scaleY,
  shortDayLabel,
} from "../_lib/chart-geometry";

export interface TrendPoint {
  day: string;
  views: number;
  starts: number;
  completes: number;
}

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { left: 40, right: 12, top: 12, bottom: 28 } as const;

// Colors are CSS variable strings: inline styles keep them dark-mode reactive
// (var() is not supported inside SVG presentation attributes).
const SERIES = [
  { key: "views" as const, label: "Views", color: "var(--ff-chart-1)" },
  { key: "starts" as const, label: "Starts", color: "var(--ff-chart-2)" },
  { key: "completes" as const, label: "Completions", color: "var(--ff-chart-3)" },
];

const AXIS_TEXT_STYLE = {
  fill: "var(--ff-muted)",
  fontFamily: "var(--ff-font-mono)",
  fontVariantNumeric: "tabular-nums",
} as const;

export function TrendChart({ series }: { series: readonly TrendPoint[] }) {
  const max = niceMax(Math.max(1, ...series.map((point) => Math.max(point.views, point.starts, point.completes))));
  const baseline = scaleY(0, max, HEIGHT, PAD.top, PAD.bottom);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  return (
    <figure aria-label="Responses over time" className="ff-panel p-5">
      <figcaption className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold text-[var(--ff-fg)]">
          Responses over time
        </h2>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ff-muted)]">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-[3px]"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
          <span aria-hidden="true" className="text-[var(--ff-border-strong)]">
            ·
          </span>
          <span className="tabular-nums">peak {formatInt(max)}</span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Daily trend of views, starts and completions"
        className="ff-trend-axis h-auto w-full"
      >
        <defs>
          <linearGradient id="ff-trend-views-wash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--ff-chart-1)", stopOpacity: 0.14 }} />
            <stop offset="100%" style={{ stopColor: "var(--ff-chart-1)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {/* horizontal grid — dashed hairline on the token border color */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = scaleY(max * fraction, max, HEIGHT, PAD.top, PAD.bottom);
          return (
            <line
              key={fraction}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y}
              y2={y}
              strokeDasharray="2 4"
              style={{ stroke: "var(--ff-border)" }}
            />
          );
        })}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={baseline}
          y2={baseline}
          style={{ stroke: "var(--ff-border-strong)" }}
        />
        {series.map((point, i) => (
          <text
            key={point.day}
            x={scaleX(i, series.length, WIDTH, PAD.left, PAD.right)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize={12}
            data-alt={i % 2 === 1 ? "" : undefined}
            style={AXIS_TEXT_STYLE}
          >
            {i % labelEvery === 0 ? shortDayLabel(point.day) : ""}
          </text>
        ))}
        {SERIES.map((s) => {
          const points = series.map((point, i) => ({
            x: scaleX(i, series.length, WIDTH, PAD.left, PAD.right),
            y: scaleY(point[s.key], max, HEIGHT, PAD.top, PAD.bottom),
          }));
          return (
            <g key={s.key}>
              {s.key === "views" && points.length > 1 ? (
                <path d={buildAreaPath(points, baseline)} fill="url(#ff-trend-views-wash)" />
              ) : null}
              <path
                d={buildLinePath(points)}
                fill="none"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{ stroke: s.color }}
              />
              {points.map((point, i) => (
                <circle key={`${s.key}-${i}`} cx={point.x} cy={point.y} r="2" style={{ fill: s.color }}>
                  <title>{`${series[i]?.day ?? ""} — ${s.label}: ${formatInt(series[i]?.[s.key] ?? 0)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
