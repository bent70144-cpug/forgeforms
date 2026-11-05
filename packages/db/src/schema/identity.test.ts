// Schema-shape tests — everything verifiable WITHOUT a live database.
// The migration SQL itself is compared against spec §6 by the generator
// (drizzle-kit) and reviewed in CI; here we assert the Drizzle objects carry
// the spec'd columns, constraints and defaults.
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  apiTokenScopes,
  apiTokens,
  identityTables,
  membershipRoleValues,
  memberships,
  users,
  workspacePlanValues,
  workspaces,
} from "./identity.js";

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

function col(table: Parameters<typeof getTableConfig>[0], name: string) {
  const found = getTableConfig(table).columns.find((c) => c.name === name);
  expect(found, `column ${name} missing`).toBeDefined();
  return found!;
}

/** Column-level `.unique()` + table-level unique constraints/indexes. */
function uniqueColumnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  const config = getTableConfig(table);
  return [
    ...config.columns.filter((c) => c.isUnique).map((c) => c.name),
    ...config.uniqueConstraints.flatMap((u) => u.columns.map((c) => c.name)),
    ...config.indexes
      .filter((i) => i.config.unique)
      // index columns can be raw SQL expressions — keep only named columns
      .flatMap((i) => i.config.columns.map((c) => ("name" in c ? (c.name as string) : ""))),
  ];
}

describe("users (spec §6)", () => {
  it("has the spec'd snake_case columns", () => {
    expect(columnNames(users)).toEqual([
      "id",
      "email",
      "name",
      "password_hash",
      "email_verified_at",
      "created_at",
    ]);
  });

  it("email is citext, not null, unique (case-insensitive logins)", () => {
    const email = col(users, "email");
    expect(email.getSQLType()).toBe("citext");
    expect(email.notNull).toBe(true);
    expect(uniqueColumnNames(users)).toContain("email");
  });

  it("password_hash is nullable text (argon2id hash, absent for OAuth-only users)", () => {
    const hash = col(users, "password_hash");
    expect(hash.getSQLType()).toBe("text");
    expect(hash.notNull).toBe(false);
  });

  it("created_at is timestamptz with a default", () => {
    const createdAt = col(users, "created_at");
    expect(createdAt.getSQLType()).toBe("timestamp with time zone");
    expect(createdAt.notNull).toBe(true);
    expect(createdAt.hasDefault).toBe(true);
  });
});

describe("workspaces (spec §6)", () => {
  it("has the spec'd columns", () => {
    expect(columnNames(workspaces)).toEqual([
      "id",
      "name",
      "slug",
      "plan",
      "stripe_customer_id",
      "stripe_subscription_id",
      "created_at",
    ]);
  });

  it("plan defaults to 'free' (free | pro | business)", () => {
    const plan = col(workspaces, "plan");
    expect(plan.getSQLType()).toBe("text");
    expect(plan.notNull).toBe(true);
    expect(plan.hasDefault).toBe(true);
    expect(workspacePlanValues).toEqual(["free", "pro", "business"]);
  });

  it("slug is unique", () => {
    expect(uniqueColumnNames(workspaces)).toContain("slug");
  });
});

describe("memberships (spec §6)", () => {
  it("has composite PK (workspace_id, user_id)", () => {
    const config = getTableConfig(memberships);
    const pks = config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name));
    expect(pks).toEqual(["workspace_id", "user_id"]);
  });

  it("has two cascade FKs (workspaces, users)", () => {
    expect(getTableConfig(memberships).foreignKeys).toHaveLength(2);
    expect(membershipRoleValues).toEqual(["owner", "admin", "editor", "viewer"]);
  });
});

describe("api_tokens (spec §6)", () => {
  it("has the spec'd columns incl. scopes text[]", () => {
    expect(columnNames(apiTokens)).toEqual([
      "id",
      "workspace_id",
      "name",
      "token_hash",
      "scopes",
      "last_used_at",
      "created_at",
    ]);
    expect(col(apiTokens, "scopes").getSQLType()).toBe("text[]");
  });

  it("token_hash is not null and unique (sha256; plaintext shown once)", () => {
    const tokenHash = col(apiTokens, "token_hash");
    expect(tokenHash.notNull).toBe(true);
    expect(uniqueColumnNames(apiTokens)).toContain("token_hash");
  });

  it("scopes come from the documented set", () => {
    expect(apiTokenScopes).toEqual(["docs:read", "docs:write", "docs:publish", "submissions:read"]);
  });

  it("has a cascade FK to workspaces", () => {
    expect(getTableConfig(apiTokens).foreignKeys).toHaveLength(1);
  });
});

describe("schema surface", () => {
  it("exports exactly the four identity tables", () => {
    expect(Object.keys(identityTables).sort()).toEqual(["apiTokens", "memberships", "users", "workspaces"]);
  });
});
