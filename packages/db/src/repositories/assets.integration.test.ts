// T16 — CI-gated integration tests for the assets repository (spec §6 assets
// table + RLS note). Skipped unless RUN_DB_TESTS=1 + DATABASE_URL (no Docker
// in the sandbox; CI runs them against the compose Postgres).
//
// Mechanism under test: tenant-plane calls run inside withTenantScope
// (`app.workspace_id` + `role formforge_app` per transaction, mirroring
// tenant.rls.test.ts); system-plane calls (worker jobs, public confirm)
// address rows by id directly.
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client.ts";
import { createAssetsRepository } from "./assets.ts";

const WS_A = "00000000-0000-4000-8000-0000000001a1";
const WS_B = "00000000-0000-4000-8000-0000000001b1";

const AST_A1 = "00000000-0000-4000-8000-0000000002a1";
const AST_A2 = "00000000-0000-4000-8000-0000000002a2";
const AST_B1 = "00000000-0000-4000-8000-0000000002b1";

function assetRow(workspaceId: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId,
    key: `upload/${workspaceId}/${id}/photo.png`,
    mime: "image/png",
    sizeBytes: 1024,
    purpose: "upload" as const,
    scanStatus: "pending" as const,
    variants: null,
    confirmedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe.skipIf(!process.env.RUN_DB_TESTS)("assets repository (integration)", () => {
  let admin!: Pool;
  let db!: ReturnType<typeof createDb>;
  let repo!: ReturnType<typeof createAssetsRepository>;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("RUN_DB_TESTS=1 requires DATABASE_URL");
    admin = new Pool({ connectionString: url, max: 4 });
    await migrate(drizzle(admin), {
      migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle"),
    });
    await admin.query(`truncate assets cascade`);
    await admin.query(
      `insert into workspaces (id, name, slug) values
         ($1, 'T16 assets A', 't16-assets-a'), ($2, 'T16 assets B', 't16-assets-b')
       on conflict (id) do nothing`,
      [WS_A, WS_B],
    );
    db = createDb(url);
    repo = createAssetsRepository(db);
  });

  afterAll(async () => {
    await admin.query(`delete from workspaces where id = any($1)`, [[WS_A, WS_B]]);
    await admin.end();
  });

  it("inserts through the tenant scope and reads back (RLS bound)", async () => {
    const row = await repo.insert(assetRow(WS_A, AST_A1));
    expect(row.id).toBe(AST_A1);
    expect(row.scanStatus).toBe("pending");
    expect(row.mime).toBe("image/png");

    const fetched = await repo.getById(WS_A, AST_A1);
    expect(fetched?.key).toBe(`upload/${WS_A}/${AST_A1}/photo.png`);
    expect(fetched?.confirmedAt).toBeNull();
  });

  it("foreign workspace ids are indistinguishable from missing (404 posture)", async () => {
    expect(await repo.getById(WS_B, AST_A1)).toBeNull();
    // system plane sees the row by id alone (worker jobs / public confirm)
    expect((await repo.getByIdUnscoped(AST_A1))?.workspaceId).toBe(WS_A);
  });

  it("unique key conflict returns the existing row (at-most-once presign retry)", async () => {
    const sameKey = assetRow(WS_A, AST_A2);
    await repo.insert(sameKey);
    const retried = await repo.insert(assetRow(WS_A, "00000000-0000-4000-8000-0000000002a3", {
      key: sameKey.key,
    }));
    expect(retried.id).toBe(AST_A2);
  });

  it("patches scanStatus/variants/confirmedAt on the system plane", async () => {
    const patched = await repo.patch(AST_A1, {
      scanStatus: "skipped",
      mime: "image/png",
      confirmedAt: new Date(),
      variants: {
        width: 32,
        height: 32,
        sizes: "(max-width: 640px) 100vw, 640px",
        blurDataURL: "data:image/svg+xml,test",
        variants: [{ key: `upload/${WS_A}/${AST_A1}/photo.32w.webp`, format: "webp", width: 32 }],
      },
    });
    expect(patched?.scanStatus).toBe("skipped");
    expect(patched?.confirmedAt).not.toBeNull();
    expect((patched?.variants as { variants: unknown[] }).variants).toHaveLength(1);
    expect(await repo.patch("00000000-0000-4000-8000-0000000002f1", { scanStatus: "clean" })).toBeNull();
  });

  it("lists newest-first per workspace with an optional purpose filter", async () => {
    await repo.insert(assetRow(WS_A, AST_A2, { purpose: "media", mime: "image/jpeg" }));
    const rows = await repo.listByWorkspace(WS_A, { purpose: "media" });
    expect(rows.map((r) => r.id)).toEqual([AST_A2]);
    const all = await repo.listByWorkspace(WS_A);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // tenant isolation: ws B's assets never leak into ws A's listing
    await repo.insert(assetRow(WS_B, AST_B1));
    expect(all.every((r) => r.workspaceId === WS_A)).toBe(true);
    expect(await repo.listByWorkspace(WS_B)).toEqual([expect.objectContaining({ id: AST_B1 })]);
  });

  it("removes tenant-scoped and keeps foreign rows unreachable", async () => {
    expect(await repo.remove(AST_B1, WS_A)).toBe(false); // foreign id → no-op
    expect(await repo.remove(AST_B1, WS_B)).toBe(true);
    expect(await repo.getByIdUnscoped(AST_B1)).toBeNull();
  });
});
