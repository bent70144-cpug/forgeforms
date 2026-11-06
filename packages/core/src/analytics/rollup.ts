// @formforge/core — analytics rollups, PURE functions (spec §6 `analytics_daily`,
// §12: "rollup daily (hourly for today)").
// Idempotency model: rows are always RECOMPUTED from raw events and REPLACED via
// upsert (on-conflict-do-update) — re-running a day never double counts.

import { utcDayKey } from "./bucket";
import type { DailyPoint, DailyRollupRow, RawAnalyticsEvent } from "./types";

const ROLLUP_TYPES = new Set(["view", "start", "complete"] as const);

/**
 * Aggregate raw events into `analytics_daily` rows (document_id, day) with
 * views / starts / completes. Deterministic: the same events always produce
 * the same rows, which makes re-running the job idempotent after the
 * repository upserts (replace, not increment).
 */
export function rollupEventsToDaily(events: readonly RawAnalyticsEvent[]): DailyRollupRow[] {
  const rows = new Map<string, DailyRollupRow>();
  for (const event of events) {
    if (!ROLLUP_TYPES.has(event.type as "view" | "start" | "complete")) continue;
    const day = utcDayKey(event.ts);
    const key = `${event.documentId}|${day}`;
    let row = rows.get(key);
    if (!row) {
      row = { documentId: event.documentId, day, views: 0, starts: 0, completes: 0 };
      rows.set(key, row);
    }
    switch (event.type) {
      case "view":
        row.views += 1;
        break;
      case "start":
        row.starts += 1;
        break;
      case "complete":
        row.completes += 1;
        break;
      default:
        break;
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.documentId.localeCompare(b.documentId) || a.day.localeCompare(b.day),
  );
}

/**
 * Ensure a rollup exists for `documentId`/`day` even when no events were found:
 * a zero row RESETS any stale value from a previous (e.g. hourly) run. This is
 * what makes "recompute a day" safe when events were deleted or deduplicated.
 */
export function ensureZeroRow(rows: readonly DailyRollupRow[], documentId: string, day: string): DailyRollupRow[] {
  const exists = rows.some((row) => row.documentId === documentId && row.day === day);
  if (exists) return [...rows];
  return [...rows, { documentId, day, views: 0, starts: 0, completes: 0 }].sort(
    (a, b) => a.documentId.localeCompare(b.documentId) || a.day.localeCompare(b.day),
  );
}

/** Sum rollup rows — used by parity tests (rollup sums == raw KPIs). */
export function sumDailyRows(rows: readonly DailyRollupRow[]): { views: number; starts: number; completes: number } {
  return rows.reduce(
    (acc, row) => ({
      views: acc.views + row.views,
      starts: acc.starts + row.starts,
      completes: acc.completes + row.completes,
    }),
    { views: 0, starts: 0, completes: 0 },
  );
}

/**
 * Overlay `analytics_daily` rollups onto a raw-derived series (spec §14.1.5:
 * the Analytics tab trend is rendered from rollups). Days without a rollup row
 * fall back to the raw computation so the tab is correct before the first
 * job run. Uniques never come from rollups (schema has no uniques column).
 */
export function mergeRollupsIntoSeries(
  series: readonly DailyPoint[],
  daily: readonly DailyRollupRow[],
): DailyPoint[] {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  return series.map((point) => {
    const row = byDay.get(point.day);
    if (!row) return point;
    return {
      ...point,
      views: row.views,
      starts: row.starts,
      completes: row.completes,
      completionRate: row.starts > 0 ? Math.round((row.completes / row.starts) * 10_000) / 10_000 : 0,
    };
  });
}
