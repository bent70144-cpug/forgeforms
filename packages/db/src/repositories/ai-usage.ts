// Monthly AI usage counter over the `usage_counters` table (spec §6:
// primary key (workspace_id, period, metric)). Implementation of the
// `AiUsageRepo` interface consumed by @formforge/core's ai/quota module —
// structurally identical, deliberately without a cross-package import
// (packages/db must not depend on core; see file ownership rules).
//
// INTEGRATION-DEBT: awaiting T02 — no drizzle client or table definition
// exists yet, so this repository speaks raw SQL over an injected minimal
// pool. When T02 lands: move the usage_counters table into src/schema/**,
// accept the shared drizzle client, and re-export this repository from
// packages/db/src/index.ts so callers stop constructing it themselves.
export interface PgLikePool {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type UsageCountInput = {
  workspaceId: string;
  metric: string;
  period: string;
};

// Matches the metric names exported by @formforge/core/ai (ai.draft / ai.edit).
export const AI_USAGE_DRAFT = "ai.draft";
export const AI_USAGE_EDIT = "ai.edit";

const SELECT_SQL =
  "select value from usage_counters where workspace_id = $1 and period = $2 and metric = $3 limit 1";

const INCREMENT_SQL = `insert into usage_counters (workspace_id, period, metric, value)
values ($1, $2, $3, 1)
on conflict (workspace_id, period, metric)
do update set value = usage_counters.value + 1
returning value`;

export class PgAiUsageRepo {
  private readonly pool: PgLikePool;

  constructor(pool: PgLikePool) {
    this.pool = pool;
  }

  async currentCount(input: UsageCountInput): Promise<number> {
    const result = await this.pool.query(SELECT_SQL, [
      input.workspaceId,
      input.period,
      input.metric,
    ]);
    const row = result.rows[0];
    if (!row) return 0;
    return Number(row.value ?? 0);
  }

  /** Atomic upsert-increment; returns the new monthly value. */
  async increment(input: UsageCountInput): Promise<number> {
    const result = await this.pool.query(INCREMENT_SQL, [
      input.workspaceId,
      input.period,
      input.metric,
    ]);
    const row = result.rows[0];
    if (!row) {
      throw new Error("usage_counters increment returned no row");
    }
    return Number(row.value);
  }
}
