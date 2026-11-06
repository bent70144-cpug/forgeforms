// T19 — 30-day trend chart: PURE SVG (spec §14.1.5, issue #19: no chart lib).
// Server component; three series over the same UTC day axis.
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

const SERIES = [
  { key: "views" as const, label: "Views", color: "#6366f1" },
  { key: "starts" as const, label: "Starts", color: "#f59e0b" },
  { key: "completes" as const, label: "Completions", color: "#10b981" },
];

export function TrendChart({ series }: { series: readonly TrendPoint[] }) {
  const max = niceMax(Math.max(1, ...series.map((point) => Math.max(point.views, point.starts, point.completes))));
  const baseline = scaleY(0, max, HEIGHT, PAD.top, PAD.bottom);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  return (
    <figure className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto tabular-nums">peak {formatInt(max)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Daily trend of views, starts and completions"
        className="h-auto w-full"
      >
        {/* horizontal grid */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = scaleY(max * fraction, max, HEIGHT, PAD.top, PAD.bottom);
          return (
            <line
              key={fraction}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeWidth={fraction === 1 ? 1 : 0.5}
              className="text-neutral-200 dark:text-neutral-800"
            />
          );
        })}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          strokeWidth="1"
          className="text-neutral-300 dark:text-neutral-700"
        />
        {series.map((point, i) => (
          <text
            key={point.day}
            x={scaleX(i, series.length, WIDTH, PAD.left, PAD.right)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize="10"
            className="fill-neutral-400 dark:fill-neutral-500"
          >
            {i % labelEvery === 0 ? shortDayLabel(point.day) : ""}
          </text>
        ))}
        {SERIES.map((s) => {
          const points = series.map((point, i) => ({
            x: scaleX(i, series.length, WIDTH, PAD.left, PAD.right),
            y: scaleY(point[s.key], max, HEIGHT, PAD.top, PAD.bottom),
          }));
          const color = s.color;
          return (
            <g key={s.key}>
              {points.length > 1 ? (
                <path d={buildAreaPath(points, baseline)} fill={color} fillOpacity={0.08} />
              ) : null}
              <path
                d={buildLinePath(points)}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point, i) => (
                <circle key={`${s.key}-${i}`} cx={point.x} cy={point.y} r="2" fill={color}>
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
