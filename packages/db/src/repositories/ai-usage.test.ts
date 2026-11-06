// PgAiUsageRepo against a scripted fake pool — verifies the SQL contract
// (parameter order, atomic upsert-increment) without a database.
import { describe, expect, it } from "vitest";
import { PgAiUsageRepo, type PgLikePool } from "./ai-usage";

function scriptedPool(
  handler: (sql: string, values: unknown[]) => Array<Record<string, unknown>>,
): { pool: PgLikePool; calls: Array<{ sql: string; values: unknown[] }> } {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    pool: {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values: values ?? [] });
        return { rows: handler(sql, values ?? []) };
      },
    },
  };
}

describe("PgAiUsageRepo", () => {
  it("currentCount returns 0 when no row exists", async () => {
    const { pool } = scriptedPool(() => []);
    const repo = new PgAiUsageRepo(pool);
    const count = await repo.currentCount({
      workspaceId: "ws_1",
      metric: "ai.draft",
      period: "2026-11",
    });
    expect(count).toBe(0);
  });

  it("currentCount returns the stored value as a number", async () => {
    const { pool } = scriptedPool(() => [{ value: "7" }]); // bigint arrives as string
    const repo = new PgAiUsageRepo(pool);
    const count = await repo.currentCount({
      workspaceId: "ws_1",
      metric: "ai.draft",
      period: "2026-11",
    });
    expect(count).toBe(7);
  });

  it("increment upserts atomically and returns the new value", async () => {
    const { pool, calls } = scriptedPool(() => [{ value: 3 }]);
    const repo = new PgAiUsageRepo(pool);
    const value = await repo.increment({
      workspaceId: "ws_1",
      metric: "ai.edit",
      period: "2026-11",
    });
    expect(value).toBe(3);
    expect(calls).toHaveLength(1);
    const { sql, values } = calls[0] as { sql: string; values: unknown[] };
    expect(sql).toContain("on conflict (workspace_id, period, metric)");
    expect(sql).toContain("usage_counters.value + 1");
    expect(values).toEqual(["ws_1", "2026-11", "ai.edit"]);
  });

  it("raises when the increment query unexpectedly returns no row", async () => {
    const { pool } = scriptedPool(() => []);
    const repo = new PgAiUsageRepo(pool);
    await expect(
      repo.increment({ workspaceId: "ws_1", metric: "ai.draft", period: "2026-11" }),
    ).rejects.toThrow("returned no row");
  });
});
