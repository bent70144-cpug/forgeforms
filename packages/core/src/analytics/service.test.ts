// T19 — service tests against an in-memory repository port (no DB needed):
// ingest normalization, getAnalytics KPIs + rollup-backed trend, rollupDay
// idempotency, partition planning, drop-off gating via can(...).
import { describe, expect, it } from "vitest";

import { createAnalyticsService, openAdvancedAnalyticsGate } from "./service";
import type { AnalyticsRepositoryPort, AnalyticsService } from "./service";
import type { PartitionPlanItem } from "./partitions";
import type { AnalyticsEventType, AnalyticsRange, DailyRollupRow, RawAnalyticsEvent } from "./types";

/** In-memory double of the drizzle repository (same semantics, no Postgres). */
function fakeRepo() {
  const events: RawAnalyticsEvent[] = [];
  const daily = new Map<string, DailyRollupRow>();
  const calls = { ensureParentTable: 0, partitions: [] as PartitionPlanItem[][], upserts: 0 };
  const repo: AnalyticsRepositoryPort = {
    async insertEvents(rows) {
      events.push(...rows.map((row) => ({ ...row })));
      return rows.length;
    },
    async listEvents(documentId, range, types) {
      const allowed = types ? new Set<string>(types) : null;
      return events
        .filter(
          (event) =>
            event.documentId === documentId &&
            event.ts.getTime() >= range.from.getTime() &&
            event.ts.getTime() < range.to.getTime() &&
            (allowed === null || allowed.has(event.type)),
        )
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    },
    async listDaily(documentId, fromDay, toDay) {
      return [...daily.values()]
        .filter((row) => row.documentId === documentId && row.day >= fromDay && row.day <= toDay)
        .sort((a, b) => a.day.localeCompare(b.day));
    },
    async upsertDaily(rows) {
      calls.upserts += 1;
      for (const row of rows) daily.set(`${row.documentId}|${row.day}`, { ...row });
    },
    async listDocumentIdsWithEvents(range) {
      return [...new Set(events.filter((event) => event.ts >= range.from && event.ts < range.to).map((event) => event.documentId))].sort();
    },
    async ensureParentTable() {
      calls.ensureParentTable += 1;
    },
    async ensurePartitions(plan) {
      calls.partitions.push([...plan]);
    },
  };
  return { repo, events, daily, calls };
}

const FIXED_NOW = new Date("2026-11-06T12:00:00.000Z");
const ctx = { now: () => new Date(FIXED_NOW) };

function makeService(repo: AnalyticsRepositoryPort): AnalyticsService {
  return createAnalyticsService({ repo, ctx });
}

function batchOf(...events: Array<{ type: RawAnalyticsEvent["type"]; sessionId?: string; blockId?: string; ts?: string }>) {
  return {
    documentId: "018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80",
    events: events.map((event) => ({
      type: event.type,
      sessionId: event.sessionId ?? "visitor-1234",
      ...(event.blockId ? { blockId: event.blockId } : {}),
      ...(event.ts ? { ts: event.ts } : {}),
    })),
  };
}

describe("AnalyticsService.ingestBatch", () => {
  it("inserts hashed, normalized events", async () => {
    const { repo, events } = fakeRepo();
    const service = makeService(repo);
    const result = await service.ingestBatch(
      batchOf(
        { type: "view" },
        { type: "question_view", blockId: "b1", sessionId: "visitor-5678" },
      ),
    );
    expect(result.inserted).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("view");
    expect(events[0]?.sessionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0]?.ts.toISOString()).toBe(FIXED_NOW.toISOString());
    expect(events[1]?.blockId).toBe("b1");
  });

  it("rejects malformed batches with AppError VALIDATION (route maps to 422)", async () => {
    const { repo } = fakeRepo();
    const service = makeService(repo);
    await expect(service.ingestBatch({ documentId: "d", events: [] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("recordEvents accepts pre-normalized events (GET pixel path)", async () => {
    const { repo, events } = fakeRepo();
    const service = makeService(repo);
    const inserted = await service.recordEvents([
      { documentId: "doc1", ts: new Date(FIXED_NOW), type: "view", sessionHash: "a".repeat(64), blockId: null, props: null },
    ]);
    expect(inserted.inserted).toBe(1);
    expect(events).toHaveLength(1);
  });
});

describe("AnalyticsService.getAnalytics", () => {
  it("returns KPIs, a zero-filled series and rollup-backed trend", async () => {
    const { repo } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch(
      batchOf(
        { type: "view", ts: "2026-11-05T09:00:00.000Z" },
        { type: "start", ts: "2026-11-05T09:01:00.000Z" },
        { type: "complete", ts: "2026-11-05T09:02:00.000Z" },
        { type: "view", ts: "2026-11-06T09:00:00.000Z", sessionId: "visitor-9999" },
      ),
    );
    const summary = await service.getAnalytics("018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80", { kind: "preset", preset: "7d" });
    expect(summary.kpis).toMatchObject({ views: 2, uniques: 2, starts: 1, submissions: 1, completionRate: 1 });
    // 7d preset ending today (2026-11-06): 2026-10-31 .. 2026-11-06
    expect(summary.series).toHaveLength(7);
    expect(summary.series[0]?.day).toBe("2026-10-31");
    expect(summary.series.at(-1)?.day).toBe("2026-11-06");
    expect(summary.series.find((point) => point.day === "2026-11-05")).toMatchObject({
      views: 1,
      starts: 1,
      completes: 1,
      completionRate: 1,
    });
  });

  it("overlay: days present in analytics_daily use rollup values (trend from rollups)", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    daily.set("doc1|2026-11-05", { documentId: "doc1", day: "2026-11-05", views: 41, starts: 4, completes: 2 });
    const summary = await service.getAnalytics("doc1", {
      kind: "custom",
      fromDay: "2026-11-04",
      toDay: "2026-11-06",
    });
    expect(summary.series.find((point) => point.day === "2026-11-05")).toMatchObject({
      views: 41,
      starts: 4,
      completes: 2,
      completionRate: 0.5,
    });
  });
});

describe("AnalyticsService.rollupDay (hourly for today, daily rollup)", () => {
  it("rolls today by default from a batch and writes analytics_daily", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch(
      batchOf(
        { type: "view", ts: "2026-11-06T08:00:00.000Z" },
        { type: "view", ts: "2026-11-06T08:01:00.000Z" },
        { type: "start", ts: "2026-11-06T08:02:00.000Z" },
      ),
    );
    const result = await service.rollupDay();
    expect(result).toMatchObject({ day: "2026-11-06", documents: 1, rows: 1 });
    expect(daily.get("018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80|2026-11-06")).toMatchObject({
      views: 2,
      starts: 1,
      completes: 0,
    });
  });

  it("is idempotent: re-running the same day replaces instead of stacking", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch(batchOf({ type: "view", ts: "2026-11-06T08:00:00.000Z" }));
    await service.rollupDay({ documentId: "018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80" });
    await service.rollupDay({ documentId: "018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80" });
    await service.rollupDay({ documentId: "018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80" });
    expect(daily.size).toBe(1);
    expect(daily.get("018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80|2026-11-06")?.views).toBe(1);
  });

  it("source 'daily' rolls yesterday (cron at 00:15 UTC)", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch(batchOf({ type: "view", ts: "2026-11-05T23:59:00.000Z" }));
    const result = await service.rollupDay({ source: "daily" });
    expect(result.day).toBe("2026-11-05");
    expect(daily.get("018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80|2026-11-05")?.views).toBe(1);
  });

  it("emits a zero row for a targeted but empty day (resets stale rollups)", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    const result = await service.rollupDay({ documentId: "doc-empty", day: "2026-11-01" });
    expect(result.rows).toBe(1);
    expect(daily.get("doc-empty|2026-11-01")).toEqual({
      documentId: "doc-empty",
      day: "2026-11-01",
      views: 0,
      starts: 0,
      completes: 0,
    });
  });

  it("rolls up every document that emitted events when no documentId is given", async () => {
    const { repo, daily } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch({ documentId: "doc-aaa", events: [{ type: "view", sessionId: "visitor-1234" }] });
    await service.ingestBatch({ documentId: "doc-bbb", events: [{ type: "view", sessionId: "visitor-1234" }] });
    const result = await service.rollupDay({ day: "2026-11-06" });
    expect(result.documents).toBe(2);
    expect(daily.size).toBe(2);
  });

  it("validates day keys and document ids", async () => {
    const { repo } = fakeRepo();
    const service = makeService(repo);
    await expect(service.rollupDay({ day: "2026-11" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.rollupDay({ documentId: "bad id!" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("AnalyticsService.ensurePartitions", () => {
  it("creates current + next month partitions after ensuring the parent table", async () => {
    const { repo, calls } = fakeRepo();
    const service = makeService(repo);
    const result = await service.ensurePartitions();
    expect(calls.ensureParentTable).toBe(1);
    expect(result.created).toBe(2);
    expect(result.plan.map((item) => item.name)).toEqual(["analytics_events_y2026m11", "analytics_events_y2026m12"]);
    expect(calls.partitions[0]).toEqual(result.plan);
  });

  it("supports a custom horizon and validates the input", async () => {
    const { repo, calls } = fakeRepo();
    const service = makeService(repo);
    const result = await service.ensurePartitions({ monthsAhead: 3 });
    expect(result.created).toBe(4);
    expect(calls.partitions[0]).toHaveLength(4);
    await expect(service.ensurePartitions({ monthsAhead: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.ensurePartitions({ monthsAhead: 13 })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("AnalyticsService.getDropOff (gated by can(workspaceId,'advanced_analytics'))", () => {
  it("returns steps when the gate allows (open stub until T23)", async () => {
    const { repo } = fakeRepo();
    const service = makeService(repo);
    await service.ingestBatch(
      batchOf(
        { type: "question_view", blockId: "b1" },
        { type: "question_pass", blockId: "b1" },
        { type: "question_view", blockId: "b2" },
      ),
    );
    const result = await service.getDropOff("018f6a2b-7c3d-7a2e-9f11-3b8c5d6e7f80", { kind: "preset", preset: "30d" }, {
      workspaceId: "ws-1",
      can: openAdvancedAnalyticsGate,
    });
    expect(result.enabled).toBe(true);
    expect(result.steps.map((step) => step.blockId)).toEqual(["b1", "b2"]);
    expect(result.steps[1]).toMatchObject({ views: 1, passes: 0, dropOffRate: 1 });
  });

  it("throws PLAN_LIMIT when the capability is missing", async () => {
    const { repo } = fakeRepo();
    const service = makeService(repo);
    await expect(
      service.getDropOff("doc1", { kind: "preset", preset: "30d" }, {
        workspaceId: "ws-1",
        can: async () => false,
      }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT", details: { capability: "advanced_analytics" } });
  });
});

describe("type-level port sanity", () => {
  it("event type union matches the beacon contract", () => {
    const types: AnalyticsEventType[] = ["view", "start", "question_view", "question_pass", "complete"];
    expect(types).toHaveLength(5);
  });
});
