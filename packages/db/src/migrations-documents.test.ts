// T07 — migration guard for the documents tables (spec §6; no live DB needed).
// Mirrors migrations.test.ts: keeps the committed SQL honest against the spec.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const drizzleDir = join(import.meta.dirname, "..", "drizzle");

async function allMigrationSql(): Promise<string> {
  const entries = await readdir(drizzleDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => join(drizzleDir, e.name));
  return (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
}

describe("documents migration (spec §6)", () => {
  it("creates documents, document_versions and snapshots", async () => {
    const sql = await allMigrationSql();
    for (const table of ["documents", "document_versions", "snapshots"]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it("matches the spec §6 columns for documents", async () => {
    const sql = await allMigrationSql();
    for (const column of [
      '"type" text NOT NULL',
      '"slug" text NOT NULL',
      '"status" text DEFAULT \'draft\' NOT NULL',
      '"rev" integer DEFAULT 0 NOT NULL',
      '"draft" jsonb NOT NULL',
      '"published_version_id" uuid',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("enforces slug uniqueness per workspace and the dashboard list index", async () => {
    const sql = await allMigrationSql();
    // unique (workspace_id, slug) — INTEGRATION (T04×T07): 0002_crazy_magneto
    // (T04) creates the constraint as an inline table UNIQUE constraint (the
    // same name backs the unique index Postgres stores); T07's standalone
    // CREATE UNIQUE INDEX form is accepted too so both shapes stay honest.
    expect(sql).toMatch(
      /CONSTRAINT "documents_workspace_id_slug_unique" UNIQUE\("workspace_id","slug"\)|CREATE UNIQUE INDEX "documents_workspace_id_slug_unique"/,
    );
    // index on (workspace_id, updated_at desc)
    expect(sql).toMatch(/CREATE INDEX "documents_workspace_id_updated_at_idx"[\s\S]*?"updated_at" DESC/);
  });

  it("cascades workspace → documents and documents → versions/snapshots deletes", async () => {
    const sql = await allMigrationSql();
    expect(sql).toMatch(
      /"documents_workspace_id_workspaces_id_fk" FOREIGN KEY \("workspace_id"\) REFERENCES "public"."workspaces"\("id"\) ON DELETE cascade/,
    );
    expect(sql).toMatch(
      /"document_versions_document_id_documents_id_fk" FOREIGN KEY \("document_id"\) REFERENCES "public"."documents"\("id"\) ON DELETE cascade/,
    );
    expect(sql).toMatch(
      /"snapshots_document_id_documents_id_fk" FOREIGN KEY \("document_id"\) REFERENCES "public"."documents"\("id"\) ON DELETE cascade/,
    );
  });

  it("makes document_versions insert-only shaped (immutable body) and snapshots one-per-document", async () => {
    const sql = await allMigrationSql();
    expect(sql).toMatch(/CREATE TABLE "snapshots"[\s\S]*?"document_id" uuid PRIMARY KEY/);
    expect(sql).toMatch(/CREATE TABLE "document_versions"[\s\S]*?"body" jsonb NOT NULL/);
  });
});
