// Migration pipeline guard — no live DB needed.
// Keeps the committed SQL in sync with the schema: if someone edits
// src/schema without regenerating, or deletes the citext bootstrap, this
// fails. (`pnpm --filter @formforge/db db:generate` regenerates.)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// this file lives in src/ — the generated migrations sit at the package root
const drizzleDir = join(import.meta.dirname, "..", "drizzle");

describe("migration pipeline", () => {
  it("has at least one table migration plus the citext bootstrap", async () => {
    const entries = await readdir(drizzleDir, { withFileTypes: true });
    const migrationFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".sql"))
      .map((e) => e.name)
      .sort();
    expect(migrationFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("enables the citext extension before any table DDL", async () => {
    const journal = JSON.parse(
      await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const sqlByTag = new Map<string, string>();
    for (const entry of journal.entries) {
      sqlByTag.set(entry.tag, await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8"));
    }
    const extensionIdx = journal.entries.findIndex((e) =>
      sqlByTag.get(e.tag)?.includes("CREATE EXTENSION IF NOT EXISTS citext"),
    );
    expect(extensionIdx, "citext bootstrap migration missing").toBeGreaterThanOrEqual(0);

    const firstTableMigration = journal.entries.find((e) =>
      sqlByTag.get(e.tag)?.includes("CREATE TABLE"),
    );
    expect(firstTableMigration, "no table migration found").toBeDefined();
    expect(
      extensionIdx < journal.entries.indexOf(firstTableMigration!),
      "citext must be created before the first table DDL",
    ).toBe(true);
  });

  it("identity migration matches spec §6 DDL for the four tables", async () => {
    const journal = JSON.parse(
      await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const allSql = (
      await Promise.all(
        journal.entries.map((e) => readFile(join(drizzleDir, `${e.tag}.sql`), "utf8")),
      )
    ).join("\n");

    for (const table of ["users", "workspaces", "memberships", "api_tokens"]) {
      expect(allSql).toContain(`CREATE TABLE "${table}"`);
    }
    // citext email, argon2id hash column, snake_case, cascade FKs, defaults
    for (const fragment of [
      '"email" "citext" NOT NULL',
      '"password_hash" text',
      '"email_verified_at" timestamp with time zone',
      '"plan" text DEFAULT \'free\' NOT NULL',
      '"token_hash" text NOT NULL',
      '"scopes" text[] NOT NULL',
      '"created_at" timestamp with time zone DEFAULT now() NOT NULL',
      'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade',
      'FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade',
      'CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")',
    ]) {
      expect(allSql).toContain(fragment);
    }
  });
});
