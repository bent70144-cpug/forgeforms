// @formforge/core — analytics domain types (spec §6 `analytics_events` /
// `analytics_daily`, §12 rollups, §14.1.5 Analytics tab).
// Pure data contracts only; see bucket.ts / rollup.ts / service.ts for logic.

export const ANALYTICS_EVENT_TYPES = [
  "view",
  "start",
  "question_view",
  "question_pass",
  "complete",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * A raw analytics event as stored in `analytics_events` (spec §6).
 * Partitioned by range(ts) in Postgres; rows carry no IP and no cookies —
 * `sessionHash` is a server-side sha256 of an anonymous visitor id (spec §4
 * logging rule: hash session ids, never store IPs).
 */
export interface RawAnalyticsEvent {
  documentId: string;
  ts: Date;
  type: AnalyticsEventType;
  sessionHash: string;
  blockId: string | null;
  props: Record<string, unknown> | null;
}

/** Half-open UTC range `[from, to)` (spec §4: all time is UTC timestamptz). */
export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export type RangePreset = "7d" | "30d";

/** `7d` / `30d` presets or a custom inclusive day span (`YYYY-MM-DD` keys). */
export type RangeSpec =
  | { kind: "preset"; preset: RangePreset }
  | { kind: "custom"; fromDay: string; toDay: string };

export interface DayCounts {
  views: number;
  starts: number;
  completes: number;
  /** Distinct anonymous visitor ids (session hashes) seen that day. */
  uniques: number;
  questionViews: number;
  questionPasses: number;
}

/** One zero-filled day in a per-day series (UTC day buckets). */
export interface DailyPoint extends DayCounts {
  /** `YYYY-MM-DD` UTC day key. */
  day: string;
  /** completes / starts, 0 when starts === 0, rounded to 4 dp. */
  completionRate: number;
}

export interface AnalyticsKpis {
  views: number;
  uniques: number;
  starts: number;
  /** Count of `complete` events (i.e. submissions) in range. */
  submissions: number;
  /** submissions / starts, 0 when starts === 0, rounded to 4 dp. */
  completionRate: number;
}

/** Row of `analytics_daily` (spec §6) — rollup output, idempotent by upsert. */
export interface DailyRollupRow {
  documentId: string;
  /** `YYYY-MM-DD` UTC day key. */
  day: string;
  views: number;
  starts: number;
  completes: number;
}

export interface DropOffStep {
  blockId: string;
  /** question_view count. */
  views: number;
  /** question_pass count. */
  passes: number;
  passRate: number;
  /** 1 - passRate, rounded to 4 dp; 0 when views === 0. */
  dropOffRate: number;
}

export interface AnalyticsSummary {
  documentId: string;
  range: AnalyticsRange;
  kpis: AnalyticsKpis;
  /** Per-day series (zero-filled), trend values taken from rollups when present. */
  series: DailyPoint[];
  /** Raw `analytics_daily` rows read for the range (kept for parity checks). */
  daily: DailyRollupRow[];
}
