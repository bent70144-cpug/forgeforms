// Monthly AI quota (spec §15 M8, issue #27): per-workspace counter over the
// `usage_counters` table (spec §6) + the single billing gate `can()` (§13).
// The quota check runs BEFORE the provider call; usage is persisted via the
// injected repo — never inline SQL here.
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { type CanFn } from "./types";

export type Plan = "free" | "pro" | "business";

export const AI_CAPABILITY = "ai";
export const AI_DRAFT_METRIC = "ai.draft";
export const AI_EDIT_METRIC = "ai.edit";
export type AiMetric = typeof AI_DRAFT_METRIC | typeof AI_EDIT_METRIC;

// SPEC-NOTE: issue #27 says "X drafts/month per plan from issue body
// (default free=5)". The issue body pins free=5 but not pro/business; those
// two are conservative stand-ins until billing (T23) publishes real numbers.
export const AI_MONTHLY_LIMITS: Record<Plan, number> = {
  free: 5,
  pro: 100,
  business: 500,
};

export function planLimitFor(plan: Plan): number {
  return AI_MONTHLY_LIMITS[plan] ?? AI_MONTHLY_LIMITS.free;
}

/**
 * Monthly usage counter, mirroring the `usage_counters` table shape
 * (workspace_id, period, metric) from spec §6. The Postgres implementation
 * lives in packages/db/src/repositories/ai-usage.ts.
 */
export interface AiUsageRepo {
  currentCount(input: { workspaceId: string; metric: string; period: string }): Promise<number>;
  increment(input: { workspaceId: string; metric: string; period: string }): Promise<number>;
}

/** Billing period key, e.g. "2026-11" (UTC month, matches spec §6 examples). */
export function usagePeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type QuotaDeps = {
  usage: AiUsageRepo;
  /** The one billing gate (spec §13). Returns false → AI not entitled. */
  can: CanFn;
  /** Plan lookup for the workspace (drives the monthly limit). */
  getPlan: (workspaceId: string) => Promise<Plan>;
};

export type QuotaState = {
  plan: Plan;
  used: number;
  limit: number;
  period: string;
  metric: string;
};

export function planLimitError(details: Record<string, unknown>): AppError {
  // spec §13: over-limit → PLAN_LIMIT (HTTP 402) with capability + requiredPlan.
  return new AppError("PLAN_LIMIT", "Monthly AI quota exhausted for this plan", [
    { path: "capability", message: AI_CAPABILITY },
    { path: "requiredPlan", message: "pro" },
    ...Object.entries(details).map(([k, v]) => ({ path: k, message: String(v) })),
  ]);
}

/**
 * Checks the AI entitlement and the monthly counter. MUST be awaited before
 * any provider call — enforced by runAiDraft/runAiEdit and asserted in tests.
 */
export async function checkAiQuota(
  ctx: Ctx,
  deps: QuotaDeps,
  metric: AiMetric,
): Promise<Result<QuotaState>> {
  const entitled = await deps.can(ctx.workspaceId, AI_CAPABILITY);
  if (!entitled) {
    return err(
      planLimitError({
        reason: "capability-not-entitled",
        plan: await deps.getPlan(ctx.workspaceId).catch(() => "free" as const),
      }),
    );
  }

  const plan = await deps.getPlan(ctx.workspaceId);
  const limit = planLimitFor(plan);
  const period = usagePeriod(ctx.now());
  const used = await deps.usage.currentCount({
    workspaceId: ctx.workspaceId,
    metric,
    period,
  });

  if (used >= limit) {
    return err(planLimitError({ used, limit, period, metric }));
  }

  return ok({ plan, used, limit, period, metric });
}

/**
 * Persists one successful AI action. Called only AFTER the provider call and
 * validation succeed, so provider outages never burn quota (deliberate:
 * the counter charges for delivered work, not attempts).
 */
export async function recordAiUsage(
  ctx: Ctx,
  deps: QuotaDeps,
  metric: AiMetric,
): Promise<number> {
  return deps.usage.increment({
    workspaceId: ctx.workspaceId,
    metric,
    period: usagePeriod(ctx.now()),
  });
}
