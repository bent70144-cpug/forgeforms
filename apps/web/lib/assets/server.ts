// apps/web/lib/assets/server.ts
// Production wiring for the T16 upload service (mirrors the ingest wiring in
// app/api/public/ingest/_lib/deps.ts): the composition root that assembles
// @formforge/core's createAssetsService from the real adapters, memoized per
// process (survives Next dev HMR via globalThis).
//
// Ports:
//   store         ← @formforge/core objectStoreFromEnv (S3/MinIO via env,
//                   in-memory dev fallback — same factory the worker uses)
//   repo          ← @formforge/db assets repository (RLS-bound tenant plane)
//   queue         ← `assets` BullMQ publisher (capturing fallback w/o Redis)
//   entitlements  ← billing service (§13 fileUploadMaxMb; 10 MB free/pro,
//                   50 MB business) — the ONLY plan source (§4)
//   published doc ← drizzle ingest snapshot reader (public plane resolves the
//                   workspace from the documentId of a PUBLISHED document)
//
// INTEGRATION-DEBT: a ClamAV scanner is not wired in web (the worker owns the
// scan step; dev marks `skipped`). Rate limiting on the public upload routes
// follows the ingest per-process limiter posture — see the route files.

import {
  createAssetsService,
  objectStoreFromEnv,
  type AssetRecord,
  type AssetsService,
  type UploadEntitlements,
} from "@formforge/core/assets";
import { parseDocumentId, uuidv7 } from "@formforge/core";;
import { createAssetsRepository, createDb, type AssetsRepoLike } from "@formforge/db";
import { createDrizzleIngestSnapshotReader } from "@formforge/db/repositories/submissions";
import { createBillingFromEnv } from "../../app/api/webhooks/stripe/_lib/billing-server";
import { assetsQueueFromEnv } from "./queue";

/** Public-plane seams (documentId is the only credential a respondent has). */
export type PublicAssetsDeps = {
  service: AssetsService;
  /** PUBLISHED documentId → workspaceId; null for missing/unpublished. */
  resolvePublishedWorkspace(documentId: string): Promise<string | null>;
};

/** Authenticated-plane seams (the v1 routes' ctx supplies the workspace). */
export type TenantAssetsDeps = {
  service: AssetsService;
};

type Wiring = {
  publicDeps: PublicAssetsDeps;
  tenantDeps: TenantAssetsDeps;
  /** Raw db repo (adds `listByWorkspace` on top of the core AssetRepo port). */
  tenantRepo: AssetsRepoLike;
};

const globalStore = globalThis as unknown as { __ffAssetsWiring?: Wiring };

export function getPublicAssetsDeps(): PublicAssetsDeps {
  return getWiring().publicDeps;
}

export function getTenantAssetsService(): AssetsService {
  return getWiring().tenantDeps.service;
}

/** Tenant-plane repo for the workspace media LIST (GET /api/v1/assets, §10):
 * the core `AssetRepo` port intentionally has no list method, the db repo does. */
export function getTenantAssetsRepo(): AssetsRepoLike {
  return getWiring().tenantRepo;
}

function getWiring(): Wiring {
  globalStore.__ffAssetsWiring ??= buildWiring();
  return globalStore.__ffAssetsWiring;
}

function buildWiring(): Wiring {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the assets upload API");
  }

  // One drizzle handle, two views: the schema-typed Database the assets repo
  // expects and the loose reader type the snapshot reader takes (same cast
  // posture as connectSubmissionsStore — pg/drizzle stay in packages/db).
  const db = createDb(databaseUrl);

  const repo = createAssetsRepository(db);
  const snapshots = createDrizzleIngestSnapshotReader(
    db as unknown as Parameters<typeof createDrizzleIngestSnapshotReader>[0],
  );

  const billing = createBillingFromEnv();
  const entitlements: UploadEntitlements = {
    // §13: fileUploadMaxMb (10 free/pro, 50 business) — value sourced ONLY
    // from billing; unknown workspaces resolve to `free` inside billing.
    getEntitlements: async (workspaceId) => {
      const row = await billing.getEntitlements(workspaceId);
      return { fileUploadMaxMb: row.fileUploadMaxMb };
    },
  };

  const service = createAssetsService({
    store: objectStoreFromEnv(process.env),
    repo: {
      // Adapt the db repo to the core port (extra listByWorkspace is additive).
      insert: (row: AssetRecord) => repo.insert(row),
      getById: (workspaceId, assetId) => repo.getById(workspaceId, assetId),
      getByIdUnscoped: (assetId) => repo.getByIdUnscoped(assetId),
      patch: (assetId, patch) => repo.patch(assetId, patch),
      remove: (assetId, workspaceId) => repo.remove(assetId, workspaceId),
    },
    queue: assetsQueueFromEnv(),
    entitlements,
    now: () => new Date(),
    // Spec §4: UUIDv7 generated in the app (same kernel helper as ingest).
    generateId: uuidv7,
  });

  return {
    publicDeps: {
      service,
      resolvePublishedWorkspace: async (documentId: string) => {
        const id = parseDocumentId(documentId);
        if (!id) return null;
        const snapshot = await snapshots.getPublishedSnapshot(id);
        return snapshot?.workspaceId ?? null;
      },
    },
    tenantDeps: { service },
    tenantRepo: repo,
  };
}
