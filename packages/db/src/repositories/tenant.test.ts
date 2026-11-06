// DB-free unit tests for the tenant scope helpers (T04).
//
// The transaction behavior itself is proven by the CI-gated integration test
// (repositories/tenant.rls.test.ts, RUN_DB_TESTS=1). Here we pin the parts
// that must hold WITHOUT a database:
//   * non-uuid workspace/user ids never enter a scope transaction
//     (the preAuth "system" sentinel must be rejected — fail closed),
//   * the scope SQL is PARAMETERIZED (no string interpolation → no injection),
//   * the role assumption targets formforge_app.
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { AppError } from "@formforge/core";
import {
  assertWorkspaceId,
  tenantRoleSql,
  tenantScopeSql,
  userScopeSql,
  withTenantScope,
} from "./tenant.ts";

const dialect = new PgDialect();

describe("assertWorkspaceId", () => {
  it("accepts canonical and mixed-case uuids (lowercased)", () => {
    expect(assertWorkspaceId("0B9C9C63-6A62-4E2B-B6C7-3E1C0B54A1A0")).toBe(
      "0b9c9c63-6a62-4e2b-b6c7-3e1c0b54a1a0",
    );
  });

  it("rejects the preAuth 'system' sentinel", () => {
    expect(() => assertWorkspaceId("system")).toThrow(AppError);
  });

  it("rejects non-uuid garbage", () => {
    for (const bad of ["", "doc_2rSC1vBc", "1; drop table users", "not-a-uuid"]) {
      expect(() => assertWorkspaceId(bad)).toThrow(AppError);
    }
  });
});

describe("tenantScopeSql / userScopeSql / tenantRoleSql", () => {
  it("renders the workspace id as a bind parameter (injection-safe)", () => {
    const rendered = dialect.sqlToQuery(tenantScopeSql("0b9c9c63-6a62-4e2b-b6c7-3e1c0b54a1a0"));
    expect(rendered.sql).toBe("select set_config('app.workspace_id', $1, true)");
    expect(rendered.params).toEqual(["0b9c9c63-6a62-4e2b-b6c7-3e1c0b54a1a0"]);
  });

  it("renders the user id as a bind parameter", () => {
    const rendered = dialect.sqlToQuery(userScopeSql("11111111-2222-4333-8444-555555555555"));
    expect(rendered.sql).toBe("select set_config('app.user_id', $1, true)");
    expect(rendered.params).toEqual(["11111111-2222-4333-8444-555555555555"]);
  });

  it("assumes the restricted formforge_app role", () => {
    expect(dialect.sqlToQuery(tenantRoleSql()).sql).toBe("set local role formforge_app");
  });

  it("scope SQL builders reject sentinel ids before touching SQL", () => {
    expect(() => tenantScopeSql("system")).toThrow(AppError);
    expect(() => userScopeSql("system")).toThrow(AppError);
  });
});

describe("withTenantScope", () => {
  it("rejects non-uuid workspace ids: transaction opens, executes nothing, rolls back", async () => {
    const executed: string[] = [];
    const tx = {
      execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        executed.push(dialect.sqlToQuery(query).sql);
        return { rows: [] };
      }),
    };
    const db = {
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<string>) => fn(tx)),
    };
    await expect(
      withTenantScope(db as never, "system", async () => "x"),
    ).rejects.toThrow(AppError);
    // the scope statement itself never reaches the wire (fail closed)
    expect(executed).toEqual([]);
  });

  it("sets scope + role before running the callback, inside one transaction", async () => {
    const executed: string[] = [];
    const tx = {
      execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        executed.push(dialect.sqlToQuery(query).sql);
        return { rows: [] };
      }),
    };
    const db = {
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<string>) => fn(tx)),
    };
    const result = await withTenantScope(
      db as never,
      "0b9c9c63-6a62-4e2b-b6c7-3e1c0b54a1a0",
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // order matters: scope first, role second, callback last
    expect(executed).toEqual([
      "select set_config('app.workspace_id', $1, true)",
      "set local role formforge_app",
    ]);
  });
});
