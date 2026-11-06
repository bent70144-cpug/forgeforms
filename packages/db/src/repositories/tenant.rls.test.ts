// T04 — CI-gated RLS integration test (acceptance #1, ticket #4):
//   "user in workspace A cannot read workspace B documents through ANY
//    repository function, including with a forged document ID, with RLS
//    enabled."
//
// Requires a real Postgres: RUN_DB_TESTS=1 (CI wires DATABASE_URL; locally
// docker compose up postgres && RUN_DB_TESTS=1 pnpm --filter @formforge/db test).
// Locally (no Docker) this file skips cleanly.
//
// Mechanism under test: the tenant repositories run inside withTenantScope,
// which sets `app.workspace_id` AND assumes `role formforge_app` per
// transaction — RLS binds because the assumed role is neither the table owner
// nor a superuser, even when DATABASE_URL is postgres (as in CI).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, createCtx } from "@formforge/core";
import { createDb } from "../client.ts";
import { createTenantRepositories, withTenantScope } from "./tenant.ts";

const WS_A = "00000000-0000-4000-8000-00000000000a";
const WS_B = "00000000-0000-4000-8000-00000000000b";
const USER_A = "00000000-0000-4000-8000-00000000a001";
const DOC_A1 = "00000000-0000-4000-8000-00000000a101"; // draft, ws A
const DOC_A2 = "00000000-0000-4000-8000-00000000a102"; // published, ws A
const DOC_B1 = "00000000-0000-4000-8000-00000000b101"; // draft, ws B
const DOC_B2 = "00000000-0000-4000-8000-00000000b102"; // published, ws B
const VER_B2 = "00000000-0000-4000-8000-0000000000b1";
const SUB_B1 = "00000000-0000-4000-8000-00000000b201"; // submission in ws B

describe.skipIf(!process.env.RUN_DB_TESTS)("tenant RLS (integration)", () => {
  let admin!: Pool;
  let adminDb!: ReturnType<typeof drizzle>;
  let tenantDb!: ReturnType<typeof createDb>;
  let repos!: ReturnType<typeof createTenantRepositories>;

  const ctxA = () => createCtx({ workspaceId: WS_A, actor: { type: "user", id: USER_A } });
  const ctxB = () => createCtx({ workspaceId: WS_B, actor: { type: "user", id: USER_A } });

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("RUN_DB_TESTS=1 requires DATABASE_URL");

    admin = new Pool({ connectionString: url, max: 4 });
    adminDb = drizzle(admin);
    // apply committed migrations (identity + tenancy DDL + RLS)
    await migrate(adminDb, { migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle") });

    await admin.query(
      `truncate users, workspaces, memberships, api_tokens,
         documents, document_versions, snapshots, submissions, answers cascade`,
    );

    // Seed as the migration user (owner plane; bypasses RLS by design — the
    // same way the app's registration/seed paths run today).
    await admin.query(
      `insert into users (id, email, name, created_at) values
         ($1, 'a@example.test', 'Alice', now()),
         ('00000000-0000-4000-8000-00000000b001', 'b@example.test', 'Bob', now())`,
      [USER_A],
    );
    await admin.query(
      `insert into workspaces (id, name, slug) values
         ($1, 'Workspace A', 'ws-a'),
         ($2, 'Workspace B', 'ws-b')`,
      [WS_A, WS_B],
    );
    await admin.query(
      `insert into memberships (workspace_id, user_id, role) values
         ($1, $3, 'owner'), ($2, '00000000-0000-4000-8000-00000000b001', 'owner')`,
      [WS_A, WS_B, USER_A],
    );
    await admin.query(
      `insert into documents (id, workspace_id, type, title, slug, status, draft) values
         ($1, $5, 'form', 'A draft', 'a-draft', 'draft', '{"blocks": []}'::jsonb),
         ($2, $5, 'form', 'A live',  'a-live',  'published', '{"blocks": []}'::jsonb),
         ($3, $6, 'form', 'B draft', 'b-draft', 'draft', '{"blocks": []}'::jsonb),
         ($4, $6, 'form', 'B live',  'b-live',  'published', '{"blocks": []}'::jsonb)`,
      [DOC_A1, DOC_A2, DOC_B1, DOC_B2, WS_A, WS_B],
    );
    // version + snapshot for B's published document (public-plane fixtures)
    await admin.query(
      `insert into document_versions (id, document_id, workspace_id, schema_version, body)
         values ($1, $2, $3, 1, '{"blocks": []}'::jsonb)`,
      [VER_B2, DOC_B2, WS_B],
    );
    await admin.query(
      `insert into snapshots (document_id, version_id, rendered, etag)
         values ($1, $2, '{"blocks": []}'::jsonb, 'snap-b')`,
      [DOC_B2, VER_B2],
    );
    await admin.query(
      `insert into submissions (id, workspace_id, document_id, version_id, status, public_token)
         values ($1, $2, $3, $4, 'completed', 'sub_secret_b')`,
      [SUB_B1, WS_B, DOC_B1, VER_B2],
    );
    await admin.query(
      `insert into answers (submission_id, block_id, value, updated_at)
         values ($1, 'b1', '"hi"'::jsonb, now())`,
      [SUB_B1],
    );

    tenantDb = createDb(url);
    repos = createTenantRepositories(tenantDb);
  }, 60_000);

  afterAll(async () => {
    const client = (tenantDb as unknown as { $client?: { end?: () => Promise<void> } })
      ?.$client;
    if (client?.end) await client.end();
    if (admin) await admin.end();
  });

  it("workspace A reads its own documents through every repository read path", async () => {
    const ctx = ctxA();
    const byId = await repos.documents.getById(ctx, DOC_A1);
    expect(byId?.id).toBe(DOC_A1);
    expect(byId?.workspaceId).toBe(WS_A);

    const all = await repos.documents.list(ctx);
    expect(all.map((d) => d.id).sort()).toEqual([DOC_A1, DOC_A2].sort());

    const bySlug = await repos.documents.findBySlug(ctx, "a-live");
    expect(bySlug?.id).toBe(DOC_A2);
  });

  it("workspace A cannot read workspace B documents with a FOREIGN document id", async () => {
    const ctx = ctxA();
    // the forged/foreign id resolves to null on every read path
    expect(await repos.documents.getById(ctx, DOC_B1)).toBeNull();
    expect(await repos.documents.getById(ctx, DOC_B2)).toBeNull();
    expect(await repos.documents.findBySlug(ctx, "b-live")).toBeNull();
    expect(await repos.documents.findBySlug(ctx, "b-draft")).toBeNull();
    const list = await repos.documents.list(ctx);
    expect(list.map((d) => d.id)).not.toContain(DOC_B1);
    expect(list.map((d) => d.id)).not.toContain(DOC_B2);
  });

  it("workspace A cannot mutate workspace B documents (forged id → NOT_FOUND)", async () => {
    const ctx = ctxA();
    const publishError = await repos.documents
      .updatePublishState(ctx, DOC_B2, { status: "draft", publishedVersionId: null })
      .catch((e: unknown) => e);
    expect(AppError.is(publishError)).toBe(true);
    expect((publishError as AppError).code).toBe("NOT_FOUND");

    const archiveError = await repos.documents.archive(ctx, DOC_B1).catch((e: unknown) => e);
    expect(AppError.is(archiveError)).toBe(true);
    expect((archiveError as AppError).code).toBe("NOT_FOUND");

    // B's rows are untouched (admin view)
    const { rows } = await admin.query<{ status: string }>(
      `select status from documents where id = any($1::uuid[])`,
      [[DOC_B1, DOC_B2]],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["draft", "published"]);
  });

  it("workspace A writes stay inside workspace A (RLS WITH CHECK)", async () => {
    const ctx = ctxA();
    const created = await repos.documents.create(ctx, {
      type: "form",
      title: "Created under RLS",
      slug: "a-created",
      draft: { blocks: [] },
      createdBy: USER_A,
    });
    expect(created.workspaceId).toBe(WS_A);

    const published = await repos.documents.updatePublishState(ctx, DOC_A1, {
      status: "published",
      publishedVersionId: null,
    });
    expect(published.status).toBe("published");

    const archived = await repos.documents.archive(ctx, DOC_A2);
    expect(archived.status).toBe("archived");
  });

  it("submission reads are tenant-scoped too (ANY repository function)", async () => {
    const ctxA1 = ctxA();
    expect(await repos.submissions.listByDocument(ctxA1, DOC_B1)).toEqual([]);
    expect(await repos.submissions.getSubmission(ctxA1, SUB_B1)).toBeNull();
    expect(await repos.submissions.listAnswers(ctxA1, SUB_B1)).toEqual([]);
    // B sees its own submission
    const ctxB1 = ctxB();
    const found = await repos.submissions.getSubmission(ctxB1, SUB_B1);
    expect(found?.id).toBe(SUB_B1);
  });

  it("RLS actually binds: scope transaction sees only A rows while the raw connection sees all", async () => {
    const tenantCount = await withTenantScope(tenantDb, WS_A, async (tx) => {
      const result = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from documents`,
      );
      return Number(result.rows[0]!.count);
    });
    expect(tenantCount).toBe(2);

    // same connection user, WITHOUT the role assumption: owner/superuser
    // bypass would leak both workspaces — the `set local role` is what makes
    // RLS bite (guards against a silent regression to bypass semantics).
    const rawCount = Number(
      (await admin.query<{ count: string }>(`select count(*)::text as count from documents`))
        .rows[0]!.count,
    );
    expect(rawCount).toBe(4);
  });

  it("migration 0003 is idempotent on a live database (re-apply converges)", async () => {
    const before = await admin.query(
      `select tablename, policyname from pg_policies where schemaname = 'public'
         order by tablename, policyname`,
    );
    const sqlText = await readFile(
      join(import.meta.dirname, "..", "..", "drizzle", "0003_tenancy_rls.sql"),
      "utf8",
    );
    const chunks = sqlText.split("--> statement-breakpoint");
    // apply twice — DROP+CREATE policies, no-op enables, existing roles
    for (let pass = 1; pass <= 2; pass++) {
      for (const chunk of chunks) {
        await admin.query(chunk);
      }
      expect(pass).toBeLessThanOrEqual(2);
    }
    const after = await admin.query(
      `select tablename, policyname from pg_policies where schemaname = 'public'
         order by tablename, policyname`,
    );
    expect(after.rows).toEqual(before.rows);

    // RLS is ENABLED on every tenant table
    const { rows } = await admin.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
         where relname in ('documents','document_versions','snapshots','submissions','answers','memberships','api_tokens')
           and relkind = 'r'`,
    );
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row.relrowsecurity).toBe(true);
  });

  it("formforge_ingest is limited: published reads + submission writes, no DELETE", async () => {
    await admin.query("begin");
    try {
      await admin.query("set local role formforge_ingest");
      // published documents of ANY workspace are readable (public plane);
      // drafts are invisible (tenant policy fail-closed without a GUC)
      const { rows: docRows } = await admin.query<{ status: string }>(
        `select status from documents`,
      );
      expect(docRows.map((r) => r.status)).toEqual(["published", "published"]);
      // token-plane read of submissions works, delete does not (grant model)
      const { rows: subRows } = await admin.query<{ id: string }>(`select id from submissions`);
      expect(subRows).toHaveLength(1);
      await expect(admin.query(`delete from submissions`)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await admin.query("rollback");
    }
  });
});
