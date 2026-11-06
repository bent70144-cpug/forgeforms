// T19 (issue #19) — BullMQ job handlers for the `analytics` queue (spec §12):
//   • `rollup`            — recompute-and-replace `analytics_daily` for a day
//                           (cron: hourly for today, daily for yesterday)
//   • `create-partitions` — ensure monthly range partitions (current + next)
//
// INTEGRATION-DEBT: registration in apps/worker/src/index.ts is BLOCKED because
// that file is owned by T17 (issue #17). The lead/T17 should register these
// handlers like:
//   import { createAnalyticsJobHandlers, ANALYTICS_QUEUE_NAME, ANALYTICS_CRON_SCHEDULES }
//     from "./jobs/analytics-rollup";
//   const handlers = createAnalyticsJobHandlers();          // reads DATABASE_URL
//   // Worker(ANALYTICS_QUEUE_NAME, (job) => handlers[job.name]?.(job.payload))
//   // + repeatable jobs per ANALYTICS_CRON_SCHEDULES (rollup hourly/daily, partitions monthly)
// Handlers are BullMQ-agnostic (plain payload objects) so registration style is free.

import {
  AnalyticsBatchSchemas,
  createAnalyticsService,
  type AnalyticsRepositoryPort,
} from "../../../../packages/core/src/analytics";
import {
  getDefaultAnalyticsRepository,
  type AnalyticsRepository,
} from "../../../../packages/db/src/repositories/analytics";

export const ANALYTICS_QUEUE_NAME = "analytics";

export type AnalyticsJobName = "rollup" | "create-partitions";

export interface AnalyticsJobHandlers {
  rollup(payload: unknown): Promise<{ day: string; documents: number; rows: number }>;
  "create-partitions"(payload: unknown): Promise<{ created: number; plan: unknown[] }>;
}

export interface AnalyticsJobDeps {
  /** Defaults to the process-wide repository from DATABASE_URL. */
  repo?: AnalyticsRepositoryPort | AnalyticsRepository;
  /** Injectable clock (spec §4); defaults to the wall clock at this boundary. */
  now?: () => Date;
}

/**
 * Build the job handlers. Each handler validates its payload with Zod and
 * throws on malformed input (BullMQ retries per queue config).
 */
export function createAnalyticsJobHandlers(deps: AnalyticsJobDeps = {}): AnalyticsJobHandlers {
  const repo = deps.repo ?? getDefaultAnalyticsRepository();
  if (!repo) {
    throw new Error(
      "analytics jobs need a repository: inject one or set DATABASE_URL (see packages/db/src/repositories/analytics.ts)",
    );
  }
  // SPEC-NOTE: the wall-clock default lives at this composition boundary only;
  // the service itself strictly uses the injected ctx.now().
  const service = createAnalyticsService({ repo, ctx: systemCtx(deps.now ?? (() => new Date())) });

  return {
    async rollup(payload) {
      const parsed = AnalyticsBatchSchemas.rollupPayload.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new Error(`rollup payload rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      }
      return service.rollupDay(parsed.data);
    },
    async "create-partitions"(payload) {
      const parsed = AnalyticsBatchSchemas.partitionsPayload.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new Error(`create-partitions payload rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      }
      const result = await service.ensurePartitions(parsed.data);
      return { created: result.created, plan: result.plan };
    },
  };
}

/** Repeatable-job definitions for T17's registration (all times UTC). */
export const ANALYTICS_CRON_SCHEDULES = {
  /** Hourly for today (spec §12 "rollup daily (hourly for today)"). */
  rollupHourlyToday: {
    name: "analytics:rollup:hourly",
    pattern: "5 * * * *",
    payload: { source: "hourly" },
  },
  /** Daily rollup for yesterday at 00:15 UTC. */
  rollupDaily: {
    name: "analytics:rollup:daily",
    pattern: "15 0 * * *",
    payload: { source: "daily" },
  },
  /** Monthly: keep current + next month partitioned (1st of month, 03:00 UTC). */
  createPartitions: {
    name: "analytics:create-partitions",
    pattern: "0 3 1 * *",
    payload: { monthsAhead: 1 },
  },
} as const;

// INTEGRATION-DEBT (lead): full Ctx arrives with T03/T04 session wiring; the
// analytics plane is unauthenticated/public, so a system ctx is correct here.
function systemCtx(now: () => Date): import("@formforge/core").Ctx {
  return {
    workspaceId: "system",
    actor: { type: "system", id: "analytics" },
    requestId: "analytics-" + Math.random().toString(36).slice(2, 10),
    now,
  };
}
