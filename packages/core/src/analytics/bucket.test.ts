// T19 — pure aggregation tests: UTC bucketing, uniques dedup, completion rate,
// empty/edge ranges, drop-off (spec §4 UTC timestamps, §12, §14.1.5).
import { describe, expect, it } from "vitest";

import {
  addUtcDays,
  bucketEventsByDay,
  buildDailySeries,
  computeDropOff,
  computeKpis,
  completionRate,
  dayKeyToDate,
  daysInRange,
  resolveRange,
  round4,
  startOfUtcDay,
  utcDayKey,
} from "./bucket";
import { AppError } from "../bridge";
import type { RangeSpec, RawAnalyticsEvent } from "./types";

/** Fixture factory — defaults to a `view` by `session-a` at 2026-11-06T12:00Z. */
function event(
  partial: Partial<RawAnalyticsEvent> & { type?: RawAnalyticsEvent["type"] },
): RawAnalyticsEvent {
  return {
    documentId: "doc-1",
    ts: new Date("2026-11-06T12:00:00.000Z"),
    sessionHash: "session-a",
    blockId: null,
    props: null,
    type: "view",
    ...partial,
  };
}

describe("UTC day bucketing (DST-free)", () => {
  it("splits events at the exact UTC midnight boundary", () => {
    const before = event({ ts: new Date("2026-11-06T23:59:59.999Z") });
    const after = event({ ts: new Date("2026-11-07T00:00:00.000Z") });
    expect(utcDayKey(before.ts)).toBe("2026-11-06");
    expect(utcDayKey(after.ts)).toBe("2026-11-07");
  });

  it("splits at month and year boundaries", () => {
    expect(utcDayKey(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-31");
    expect(utcDayKey(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
    expect(utcDayKey(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12-31");
    expect(utcDayKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });

  it("startOfUtcDay floors to UTC midnight regardless of local timezone", () => {
    const ts = new Date("2026-11-06T15:44:12.345Z");
    expect(startOfUtcDay(ts).toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(dayKeyToDate("2026-11-06").toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("addUtcDays crosses month boundaries correctly", () => {
    expect(utcDayKey(addUtcDays(dayKeyToDate("2026-10-31"), 1))).toBe("2026-11-01");
    expect(utcDayKey(addUtcDays(dayKeyToDate("2026-12-31"), 1))).toBe("2027-01-01");
    expect(utcDayKey(addUtcDays(dayKeyToDate("2028-02-28"), 1))).toBe("2028-02-29"); // leap year
  });

  it("daysInRange covers every day of a half-open range", () => {
    const days = daysInRange({ from: dayKeyToDate("2026-11-30"), to: dayKeyToDate("2026-12-03") });
    expect(days).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
});

describe("resolveRange (7d / 30d / custom)", () => {
  const now = new Date("2026-11-06T15:30:00.000Z");

  it("7d includes today and covers exactly 7 UTC days", () => {
    const spec: RangeSpec = { kind: "preset", preset: "7d" };
    const range = resolveRange(spec, now);
    expect(range.from.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(daysInRange(range)).toHaveLength(7);
  });

  it("30d includes today and covers exactly 30 UTC days", () => {
    const range = resolveRange({ kind: "preset", preset: "30d" }, now);
    expect(range.from.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(daysInRange(range)).toHaveLength(30);
  });

  it("custom range is inclusive of both day keys", () => {
    const range = resolveRange({ kind: "custom", fromDay: "2026-11-01", toDay: "2026-11-03" }, now);
    expect(range.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(daysInRange(range)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("rejects inverted and oversized custom ranges with VALIDATION", () => {
    expect(() => resolveRange({ kind: "custom", fromDay: "2026-11-03", toDay: "2026-11-01" }, now)).toThrow(AppError);
    expect(() =>
      resolveRange({ kind: "custom", fromDay: "2025-01-01", toDay: "2027-01-01" }, now),
    ).toThrowError(/exceeds/);
  });

  it("rejects malformed day keys", () => {
    expect(() => resolveRange({ kind: "custom", fromDay: "2026-13-40", toDay: "2026-12-01" }, now)).toThrow(AppError);
  });
});

describe("uniques dedup (anonymous visitor id)", () => {
  it("counts distinct session hashes per day, not events", () => {
    const events = [
      event({ sessionHash: "aaa" }),
      event({ sessionHash: "aaa", ts: new Date("2026-11-06T13:00:00.000Z") }),
      event({ sessionHash: "bbb" }),
      event({ sessionHash: "aaa" }),
    ];
    const buckets = bucketEventsByDay(events);
    expect(buckets.get("2026-11-06")?.uniques).toBe(2);
    expect(buckets.get("2026-11-06")?.views).toBe(4);
  });

  it("same visitor on two days is a unique on each day", () => {
    const events = [
      event({ sessionHash: "aaa", ts: new Date("2026-11-05T23:59:59.000Z") }),
      event({ sessionHash: "aaa", ts: new Date("2026-11-06T00:00:01.000Z") }),
    ];
    const buckets = bucketEventsByDay(events);
    expect(buckets.get("2026-11-05")?.uniques).toBe(1);
    expect(buckets.get("2026-11-06")?.uniques).toBe(1);
  });

  it("kpis dedup uniques across the whole range", () => {
    const events = [
      event({ sessionHash: "aaa" }),
      event({ sessionHash: "bbb", ts: new Date("2026-11-07T01:00:00.000Z") }),
      event({ sessionHash: "aaa", ts: new Date("2026-11-07T02:00:00.000Z") }),
    ];
    expect(computeKpis(events).uniques).toBe(2);
  });
});

describe("completion rate math", () => {
  it("is completes / starts and rounds to 4dp", () => {
    expect(completionRate(4, 3)).toBe(0.75);
    expect(completionRate(3, 1)).toBe(round4(1 / 3));
    expect(completionRate(3, 1)).toBe(0.3333);
  });

  it("is 0 when there are no starts (no NaN)", () => {
    expect(completionRate(0, 5)).toBe(0);
  });

  it("kpis: completionRate = submissions / starts", () => {
    const events = [
      event({ type: "view" }),
      event({ type: "start", sessionHash: "b" }),
      event({ type: "start", sessionHash: "c" }),
      event({ type: "complete", sessionHash: "b" }),
    ];
    const kpis = computeKpis(events);
    expect(kpis).toMatchObject({ views: 1, starts: 2, submissions: 1, uniques: 3, completionRate: 0.5 });
  });
});

describe("buildDailySeries", () => {
  it("zero-fills empty days inside the range", () => {
    const range = { from: dayKeyToDate("2026-11-01"), to: dayKeyToDate("2026-11-04") };
    const events = [event({ ts: new Date("2026-11-02T10:00:00.000Z") })];
    const series = buildDailySeries(events, range);
    expect(series.map((point) => point.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(series[0]).toMatchObject({ views: 0, starts: 0, completes: 0, uniques: 0, completionRate: 0 });
    expect(series[1]).toMatchObject({ views: 1, uniques: 1 });
  });

  it("returns an empty series for an empty range", () => {
    const range = { from: dayKeyToDate("2026-11-05"), to: dayKeyToDate("2026-11-05") };
    expect(buildDailySeries([], range)).toEqual([]);
  });

  it("excludes events outside the range", () => {
    const range = { from: dayKeyToDate("2026-11-01"), to: dayKeyToDate("2026-11-03") };
    const events = [
      event({ ts: new Date("2026-10-31T23:59:59.999Z") }),
      event({ ts: new Date("2026-11-01T00:00:00.000Z") }),
      event({ ts: new Date("2026-11-03T00:00:00.000Z") }), // to is exclusive
    ];
    const series = buildDailySeries(events, range);
    expect(series[0]?.views).toBe(1);
    expect(series[1]?.views).toBe(0);
  });

  it("computes per-day completion rates independently", () => {
    const range = { from: dayKeyToDate("2026-11-01"), to: dayKeyToDate("2026-11-03") };
    const events = [
      event({ type: "start", ts: new Date("2026-11-01T09:00:00.000Z") }),
      event({ type: "complete", ts: new Date("2026-11-01T09:05:00.000Z") }),
      event({ type: "start", ts: new Date("2026-11-02T09:00:00.000Z") }),
      event({ type: "start", ts: new Date("2026-11-02T09:10:00.000Z") }),
    ];
    const series = buildDailySeries(events, range);
    expect(series[0]?.completionRate).toBe(1);
    expect(series[1]?.completionRate).toBe(0);
  });
});

describe("computeDropOff", () => {
  it("computes pass and drop-off rates per block, ordered by first view", () => {
    const events = [
      event({ type: "question_view", blockId: "b2", ts: new Date("2026-11-06T10:01:00.000Z") }),
      event({ type: "question_view", blockId: "b1", ts: new Date("2026-11-06T10:00:00.000Z") }),
      event({ type: "question_view", blockId: "b1", ts: new Date("2026-11-06T10:00:30.000Z") }),
      event({ type: "question_pass", blockId: "b1", ts: new Date("2026-11-06T10:00:40.000Z") }),
      event({ type: "question_view", blockId: "b1", ts: new Date("2026-11-06T10:01:30.000Z") }),
      event({ type: "question_pass", blockId: "b2", ts: new Date("2026-11-06T10:02:00.000Z") }),
      event({ type: "view" }), // ignored by drop-off
    ];
    const steps = computeDropOff(events);
    expect(steps.map((step) => step.blockId)).toEqual(["b1", "b2"]);
    expect(steps[0]).toMatchObject({ views: 3, passes: 1, passRate: round4(1 / 3), dropOffRate: round4(2 / 3) });
    expect(steps[1]).toMatchObject({ views: 1, passes: 1, passRate: 1, dropOffRate: 0 });
  });

  it("ignores question events without a blockId and events without views", () => {
    const events = [
      event({ type: "question_pass", blockId: null }),
      event({ type: "question_pass", blockId: "b9" }),
    ];
    const steps = computeDropOff(events);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ blockId: "b9", views: 0, passes: 1, passRate: 0, dropOffRate: 0 });
  });

  it("returns an empty list for ranges without question events", () => {
    expect(computeDropOff([event({ type: "view" })])).toEqual([]);
    expect(computeDropOff([])).toEqual([]);
  });
});
