// Schema-shape tests for the tenancy tables (T04) — no live database needed.
// Columns mirror spec §6 DDL verbatim (snake_case, timestamptz, cascade FKs).
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  answers,
  documentStatusValues,
  documentTypeValues,
  documents,
  documentVersions,
  snapshots,
  submissionStatusValues,
  submissions,
  tenancyTables,
} from "./tenancy.ts";

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((c) => c.name);
}

function col(table: Parameters<typeof getTableConfig>[0], name: string) {
  const found = getTableConfig(table).columns.find((c) => c.name === name);
  expect(found, `column ${name} missing`).toBeDefined();
  return found!;
}

function indexColumnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.flatMap((i) =>
    i.config.columns.map((c) => ("name" in c ? (c.name as string) : "")),
  );
}

describe("documents (spec §6)", () => {
  it("has the spec'd snake_case columns", () => {
    expect(columnNames(documents)).toEqual([
      "id",
      "workspace_id",
      "type",
      "title",
      "slug",
      "status",
      "rev",
      "draft",
      "published_version_id",
      "created_by",
      "created_at",
      "updated_at",
    ]);
  });

  it("workspace_id is not null with a cascade FK", () => {
    const workspaceId = col(documents, "workspace_id");
    expect(workspaceId.notNull).toBe(true);
    expect(getTableConfig(documents).foreignKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("status defaults to 'draft'; rev defaults to 0 (optimistic concurrency)", () => {
    const status = col(documents, "status");
    expect(status.notNull).toBe(true);
    expect(status.hasDefault).toBe(true);
    const rev = col(documents, "rev");
    expect(rev.getSQLType()).toBe("integer");
    expect(rev.hasDefault).toBe(true);
  });

  it("draft is jsonb not null", () => {
    const draft = col(documents, "draft");
    expect(draft.getSQLType()).toBe("jsonb");
    expect(draft.notNull).toBe(true);
  });

  it("has the (workspace_id, updated_at desc) index", () => {
    expect(indexColumnNames(documents)).toContain("workspace_id");
    expect(indexColumnNames(documents)).toContain("updated_at");
  });
});

describe("document_versions (spec §6)", () => {
  it("has the spec'd columns", () => {
    expect(columnNames(documentVersions)).toEqual([
      "id",
      "document_id",
      "workspace_id",
      "schema_version",
      "body",
      "created_by",
      "created_at",
    ]);
  });

  it("body is immutable jsonb not null", () => {
    expect(col(documentVersions, "body").getSQLType()).toBe("jsonb");
    expect(col(documentVersions, "body").notNull).toBe(true);
  });
});

describe("snapshots (spec §6)", () => {
  it("has one row per document (document_id is the PK)", () => {
    expect(col(snapshots, "document_id").primary).toBe(true);
    expect(columnNames(snapshots)).toEqual([
      "document_id",
      "version_id",
      "rendered",
      "etag",
      "built_at",
    ]);
  });

  it("rendered is jsonb not null and etag is text not null", () => {
    expect(col(snapshots, "rendered").getSQLType()).toBe("jsonb");
    expect(col(snapshots, "rendered").notNull).toBe(true);
    expect(col(snapshots, "etag").notNull).toBe(true);
  });
});

describe("submissions (spec §6)", () => {
  it("has the spec'd columns with jsonb defaults", () => {
    expect(columnNames(submissions)).toEqual([
      "id",
      "workspace_id",
      "document_id",
      "version_id",
      "status",
      "public_token",
      "variables",
      "hidden",
      "meta",
      "started_at",
      "completed_at",
    ]);
    for (const name of ["variables", "hidden", "meta"]) {
      expect(col(submissions, name).hasDefault, `${name} default '{}'`).toBe(true);
    }
  });

  it("public_token is globally unique", () => {
    expect(col(submissions, "public_token").isUnique).toBe(true);
  });

  it("has the (document_id, completed_at) index", () => {
    const names = indexColumnNames(submissions);
    expect(names).toContain("document_id");
    expect(names).toContain("completed_at");
  });
});

describe("answers (spec §6)", () => {
  it("has composite PK (submission_id, block_id)", () => {
    const config = getTableConfig(answers);
    expect(config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name))).toEqual([
      "submission_id",
      "block_id",
    ]);
  });
});

describe("tenancy enum-ish text columns", () => {
  it("matches the spec comments", () => {
    expect(documentTypeValues).toEqual(["form", "page", "portfolio"]);
    expect(documentStatusValues).toEqual(["draft", "published", "archived"]);
    expect(submissionStatusValues).toEqual(["draft", "completed", "spam"]);
  });
});

describe("schema surface", () => {
  it("exports exactly the five tenancy tables", () => {
    expect(Object.keys(tenancyTables).sort()).toEqual([
      "answers",
      "documentVersions",
      "documents",
      "snapshots",
      "submissions",
    ]);
  });
});
