// Migration guard for the T24 domains tables — DB-free (no live Postgres).
// Keeps the generated SQL in sync with the schema contract: if someone edits
// src/schema/domains.ts without regenerating, or drops the routing table, this
// fails. (`pnpm --filter @formforge/db db:generate` regenerates.)
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const drizzleDir = join(import.meta.dirname, "..", "..", "drizzle");

async function allMigrationSql(): Promise<string> {
  const entries = await readdir(drizzleDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".sql")).map((e) => e.name);
  const chunks: string[] = [];
  for (const file of files.sort()) {
    chunks.push(await readFile(join(drizzleDir, file), "utf8"));
  }
  return chunks.join("\n");
}

describe("custom_domains migration (issue #24)", () => {
  it("creates custom_domains with a globally unique hostname + tenant FK", async () => {
    const sql = await allMigrationSql();
    expect(sql).toContain('CREATE TABLE "custom_domains"');
    expect(sql).toContain('CONSTRAINT "custom_domains_hostname_unique" UNIQUE("hostname")');
    expect(sql).toContain(
      'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade',
    );
    // Verification state machine columns (pending → verified; only verified routes).
    expect(sql).toContain('"status" text DEFAULT \'pending\' NOT NULL');
    expect(sql).toContain('"verification_token" text NOT NULL');
  });

  it("creates the domain_routes KV substitute (Host → documentId)", async () => {
    const sql = await allMigrationSql();
    expect(sql).toContain('CREATE TABLE "domain_routes"');
    expect(sql).toContain('"hostname" text PRIMARY KEY NOT NULL');
    expect(sql).toContain('"document_id" uuid NOT NULL');
  });
});
