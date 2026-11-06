/**
 * T07 — live-Postgres integration tests for the SQL documents repository.
 *
 * GATED: skipped unless RUN_DB_TESTS=1 and a DATABASE_URL is reachable, e.g.
 *   docker compose up -d postgres
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://… pnpm --filter @formforge/db test
 * The sandbox CI runs DB-free; these prove the real SQL semantics (keyset
 * pagination, the conditional rev update, unique-slug index).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlDocumentsRepo, createSqlSnapshotsRepo } from "./documents";
import type { SqlExecutor } from "./document-versions";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const DB_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/formforge";

function executor(pool: pg.Pool): SqlExecutor {
  return {
    async query(text: string, params?: readonly unknown[]) {
      const result = await pool.query(text, (params ?? []) as unknown[]);
      return { rows: result.rows as unknown as Record<string, unknown>[] };
    },
  };
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const drizzleDir = join(import.meta.dirname, "..", "..", "drizzle");
  const entries = await readdir(drizzleDir, { withFileTypes: true });
  const journal = JSON.parse(
    await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      await pool.query(statement);
    }
  }
}

function makeRecord(workspaceId: string, id: string, overrides = {}) {
  const now = new Date();
  return {
    id,
    workspaceId,
    type: "form" as const,
    title: `Doc ${id.slice(0, 6)}`,
    slug: `doc-${id.slice(0, 8)}`,
    status: "draft" as const,
    rev: 0,
    draft: { schemaVersion: 1, type: "form", blocks: [] },
    publishedVersionId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe.skipIf(!RUN)("sql documents repository", () => {
  let pool: pg.Pool;
  const workspaceId = "00000000-0000-7000-8000-00000000db01";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await applyMigrations(pool);
    await pool.query(
      `insert into workspaces (id, name, slug) values ($1, 'T07 DB tests', 't07-db-tests')
       on conflict (id) do nothing`,
      [workspaceId],
    );
  });

  afterAll(async () => {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.end();
  });

  it("inserts, lists by recency with keyset cursors and filters", async () => {
    const repo = createSqlDocumentsRepo(executor(pool));
    const a = makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db0a");
    const b = makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db0b", { title: "Searchable", type: "page" });
    await repo.insert(a);
    await repo.insert(b);
    await repo.updateDraft(workspaceId, b.id, 0, {}, new Date(a.updatedAt.getTime() + 5000));

    const page1 = await repo.list(workspaceId, { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0]!.id).toBe(b.id); // most recently updated
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.list(workspaceId, { limit: 10, cursor: page1.nextCursor });
    expect(page2.items.map((d) => d.id)).toEqual([a.id]);
    expect(page2.nextCursor).toBeNull();

    const pages = await repo.list(workspaceId, { limit: 10, type: "page" });
    expect(pages.items.map((d) => d.id)).toEqual([b.id]);

    const search = await repo.list(workspaceId, { limit: 10, q: "searchable" });
    expect(search.items).toHaveLength(1);
  });

  it("updateDraft is a conditional rev bump (spec §8 autosave primitive)", async () => {
    const repo = createSqlDocumentsRepo(executor(pool));
    const doc = makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db0c");
    await repo.insert(doc);

    const updated = await repo.updateDraft(workspaceId, doc.id, 0, {
      title: "Renamed",
      draft: { schemaVersion: 1, type: "form", blocks: [{ id: "b1" }] },
    }, new Date());
    expect(updated).not.toBe("CONFLICT");
    if (updated === "CONFLICT") return;
    expect(updated.rev).toBe(1);
    expect(updated.title).toBe("Renamed");

    // stale rev → CONFLICT, nothing changed
    const stale = await repo.updateDraft(workspaceId, doc.id, 0, { title: "Nope" }, new Date());
    expect(stale).toBe("CONFLICT");
    const refetched = await repo.getById(workspaceId, doc.id);
    expect(refetched?.title).toBe("Renamed");
    expect(refetched?.rev).toBe(1);
  });

  it("enforces unique (workspace_id, slug) across workspaces only", async () => {
    const repo = createSqlDocumentsRepo(executor(pool));
    const otherWs = "00000000-0000-7000-8000-00000000db02";
    await pool.query(
      `insert into workspaces (id, name, slug) values ($1, 'T07 DB tests 2', 't07-db-tests-2')
       on conflict (id) do nothing`,
      [otherWs],
    );
    await repo.insert(makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db0d", { slug: "same-slug" }));
    // same slug in the same workspace → unique index violation
    await expect(
      repo.insert(makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db0e", { slug: "same-slug" })),
    ).rejects.toThrow();
    // same slug in another workspace → fine
    await repo.insert(makeRecord(otherWs, "00000000-0000-7000-8000-00000000db0f", { slug: "same-slug" }));
    await pool.query(`delete from workspaces where id = $1`, [otherWs]);
  });

  it("archives via setStatus and upserts snapshots one-per-document", async () => {
    const repo = createSqlDocumentsRepo(executor(pool));
    const snapshots = createSqlSnapshotsRepo(executor(pool));
    const doc = makeRecord(workspaceId, "00000000-0000-7000-8000-00000000db10");
    await repo.insert(doc);

    const version = await pool.query(
      `insert into document_versions (id, document_id, workspace_id, schema_version, body)
       values ($1, $2, $3, 1, '{}') returning id`,
      ["00000000-0000-7000-8000-00000000db11", doc.id, workspaceId],
    );
    const versionId = String(version.rows[0]!["id"]);
    const snapshot = await snapshots.upsert({
      documentId: doc.id,
      versionId,
      rendered: { documentId: doc.id, versionId } as never,
      etag: "etag-1",
      builtAt: new Date(),
    });
    expect(snapshot.etag).toBe("etag-1");
    const again = await snapshots.upsert({
      documentId: doc.id,
      versionId,
      rendered: { documentId: doc.id, versionId } as never,
      etag: "etag-2",
      builtAt: new Date(),
    });
    expect(again.etag).toBe("etag-2");
    const fetched = await snapshots.getByDocumentId(doc.id);
    expect(fetched?.etag).toBe("etag-2");

    const archived = await repo.setStatus(workspaceId, doc.id, "archived", new Date());
    expect(archived?.status).toBe("archived");
    expect(await repo.setStatus(workspaceId, doc.id, "nonexistent" as "draft", new Date())).toBeNull();
  });
});
