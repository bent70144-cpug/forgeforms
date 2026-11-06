// @formforge/core — analytics service (spec §12 `analytics` queue: ingest-batch
// + rollup; §14.1.5 Analytics tab data). The repository is a PORT injected by
// the composition root (Next route / BullMQ worker); this module stays pure of
// I/O and uses only `ctx.now()` for time (spec §4).

import { AppError } from "../shared/errors.ts";;
import { type Ctx } from "../shared/ctx.ts";;
import { z } from "zod";
import { addUtcDays, buildDailySeries, computeDropOff, computeKpis, dayKeyToDate, resolveRange, utcDayKey } from "./bucket";
import { buildPixelEvent, parseBeaconBatch } from "./beacon";
import { DOCUMENT_ID_RE } from "./beacon";
import {
  ANALYTICS_PARENT_TABLE,
  planMonthlyPartitions,
  type PartitionPlanItem,
} from "./partitions";
import { ensureZeroRow, mergeRollupsIntoSeries, rollupEventsToDaily } from "./rollup";
import type {
  AnalyticsEventType,
  AnalyticsRange,
  AnalyticsSummary,
  DailyRollupRow,
  DropOffStep,
  RangeSpec,
  RawAnalyticsEvent,
} from "./types";

/** Port implemented by `@formforge/db` (drizzle) — see repositories/analytics.ts. */
export interface AnalyticsRepositoryPort {
  /** Batch insert raw events; returns the number of rows inserted. */
  insertEvents(rows: readonly RawAnalyticsEvent[]): Promise<number>;
  /** Raw events for a document in the half-open range, ordered by ts. */
  listEvents(documentId: string, range: AnalyticsRange, types?: readonly AnalyticsEventType[]): Promise<RawAnalyticsEvent[]>;
  /** `analytics_daily` rows for the inclusive day-key span. */
  listDaily(documentId: string, fromDay: string, toDay: string): Promise<DailyRollupRow[]>;
  /** Upsert (REPLACE counts) — the idempotency guarantee of the rollup job. */
  upsertDaily(rows: readonly DailyRollupRow[]): Promise<void>;
  /** Distinct document ids that emitted events in the range (cron rollups). */
  listDocumentIdsWithEvents(range: AnalyticsRange): Promise<string[]>;
  /** Idempotent parent-table DDL (safe on fresh databases / before T02 migration). */
  ensureParentTable(): Promise<void>;
  /** Idempotent monthly partition DDL from the pure planner. */
  ensurePartitions(plan: readonly PartitionPlanItem[]): Promise<void>;
}

/** `billing.can` contract (spec §4 feature gating, §13). */
export type AdvancedAnalyticsGate = (workspaceId: string, capability: "advanced_analytics") => Promise<boolean>;

// SPEC-NOTE: issue #19 — drop-off gating uses `can(workspaceId,'advanced_analytics')`
// with an OPEN STUB until T23 (billing) lands; the integrator must flip this to
// the real entitlement check. Never inline plan checks elsewhere.
export const openAdvancedAnalyticsGate: AdvancedAnalyticsGate = async () => true;

export interface AnalyticsServiceDeps {
  repo: AnalyticsRepositoryPort;
  ctx: Ctx;
}

/** BullMQ payload for the `analytics` queue's `rollup` job (spec §12). */
export const RollupJobPayloadSchema = z.object({
  documentId: z.string().regex(DOCUMENT_ID_RE).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["hourly", "daily"]).optional(),
});

/** BullMQ payload for the maintenance queue's `create-partitions` job. */
export const PartitionsJobPayloadSchema = z.object({
  monthsAhead: z.number().int().min(1).max(12).optional(),
});

/** Grouped export for job registration sites. */
export const AnalyticsBatchSchemas = {
  rollupPayload: RollupJobPayloadSchema,
  partitionsPayload: PartitionsJobPayloadSchema,
} as const;

export interface RollupDayInput {
  documentId?: string;
  /** `YYYY-MM-DD` UTC day key; defaults to "today" in UTC. */
  day?: string;
  /** Job provenance: `hourly` rolls today, `daily` rolls yesterday (spec §12). */
  source?: "hourly" | "daily";
}

export interface RollupDayResult {
  day: string;
  documents: number;
  rows: number;
}

export interface AnalyticsService {
  /** Validate + hash + insert a beacon batch (spec §10.1 `POST /api/public/a`). */
  ingestBatch(input: unknown): Promise<{ inserted: number }>;
  /** Insert already-normalized events (GET pixel path). */
  recordEvents(events: readonly RawAnalyticsEvent[]): Promise<{ inserted: number }>;
  /** KPIs + 30d-trend summary; trend values come from `analytics_daily` rollups. */
  getAnalytics(documentId: string, spec: RangeSpec): Promise<AnalyticsSummary>;
  /** Recompute-and-replace one day of `analytics_daily` (idempotent, spec §12). */
  rollupDay(input?: RollupDayInput): Promise<RollupDayResult>;
  /** Ensure parent + monthly partitions (current + next month by default). */
  ensurePartitions(input?: { monthsAhead?: number }): Promise<{ created: number; plan: PartitionPlanItem[] }>;
  /** Per-question drop-off; gated by `can(workspaceId, 'advanced_analytics')`. */
  getDropOff(
    documentId: string,
    spec: RangeSpec,
    gate?: { workspaceId: string; can: AdvancedAnalyticsGate },
  ): Promise<{ enabled: boolean; steps: DropOffStep[] }>;
}

export function createAnalyticsService(deps: AnalyticsServiceDeps): AnalyticsService {
  const { repo, ctx } = deps;

  async function listForRange(documentId: string, spec: RangeSpec, types?: readonly AnalyticsEventType[]) {
    const range = resolveRange(spec, ctx.now());
    const events = await repo.listEvents(documentId, range, types);
    return { range, events };
  }

  return {
    async ingestBatch(input) {
      const parsed = parseBeaconBatch(input, () => ctx.now());
      if (!parsed.ok) throw parsed.error;
      await repo.insertEvents(parsed.value.events);
      return { inserted: parsed.value.events.length };
    },

    async recordEvents(events) {
      if (events.length === 0) return { inserted: 0 };
      await repo.insertEvents(events);
      return { inserted: events.length };
    },

    async getAnalytics(documentId, spec) {
      const { range, events } = await listForRange(documentId, spec);
      const series = buildDailySeries(events, range);
      const fromDay = utcDayKey(range.from);
      const toDay = utcDayKey(addUtcDays(range.to, -1));
      const daily = await repo.listDaily(documentId, fromDay, toDay);
      return {
        documentId,
        range,
        kpis: computeKpis(events),
        series: mergeRollupsIntoSeries(series, daily),
        daily,
      };
    },

    async rollupDay(input = {}) {
      const now = ctx.now();
      const source = input.source ?? "hourly";
      const day =
        input.day ??
        (source === "daily"
          ? utcDayKey(addUtcDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -1))
          : utcDayKey(now));
      const documentId = input.documentId;
      if (documentId !== undefined && !DOCUMENT_ID_RE.test(documentId)) {
        throw new AppError("VALIDATION", "Invalid documentId for rollup");
      }
      const from = dayKeyToDate(day); // throws VALIDATION on a bad key
      const to = addUtcDays(from, 1);
      const targets = documentId
        ? [documentId]
        : await repo.listDocumentIdsWithEvents({ from, to });

      const rows: DailyRollupRow[] = [];
      for (const target of targets) {
        const events = await repo.listEvents(target, { from, to });
        // Always emit a row (zeros when the day is empty) so a re-run RESETS
        // stale values instead of leaving them behind — see ensureZeroRow.
        rows.push(...ensureZeroRow(rollupEventsToDaily(events), target, day));
      }
      if (rows.length > 0) await repo.upsertDaily(rows);
      return { day, documents: targets.length, rows: rows.length };
    },

    async ensurePartitions(input = {}) {
      const monthsAhead = input.monthsAhead ?? 1;
      if (!Number.isInteger(monthsAhead) || monthsAhead < 1 || monthsAhead > 12) {
        throw new AppError("VALIDATION", "monthsAhead must be an integer between 1 and 12");
      }
      // current month + `monthsAhead` more (default: current + next month).
      const plan = planMonthlyPartitions({
        parent: ANALYTICS_PARENT_TABLE,
        from: ctx.now(),
        months: monthsAhead + 1,
      });
      await repo.ensureParentTable();
      await repo.ensurePartitions(plan);
      return { created: plan.length, plan };
    },

    async getDropOff(documentId, spec, gate) {
      if (gate) {
        const allowed = await gate.can(gate.workspaceId, "advanced_analytics");
        if (!allowed) {
          throw new AppError("PLAN_LIMIT", "Advanced analytics requires an upgrade", [
            { path: "capability", message: "advanced_analytics" },
            { path: "requiredPlan", message: "pro" },
          ]);
        }
      }
      const { events } = await listForRange(documentId, spec, ["question_view", "question_pass"]);
      return { enabled: true, steps: computeDropOff(events) };
    },
  };
}

/** Build a normalized event from GET-pixel query params (see beacon.ts). */
export function pixelEventFromQuery(
  query: { d?: string; e?: string; s?: string; b?: string },
  now: () => Date,
): RawAnalyticsEvent | null {
  return buildPixelEvent(
    { documentId: query.d, type: query.e, sessionId: query.s, blockId: query.b },
    now,
  );
}
