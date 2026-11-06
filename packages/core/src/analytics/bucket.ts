// @formforge/core — analytics aggregation, PURE functions (spec §12, §14.1.5).
// Daily buckets are UTC (spec §4: all timestamps are UTC timestamptz; no DST
// because UTC has no offsets). No I/O here — services feed events in.

import { AppError } from "../bridge";
import type {
  AnalyticsKpis,
  AnalyticsRange,
  DailyPoint,
  DayCounts,
  DropOffStep,
  RangeSpec,
  RawAnalyticsEvent,
} from "./types";

const MS_PER_DAY = 86_400_000;
const DAY_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Largest custom range we will aggregate in one pass (days). */
export const MAX_CUSTOM_RANGE_DAYS = 366;

/** Floor a timestamp to the start of its UTC day. */
export function startOfUtcDay(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
}

/** Add calendar days in UTC (DST-free by construction). */
export function addUtcDays(ts: Date, days: number): Date {
  return new Date(ts.getTime() + days * MS_PER_DAY);
}

/** `YYYY-MM-DD` UTC day key (ISO date part of the instant). */
export function utcDayKey(ts: Date): string {
  return ts.toISOString().slice(0, 10);
}

/** Parse `YYYY-MM-DD` into the UTC midnight instant. Throws VALIDATION. */
export function dayKeyToDate(day: string): Date {
  if (!DAY_KEY_RE.test(day)) {
    throw new AppError("VALIDATION", `Invalid day key: ${JSON.stringify(day)} (expected YYYY-MM-DD)`);
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, date));
}

/**
 * Resolve a `RangeSpec` against `now` into a half-open `[from, to)` UTC range.
 * Presets include today: `7d` covers the last 7 UTC calendar days.
 * Custom `fromDay`/`toDay` are inclusive day keys (`to` becomes midnight after).
 */
export function resolveRange(spec: RangeSpec, now: Date): AnalyticsRange {
  if (spec.kind === "preset") {
    const days = spec.preset === "7d" ? 7 : 30;
    const todayStart = startOfUtcDay(now);
    return { from: addUtcDays(todayStart, -(days - 1)), to: addUtcDays(todayStart, 1) };
  }
  const from = dayKeyToDate(spec.fromDay);
  const to = addUtcDays(dayKeyToDate(spec.toDay), 1);
  if (from.getTime() > to.getTime()) {
    throw new AppError("VALIDATION", "Custom range: fromDay must be on or before toDay");
  }
  if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_CUSTOM_RANGE_DAYS) {
    throw new AppError("VALIDATION", `Custom range exceeds ${MAX_CUSTOM_RANGE_DAYS} days`);
  }
  return { from, to };
}

/** All UTC day keys covered by the half-open range `[from, to)`. */
export function daysInRange(range: AnalyticsRange): string[] {
  const keys: string[] = [];
  for (let ts = startOfUtcDay(range.from); ts.getTime() < range.to.getTime(); ts = addUtcDays(ts, 1)) {
    keys.push(utcDayKey(ts));
  }
  return keys;
}

/** Round to 4 decimal places — stable math for rates across re-runs. */
export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** completes / starts; 0 when there are no starts (avoids NaN/Infinity). */
export function completionRate(starts: number, completes: number): number {
  return starts > 0 ? round4(completes / starts) : 0;
}

function emptyAccumulator(): DayCounts & { sessions: Set<string> } {
  return { views: 0, starts: 0, completes: 0, uniques: 0, questionViews: 0, questionPasses: 0, sessions: new Set() };
}

/**
 * Bucket raw events into UTC day counts. Uniques are the distinct
 * `sessionHash` values per day (the anonymous visitor id, spec §12).
 */
export function bucketEventsByDay(events: readonly RawAnalyticsEvent[]): Map<string, DayCounts> {
  const buckets = new Map<string, ReturnType<typeof emptyAccumulator>>();
  for (const event of events) {
    const key = utcDayKey(event.ts);
    let acc = buckets.get(key);
    if (!acc) {
      acc = emptyAccumulator();
      buckets.set(key, acc);
    }
    acc.sessions.add(event.sessionHash);
    switch (event.type) {
      case "view":
        acc.views += 1;
        break;
      case "start":
        acc.starts += 1;
        break;
      case "complete":
        acc.completes += 1;
        break;
      case "question_view":
        acc.questionViews += 1;
        break;
      case "question_pass":
        acc.questionPasses += 1;
        break;
    }
  }
  const result = new Map<string, DayCounts>();
  for (const [key, acc] of buckets) {
    const { sessions, ...counts } = acc;
    result.set(key, { ...counts, uniques: sessions.size });
  }
  return result;
}

/**
 * Zero-filled per-day series for the range: every UTC day in `[from, to)`
 * appears exactly once, in order, with counts from the raw events.
 */
export function buildDailySeries(events: readonly RawAnalyticsEvent[], range: AnalyticsRange): DailyPoint[] {
  const buckets = bucketEventsByDay(events);
  const series: DailyPoint[] = [];
  for (const day of daysInRange(range)) {
    const counts = buckets.get(day) ?? emptyAccumulatorCounts();
    series.push({ day, ...counts, completionRate: completionRate(counts.starts, counts.completes) });
  }
  return series;
}

function emptyAccumulatorCounts(): DayCounts {
  return { views: 0, starts: 0, completes: 0, uniques: 0, questionViews: 0, questionPasses: 0 };
}

/**
 * Range KPIs computed from raw events.
 * SPEC-NOTE: "uniques" counts distinct anonymous visitor ids (session hashes)
 * across all event types in range — the spec does not pin the definition, and
 * every tracked session begins with a `view` beacon, so this equals
 * "unique viewers" in practice while staying robust for embeds.
 */
export function computeKpis(events: readonly RawAnalyticsEvent[]): AnalyticsKpis {
  let views = 0;
  let starts = 0;
  let submissions = 0;
  const sessions = new Set<string>();
  for (const event of events) {
    sessions.add(event.sessionHash);
    switch (event.type) {
      case "view":
        views += 1;
        break;
      case "start":
        starts += 1;
        break;
      case "complete":
        submissions += 1;
        break;
      default:
        break;
    }
  }
  return { views, uniques: sessions.size, starts, submissions, completionRate: completionRate(starts, submissions) };
}

/**
 * Per-question drop-off from `question_view` / `question_pass` events.
 * Steps are ordered by first occurrence (block order in practice). Gating by
 * `can(workspaceId, 'advanced_analytics')` happens in the service layer.
 */
export function computeDropOff(events: readonly RawAnalyticsEvent[]): DropOffStep[] {
  const order: string[] = [];
  const steps = new Map<string, { views: number; passes: number; firstTs: number }>();
  for (const event of events) {
    if (event.type !== "question_view" && event.type !== "question_pass") continue;
    const blockId = event.blockId;
    if (!blockId) continue; // malformed beacon: pass/question events must carry blockId
    let step = steps.get(blockId);
    if (!step) {
      step = { views: 0, passes: 0, firstTs: event.ts.getTime() };
      steps.set(blockId, step);
      order.push(blockId);
    }
    step.firstTs = Math.min(step.firstTs, event.ts.getTime());
    if (event.type === "question_view") step.views += 1;
    else step.passes += 1;
  }
  return order
    .sort((a, b) => {
      const first = steps.get(a);
      const second = steps.get(b);
      return (first?.firstTs ?? 0) - (second?.firstTs ?? 0);
    })
    .map((blockId) => {
      const step = steps.get(blockId);
      const views = step?.views ?? 0;
      const passes = step?.passes ?? 0;
      // With no views the rates are unknown, not 100% drop-off — report 0.
      const passRate = views > 0 ? round4(passes / views) : 0;
      return { blockId, views, passes, passRate, dropOffRate: views > 0 ? round4(1 - passRate) : 0 };
    });
}
