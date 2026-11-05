// T19 — pure SVG chart geometry for the Analytics tab (spec §14.1.5: charts
// are hand-rolled SVG, no chart library). Pure math only — unit-testable.

export interface XY {
  x: number;
  y: number;
}

/** Round a value up to a "nice" axis maximum (1/2/2.5/5 × 10^k). */
export function niceMax(value: number): number {
  const safe = Math.max(1, Math.ceil(value));
  if (safe <= 5) return 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(safe)));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    const candidate = multiple * magnitude;
    if (candidate >= safe) return candidate;
  }
  return 10 * magnitude;
}

/** X for the i-th of `count` points across the plot area (single point → centered). */
export function scaleX(index: number, count: number, width: number, padLeft: number, padRight: number): number {
  const usable = width - padLeft - padRight;
  if (count <= 1) return padLeft + usable / 2;
  return padLeft + (index / (count - 1)) * usable;
}

/** Y for `value` against a 0..max axis (max 0 or negative → baseline). */
export function scaleY(value: number, max: number, height: number, padTop: number, padBottom: number): number {
  const usable = height - padTop - padBottom;
  const baseline = height - padBottom;
  if (max <= 0) return baseline;
  const clamped = Math.min(Math.max(value, 0), max);
  return padTop + (1 - clamped / max) * usable;
}

/** SVG path for a polyline; empty/single-safe (single point → "M x y"). */
export function buildLinePath(points: readonly XY[]): string {
  if (points.length === 0) return "";
  return points
    .map((point, i) => `${i === 0 ? "M" : "L"}${round2(point.x)} ${round2(point.y)}`)
    .join(" ");
}

/** Closed area path under the line down to `baselineY`. */
export function buildAreaPath(points: readonly XY[], baselineY: number): string {
  if (points.length === 0) return "";
  const line = buildLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  if (points.length === 1) {
    return `${line} L${round2(first.x)} ${round2(baselineY)} Z`;
  }
  return `${line} L${round2(last.x)} ${round2(baselineY)} L${round2(first.x)} ${round2(baselineY)} Z`;
}

/** `12483` → "12,483". */
export function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** 0.75 → "75%", 0.3333 → "33.3%", 0 → "0%". */
export function formatPct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

/** "2026-11-06" → "11-06" (UTC day keys, axis labels). */
export function shortDayLabel(dayKey: string): string {
  return dayKey.length >= 10 ? dayKey.slice(5, 10) : dayKey;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
