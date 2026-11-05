// T19 — rollup tests: fixture correctness, idempotency (re-running a day never
// double counts), zero-row reset, rollup-vs-raw parity ("single source" check).
import { describe, expect, it } from "vitest";

import { computeKpis, dayKeyToDate } from "./bucket";
import {
  ensureZeroRow,
  mergeRollupsIntoSeries,
  rollupEventsToDaily,
  sumDailyRows,
} from "./rollup";
import { buildDailySeries } from "./bucket";
import type { DailyRollupRow, RawAnalyticsEvent } from "./types";

const DOC = "doc-1";

function eventsFixture(): RawAnalyticsEvent[] {
  // 2 days, 3 sessions, mixed funnel stages — the canonical fixture.
  return [
    // 2026-11-05
    { documentId: DOC, ts: new Date("2026-11-05T09:00:00.000Z"), type: "view", sessionHash: "s1", blockId: null, props: null },
    { documentId: DOC, ts: new Date("2026-11-05T09:01:00.000Z"), type: "view", sessionHash: "s2", blockId: null, props: null },
    { documentId: DOC, ts: new Date("2026-11-05T09:02:00.000Z"), type: "start", sessionHash: "s1", blockId: null, props: null },
    { documentId: DOC, ts: new Date("2026-11-05T09:03:00.000Z"), type: "question_view", sessionHash: "s1", blockId: "b1", props: null },
    { documentId: DOC, ts: new Date("2026-11-05T09:04:00.000Z"), type: "complete", sessionHash: "s1", blockId: null, props: null },
    // 2026-11-06
    { documentId: DOC, ts: new Date("2026-11-06T10:00:00.000Z"), type: "view", sessionHash: "s3", blockId: null, props: null },
    { documentId: DOC, ts: new Date("2026-11-06T10:01:00.000Z"), type: "start", sessionHash: "s3", blockId: null, props: null },
  ];
}

describe("rollupEventsToDaily", () => {
  it("rolls the fixture into one row per document+day", () => {
    const rows = rollupEventsToDaily(eventsFixture());
    expect(rows).toEqual([
      { documentId: DOC, day: "2026-11-05", views: 2, starts: 1, completes: 1 },
      { documentId: DOC, day: "2026-11-06", views: 1, starts: 1, completes: 0 },
    ]);
  });

  it("separates documents and ignores non-rollup event types", () => {
    const events: RawAnalyticsEvent[] = [
      { documentId: "doc-a", ts: new Date("2026-11-05T09:00:00.000Z"), type: "view", sessionHash: "s1", blockId: null, props: null },
      { documentId: "doc-b", ts: new Date("2026-11-05T09:00:00.000Z"), type: "view", sessionHash: "s1", blockId: null, props: null },
      { documentId: "doc-a", ts: new Date("2026-11-05T09:01:00.000Z"), type: "question_view", sessionHash: "s1", blockId: "b1", props: null },
      { documentId: "doc-a", ts: new Date("2026-11-05T09:02:00.000Z"), type: "question_pass", sessionHash: "s1", blockId: "b1", props: null },
    ];
    const rows = rollupEventsToDaily(events);
    expect(rows).toEqual([
      { documentId: "doc-a", day: "2026-11-05", views: 1, starts: 0, completes: 0 },
      { documentId: "doc-b", day: "2026-11-05", views: 1, starts: 0, completes: 0 },
    ]);
  });

  it("returns an empty list for empty input (empty ranges stay empty)", () => {
    expect(rollupEventsToDaily([])).toEqual([]);
  });
});

describe("rollup idempotency (re-running the same day never double counts)", () => {
  /** Simulates the DB upsert semantics: primary key (document_id, day), REPLACE counts. */
  function makeUpsertStore() {
    const store = new Map<string, DailyRollupRow>();
    return {
      store,
      upsert(rows: readonly DailyRollupRow[]) {
        for (const row of rows) store.set(`${row.documentId}|${row.day}`, { ...row });
      },
      totals() {
        return [...store.values()].reduce(
          (acc, row) => ({
            views: acc.views + row.views,
            starts: acc.starts + row.starts,
            completes: acc.completes + row.completes,
          }),
          { views: 0, starts: 0, completes: 0 },
        );
      },
    };
  }

  it("re-running the rollup on the same events yields identical totals", () => {
    const store = makeUpsertStore();
    const events = eventsFixture();
    for (let run = 0; run < 5; run += 1) {
      store.upsert(ensureZeroRow(rollupEventsToDaily(events), DOC, "2026-11-05"));
    }
    expect(store.totals()).toEqual({ views: 3, starts: 2, completes: 1 });
  });

  it("new events raise the recomputed value instead of stacking", () => {
    const store = makeUpsertStore();
    const day1 = eventsFixture().filter((e) => e.ts.toISOString().startsWith("2026-11-05"));
    store.upsert(ensureZeroRow(rollupEventsToDaily(day1), DOC, "2026-11-05"));
    expect(store.totals()).toEqual({ views: 2, starts: 1, completes: 1 });

    const twoMoreViews: RawAnalyticsEvent[] = [
      { documentId: DOC, ts: new Date("2026-11-05T18:00:00.000Z"), type: "view", sessionHash: "s9", blockId: null, props: null },
      { documentId: DOC, ts: new Date("2026-11-05T18:05:00.000Z"), type: "view", sessionHash: "s10", blockId: null, props: null },
    ];
    // Hourly cron re-runs over the FULL day (raw events are the source of truth).
    store.upsert(ensureZeroRow(rollupEventsToDaily([...day1, ...twoMoreViews]), DOC, "2026-11-05"));
    expect(store.totals()).toEqual({ views: 4, starts: 1, completes: 1 });
  });

  it("a day whose events disappear resets to a zero row", () => {
    const store = makeUpsertStore();
    store.upsert(ensureZeroRow(rollupEventsToDaily(eventsFixture()), DOC, "2026-11-05"));
    expect(store.totals()).toEqual({ views: 3, starts: 2, completes: 1 });

    // Maintenance wiped the day (or dedup): recompute must reset, not keep stale counts.
    store.upsert(ensureZeroRow(rollupEventsToDaily([]), DOC, "2026-11-05"));
    expect(store.store.get(`${DOC}|2026-11-05`)).toEqual({
      documentId: DOC,
      day: "2026-11-05",
      views: 0,
      starts: 0,
      completes: 0,
    });
  });

  it("ensureZeroRow does not duplicate an existing row", () => {
    const rows = rollupEventsToDaily(eventsFixture());
    const once = ensureZeroRow(rows, DOC, "2026-11-06");
    expect(once).toHaveLength(2);
    expect(ensureZeroRow(once, DOC, "2026-11-06")).toHaveLength(2);
  });
});

describe("single-source parity: rollup sums == raw KPIs", () => {
  it("analytics_daily totals match raw events on the fixture", () => {
    const events = eventsFixture();
    const rows = rollupEventsToDaily(events);
    const sums = sumDailyRows(rows);
    const kpis = computeKpis(events);
    expect(sums.views).toBe(kpis.views);
    expect(sums.starts).toBe(kpis.starts);
    expect(sums.completes).toBe(kpis.submissions); // submissions are `complete` events
  });

  it("parity holds after zero-row reset with no events", () => {
    const rows = ensureZeroRow(rollupEventsToDaily([]), DOC, "2026-11-05");
    expect(sumDailyRows(rows)).toEqual({ views: 0, starts: 0, completes: 0 });
  });
});

describe("mergeRollupsIntoSeries (Analytics tab trend from rollups)", () => {
  const range = { from: dayKeyToDate("2026-11-01"), to: dayKeyToDate("2026-11-04") };

  it("prefers rollup values when a row exists, raw values otherwise", () => {
    const series = buildDailySeries(
      [{ documentId: DOC, ts: new Date("2026-11-02T08:00:00.000Z"), type: "view", sessionHash: "s1", blockId: null, props: null }],
      range,
    );
    const daily: DailyRollupRow[] = [
      { documentId: DOC, day: "2026-11-02", views: 999, starts: 10, completes: 5 },
    ];
    const merged = mergeRollupsIntoSeries(series, daily);
    expect(merged[0]).toMatchObject({ day: "2026-11-01", views: 0 }); // raw fallback
    expect(merged[1]).toMatchObject({ day: "2026-11-02", views: 999, starts: 10, completes: 5, completionRate: 0.5 });
    expect(merged[2]).toMatchObject({ day: "2026-11-03", views: 0 });
  });

  it("keeps uniques from raw events (rollups do not carry uniques)", () => {
    const series = buildDailySeries(
      [{ documentId: DOC, ts: new Date("2026-11-02T08:00:00.000Z"), type: "view", sessionHash: "s1", blockId: null, props: null }],
      range,
    );
    const merged = mergeRollupsIntoSeries(series, [
      { documentId: DOC, day: "2026-11-02", views: 7, starts: 0, completes: 0 },
    ]);
    expect(merged[1]).toMatchObject({ uniques: 1, views: 7, completionRate: 0 });
  });
});
