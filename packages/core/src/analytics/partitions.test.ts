// T19 — partition planner tests: current+next month coverage, year rollover,
// month lengths (leap years), deterministic names, idempotent DDL shape.
import { describe, expect, it } from "vitest";

import {
  addMonthsUtc,
  monthStartUtc,
  partitionDDL,
  partitionName,
  planMonthlyPartitions,
} from "./partitions";

describe("partition planner", () => {
  it("plans current + next month by default (issue #19 acceptance)", () => {
    const plan = planMonthlyPartitions({
      parent: "analytics_events",
      from: new Date("2026-11-06T15:00:00.000Z"),
      months: 2,
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      name: "analytics_events_y2026m11",
      fromIso: "2026-11-01T00:00:00.000Z",
      toIso: "2026-12-01T00:00:00.000Z",
    });
    expect(plan[1]).toMatchObject({
      name: "analytics_events_y2026m12",
      fromIso: "2026-12-01T00:00:00.000Z",
      toIso: "2027-01-01T00:00:00.000Z",
    });
  });

  it("rolls over the year boundary", () => {
    const plan = planMonthlyPartitions({
      parent: "analytics_events",
      from: new Date("2026-11-30T23:59:59.000Z"),
      months: 3,
    });
    expect(plan.map((item) => item.name)).toEqual([
      "analytics_events_y2026m11",
      "analytics_events_y2026m12",
      "analytics_events_y2027m01",
    ]);
    const last = plan[2];
    expect(last?.fromIso).toBe("2027-01-01T00:00:00.000Z");
    expect(last?.toIso).toBe("2027-02-01T00:00:00.000Z");
  });

  it("handles month lengths including leap years", () => {
    const plan = planMonthlyPartitions({
      parent: "analytics_events",
      from: new Date("2028-01-15T00:00:00.000Z"),
      months: 2,
    });
    expect(plan[0]?.toIso).toBe("2028-02-01T00:00:00.000Z");
    expect(plan[1]).toMatchObject({
      name: "analytics_events_y2028m02",
      fromIso: "2028-02-01T00:00:00.000Z",
      toIso: "2028-03-01T00:00:00.000Z", // 2028 is a leap year; bound is still month start
    });
  });

  it("floors the input to the month start", () => {
    expect(monthStartUtc(new Date("2026-11-06T15:44:00.000Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(addMonthsUtc(new Date("2026-11-01T00:00:00.000Z"), 2).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("zero-pads months in deterministic names", () => {
    expect(partitionName("analytics_events", 2027, 1)).toBe("analytics_events_y2027m01");
    expect(partitionName("analytics_events", 2027, 12)).toBe("analytics_events_y2027m12");
  });

  it("produces idempotent CREATE TABLE IF NOT EXISTS DDL", () => {
    const plan = planMonthlyPartitions({
      parent: "analytics_events",
      from: new Date("2026-11-06T00:00:00.000Z"),
      months: 1,
    });
    const item = plan[0];
    if (!item) throw new Error("plan unexpectedly empty");
    const ddl = partitionDDL("analytics_events", item);
    expect(ddl).toBe(
      'CREATE TABLE IF NOT EXISTS "analytics_events_y2026m11" ' +
        'PARTITION OF "analytics_events" ' +
        "FOR VALUES FROM ('2026-11-01T00:00:00.000Z') TO ('2026-12-01T00:00:00.000Z')",
    );
    // Planning twice yields the same statement (safe to re-run by the cron job).
    const again = planMonthlyPartitions({
      parent: "analytics_events",
      from: new Date("2026-11-06T00:00:00.000Z"),
      months: 1,
    });
    expect(partitionDDL("analytics_events", again[0]!)).toBe(ddl);
  });

  it("rejects non-positive month counts", () => {
    expect(() => planMonthlyPartitions({ parent: "analytics_events", from: new Date(0), months: 0 })).toThrow();
  });
});
