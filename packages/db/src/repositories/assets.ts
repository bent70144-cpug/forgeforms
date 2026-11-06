// Assets repositories (T16, spec §6 assets + §17 security model).
//
// Implements, structurally, the `AssetRepo` port declared in
// @formforge/core/assets (packages/db may import core TYPES — tenant.ts does
// — but never the other way around).
//
// Tenant plane (web routes): every call goes through `withTenantScope` so RLS
// binds (`app.workspace_id` + `formforge_app` role) AND the WHERE clause
// carries the workspace — defense in depth, per repositories/tenant.ts.
// System plane (worker jobs, public confirm): direct id-keyed statements —
// the connection user is the owner (RLS-bypassing), matching how the other
// system-plane repositories run; the worker is not request-scoped.
//
// DB-GATED: integration coverage lives in assets.dbtest.ts (RUN_DB_TESTS=1).

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client.ts";
import { assets } from "../schema/assets.ts";
import { withTenantScope } from "./tenant.ts";
import type { AssetVariants } from "@formforge/core/assets";

/* ------------------------------------------------------------------ *
 * DTOs (structural mirror of @formforge/core/assets AssetRecord)
 * ------------------------------------------------------------------ */

export type AssetPurposeLike = "media" | "upload";
export type AssetScanStatusLike = "pending" | "clean" | "infected" | "skipped";

export type AssetRecordLike = {
  id: string;
  workspaceId: string;
  key: string;
  mime: string;
  sizeBytes: number;
  purpose: AssetPurposeLike;
  scanStatus: AssetScanStatusLike;
  variants?: AssetVariants | null;
  confirmedAt?: Date | null;
  createdAt: Date;
};

export type NewAssetRecordLike = Omit<AssetRecordLike, "createdAt" | "confirmedAt" | "variants"> & {
  createdAt?: Date;
  confirmedAt?: Date | null;
  variants?: AssetVariants | null;
};

export type AssetPatch = Partial<
  Pick<AssetRecordLike, "mime" | "scanStatus" | "variants" | "confirmedAt">
>;

export interface AssetsRepoLike {
  insert(row: NewAssetRecordLike): Promise<AssetRecordLike>;
  /** Tenant plane — foreign ids are indistinguishable from missing (404). */
  getById(workspaceId: string, assetId: string): Promise<AssetRecordLike | null>;
  /** System/public plane — the asset uuid is the credential. */
  getByIdUnscoped(assetId: string): Promise<AssetRecordLike | null>;
  patch(assetId: string, patch: AssetPatch): Promise<AssetRecordLike | null>;
  /** Tenant plane delete (purge). */
  remove(assetId: string, workspaceId: string): Promise<boolean>;
  /** Media picker / results listing, newest first (tenant plane). */
  listByWorkspace(workspaceId: string, opts?: { purpose?: AssetPurposeLike; limit?: number }): Promise<AssetRecordLike[]>;
}

/* ------------------------------------------------------------------ *
 * Row mapping
 * ------------------------------------------------------------------ */

type AssetSqlRow = typeof assets.$inferSelect;

function mapAsset(row: AssetSqlRow): AssetRecordLike {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    mime: row.mime,
    sizeBytes: Number(row.sizeBytes),
    purpose: row.purpose as AssetPurposeLike,
    scanStatus: row.scanStatus as AssetScanStatusLike,
    variants: (row.variants as AssetVariants | null) ?? null,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------ *
 * Drizzle implementation
 * ------------------------------------------------------------------ */

export function createAssetsRepository(db: Database): AssetsRepoLike {
  return {
    async insert(row: NewAssetRecordLike): Promise<AssetRecordLike> {
      const inserted = await withTenantScope(db, row.workspaceId, async (tx) => {
        const rows = await tx
          .insert(assets)
          .values({
            id: row.id,
            workspaceId: row.workspaceId,
            key: row.key,
            mime: row.mime,
            sizeBytes: row.sizeBytes,
            purpose: row.purpose,
            scanStatus: row.scanStatus,
            confirmedAt: row.confirmedAt ?? null,
            variants: row.variants ?? null,
            ...(row.createdAt ? { createdAt: row.createdAt } : {}),
          })
          .onConflictDoNothing({ target: assets.key })
          .returning();
        return rows[0] ?? null;
      });
      // Unique-key conflict → the row exists from an earlier attempt
      // (at-most-once presign retry); return it — same tenant, same object.
      return inserted ? mapAsset(inserted) : await getByIdUnscoped(db, row.id);
    },

    async getById(workspaceId, assetId): Promise<AssetRecordLike | null> {
      return withTenantScope(db, workspaceId, async (tx) => {
        const rows = await tx
          .select()
          .from(assets)
          .where(and(eq(assets.id, assetId), eq(assets.workspaceId, workspaceId)))
          .limit(1);
        return rows[0] ? mapAsset(rows[0]) : null;
      });
    },

    async getByIdUnscoped(assetId): Promise<AssetRecordLike | null> {
      return getByIdUnscoped(db, assetId);
    },

    async patch(assetId, patch): Promise<AssetRecordLike | null> {
      const rows = await db
        .update(assets)
        .set({
          ...(patch.mime !== undefined ? { mime: patch.mime } : {}),
          ...(patch.scanStatus !== undefined ? { scanStatus: patch.scanStatus } : {}),
          ...(patch.variants !== undefined ? { variants: patch.variants } : {}),
          ...(patch.confirmedAt !== undefined ? { confirmedAt: patch.confirmedAt } : {}),
        })
        .where(eq(assets.id, assetId))
        .returning();
      return rows[0] ? mapAsset(rows[0]) : null;
    },

    async remove(assetId, workspaceId): Promise<boolean> {
      const removed = await withTenantScope(db, workspaceId, async (tx) => {
        const rows = await tx
          .delete(assets)
          .where(and(eq(assets.id, assetId), eq(assets.workspaceId, workspaceId)))
          .returning({ id: assets.id });
        return rows.length > 0;
      });
      return removed;
    },

    async listByWorkspace(workspaceId, opts = {}): Promise<AssetRecordLike[]> {
      return withTenantScope(db, workspaceId, async (tx) => {
        const rows = await tx
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.workspaceId, workspaceId),
              ...(opts.purpose ? [eq(assets.purpose, opts.purpose)] : []),
            ),
          )
          .orderBy(desc(assets.createdAt))
          .limit(opts.limit ?? 100);
        return rows.map(mapAsset);
      });
    },
  };
}

async function getByIdUnscoped(db: Database, assetId: string): Promise<AssetRecordLike | null> {
  const rows = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return rows[0] ? mapAsset(rows[0]) : null;
}
