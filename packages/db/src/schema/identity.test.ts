// Schema-shape tests — everything verifiable WITHOUT a live database.
// The migration SQL itself is compared against spec §6 by the generator
// (drizzle-kit) and reviewed in CI; here we assert the Drizzle objects carry
// the spec'd columns, constraints and defaults.
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  apiTokenScopes,
  apiTokens,
  authTokenKinds,
  authTokens,
  identityTables,
  membershipRoleValues,
  memberships,
  sessions,
  users,
  workspacePlanValues,
  workspaces,
} from "./identity.ts";

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

describe("sessions (ticket #3: DB-backed sessions, formalized in T05)", () => {
  it("has the hashed-token columns and a cascade FK to users", () => {
    expect(columnNames(sessions)).toEqual(["id", "user_id", "token_hash", "expires_at", "created_at"]);
    const tokenHash = col(sessions, "token_hash");
    expect(tokenHash.notNull).toBe(true);
    expect(uniqueColumnNames(sessions)).toContain("token_hash");
    expect(getTableConfig(sessions).foreignKeys).toHaveLength(1);
  });
});

describe("auth_tokens (ticket #5: reset + verification tokens)", () => {
  it("has the single-use hashed-token columns", () => {
    expect(columnNames(authTokens)).toEqual([
      "id",
      "user_id",
      "kind",
      "token_hash",
      "expires_at",
      "consumed_at",
      "created_at",
    ]);
  });

  it("token_hash is unique + not null (sha256 at rest; raw token never stored)", () => {
    const tokenHash = col(authTokens, "token_hash");
    expect(tokenHash.notNull).toBe(true);
    expect(uniqueColumnNames(authTokens)).toContain("token_hash");
  });

  it("consumed_at is nullable (single-use marker set atomically)", () => {
    expect(col(authTokens, "consumed_at").notNull).toBe(false);
    expect(col(authTokens, "expires_at").notNull).toBe(true);
  });

  it("has a cascade FK to users and a (user_id, kind) lookup index", () => {
    const config = getTableConfig(authTokens);
    expect(config.foreignKeys).toHaveLength(1);
    const indexColumns = config.indexes.flatMap((i) =>
      i.config.columns.map((c) => ("name" in c ? (c.name as string) : "")),
    );
    expect(indexColumns).toEqual(expect.arrayContaining(["user_id", "kind"]));
    expect(authTokenKinds).toEqual(["password_reset", "email_verify"]);
  });
});

describe("schema surface", () => {
  it("exports exactly the identity tables", () => {
    expect(Object.keys(identityTables).sort()).toEqual([
      "apiTokens",
      "authTokens",
      "memberships",
      "sessions",
      "users",
      "workspaces",
    ]);
  });
});
