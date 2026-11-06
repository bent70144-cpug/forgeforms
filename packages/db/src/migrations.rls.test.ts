// Migration guard for the tenancy RLS migration (T04) — no live DB needed.
// Acceptance #3: "Migration adds RLS policies idempotently". We pin:
//   * every tenant table is ENABLEd and carries a current_setting-based policy,
//   * policies are DROP IF EXISTS + CREATE (idempotent, convergent),
//   * the two dedicated roles exist and the ingest role's grants are limited
//     (no DELETE, no access beyond published reads + submissions/answers).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// this file lives in src/ — the migration SQL sits at the package root
const drizzleDir = join(import.meta.dirname, "..", "drizzle");
const RLS_TAG = "0003_tenancy_rls";

async function readRlsSql(): Promise<string> {
  const journal = JSON.parse(
    await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const tags = journal.entries.map((e) => e.tag);
  expect(tags).toContain(RLS_TAG);
  return readFile(join(drizzleDir, `${RLS_TAG}.sql`), "utf8");
}

describe("0003_tenancy_rls migration", () => {
  let sqlText = "";

  it("loads (and is registered in the journal after the table migrations)", async () => {
    sqlText = await readRlsSql();
    const journal = JSON.parse(
      await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const idx = journal.entries.findIndex((e) => e.tag === RLS_TAG);
    const lastTableIdx = journal.entries.reduce((acc, e, i) => {
      return e.tag === "0002_crazy_magneto" ? i : acc;
    }, -1);
    expect(idx).toBeGreaterThan(lastTableIdx);
  });

  it.each([
    "documents",
    "document_versions",
    "snapshots",
    "submissions",
    "answers",
    "memberships",
  ])("enables RLS on %s with a tenant_isolation policy", async (table) => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    expect(sqlText).toContain(`DROP POLICY IF EXISTS tenant_isolation ON ${table}`);
  });

  it("enables RLS on api_tokens with the lookup/write policy split", async () => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toContain("ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY");
    expect(sqlText).toContain("DROP POLICY IF EXISTS token_lookup_plane ON api_tokens");
    expect(sqlText).toContain("DROP POLICY IF EXISTS token_tenant_writes ON api_tokens");
    expect(sqlText).toContain("DROP POLICY IF EXISTS token_tenant_update ON api_tokens");
    expect(sqlText).toContain("DROP POLICY IF EXISTS token_tenant_delete ON api_tokens");
  });

  it("keys every policy on current_setting('app.workspace_id', true)", async () => {
    sqlText ||= await readRlsSql();
    const occurrences = sqlText.split("current_setting('app.workspace_id', true)").length - 1;
    // top-level policies carry the NULL-safe two-arg form; DO-block conditionals
    // use the doubled-quote ('') form inside EXECUTE strings (asserted separately)
    expect(occurrences).toBeGreaterThanOrEqual(12);
    expect(sqlText).toContain("current_setting(''app.workspace_id'', true)");
  });

  it("is idempotent: DROP POLICY IF EXISTS + CREATE POLICY (convergent re-runs)", async () => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toMatch(/DROP POLICY IF EXISTS tenant_isolation ON documents/);
    // no bare CREATE POLICY for tenant_isolation without a preceding DROP IF EXISTS
    const creates = sqlText.split("CREATE POLICY tenant_isolation").length - 1;
    const drops = sqlText.split("DROP POLICY IF EXISTS tenant_isolation").length - 1;
    expect(creates).toBe(drops);
  });

  it("creates the dedicated roles idempotently (only when missing)", async () => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toContain("rolname = 'formforge_app'");
    expect(sqlText).toContain("rolname = 'formforge_ingest'");
    expect(sqlText).toContain("CREATE ROLE formforge_app NOLOGIN");
    expect(sqlText).toContain("CREATE ROLE formforge_ingest NOLOGIN");
  });

  it("ingest role grants are minimal: no DELETE, tenant tables only", async () => {
    sqlText ||= await readRlsSql();
    const ingestSection = sqlText.slice(sqlText.indexOf("formforge_ingest;"));
    expect(ingestSection).toContain("GRANT SELECT, INSERT, UPDATE ON submissions, answers");
    expect(ingestSection).toContain("GRANT SELECT ON documents, snapshots");
    expect(ingestSection).not.toMatch(/GRANT[^;]*DELETE[^;]*TO formforge_ingest/);
    expect(ingestSection).not.toMatch(/GRANT[^;]*TO formforge_ingest[^;]*api_tokens/);
    expect(ingestSection).not.toMatch(/GRANT[^;]*TO formforge_ingest[^;]*memberships/);
  });

  it("app role gets CRUD on tenant tables, workspace row read/update only", async () => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON\n  documents, document_versions, snapshots, submissions, answers,\n  memberships, api_tokens\nTO formforge_app",
    );
    expect(sqlText).toContain("GRANT SELECT, UPDATE ON workspaces TO formforge_app");
  });

  it("future tables (assets/events/usage_counters/audit_log/webhooks) are covered conditionally", async () => {
    sqlText ||= await readRlsSql();
    for (const table of ["assets", "events", "usage_counters", "audit_log", "webhook_endpoints"]) {
      expect(sqlText).toContain(`'${table}'`);
    }
    expect(sqlText).toContain("to_regclass('public.webhook_deliveries')");
    expect(sqlText).toContain("to_regclass('public.analytics_events')");
    expect(sqlText).toContain("to_regclass('public.analytics_daily')");
  });

  it("fail-closed: policies treat an unset GUC as no access (NULL-safe lookup)", async () => {
    sqlText ||= await readRlsSql();
    // strip comment lines before asserting (the header prose mentions the GUC)
    const code = sqlText
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    // the `, true` two-arg form returns NULL instead of erroring when unset;
    // the single-arg form would ERROR on every unscoped query
    expect(code).not.toContain("current_setting('app.workspace_id')");
    expect(code).toContain("current_setting('app.workspace_id', true)");
  });

  it("documents the tenant-table boundary (users/workspaces excluded by design)", async () => {
    sqlText ||= await readRlsSql();
    expect(sqlText).toContain("users / workspaces are NOT tenant tables");
    expect(sqlText).not.toMatch(/ALTER TABLE users ENABLE ROW LEVEL SECURITY/);
    expect(sqlText).not.toMatch(/ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY/);
  });
});
