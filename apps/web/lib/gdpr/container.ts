// T29 (spec §17 GDPR) — composition root for the GDPR services.
//
// Store selection mirrors lib/api/documents.ts:
//   DATABASE_URL set → SQL stores (packages/db/src/repositories/gdpr.ts);
//   otherwise        → in-memory stores (@formforge/core/gdpr/testing).
//
// Routes call the service functions with a workspaceId / userId derived from
// the session — a request can never touch another tenant's export/deletion.
import {
  deleteAccount,
  exportWorkspaceData,
  purgeExpiredWorkspaces,
  requestWorkspaceDeletion,
  createInMemoryGdprStores,
  type AccountDeletionOutcome,
  type PurgeRunSummary,
  type WorkspaceExport,
} from "@formforge/core/gdpr";
import type { AppError } from "@formforge/core";
import {
  createGdprAccountStore,
  createGdprExportStore,
  createGdprWorkspaceStore,
} from "@formforge/db/repositories/gdpr";
import { Pool } from "pg";

type SqlExec = {
  query: (text: string, params?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

let sqlExecutor: SqlExec | null = null;

function getSqlExecutor(): SqlExec {
  if (!sqlExecutor) {
    const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
    sqlExecutor = {
      async query(text: string, params?: readonly unknown[]) {
        const result = await pool.query(text, (params ?? []) as unknown[]);
        return { rows: result.rows as Record<string, unknown>[] };
      },
    };
  }
  return sqlExecutor;
}

const usingSql = (): boolean => !!process.env["DATABASE_URL"];

// Shared store bundle: export + workspace lifecycle + account deletion.
type GdprStores = ReturnType<typeof buildStores>;

let stores: GdprStores | null = null;

function buildStores() {
  if (usingSql()) {
    const exec = getSqlExecutor();
    return {
      export: createGdprExportStore(exec),
      workspaces: createGdprWorkspaceStore(exec),
      accounts: createGdprAccountStore(exec),
    };
  }
  // Dev/test composition (no DATABASE_URL) — in-memory, DB-free.
  const inMemory = createInMemoryGdprStores();
  return {
    export: inMemory.exports,
    workspaces: inMemory.workspaces,
    accounts: inMemory.accounts,
  };
}

function getStores(): GdprStores {
  if (!stores) stores = buildStores();
  return stores;
}

const now = (): Date => new Date();

/** Grace window (days) before a scheduled workspace is hard-purged. */
export const WORKSPACE_GRACE_DAYS = Number(
  process.env["GDPR_WORKSPACE_GRACE_DAYS"] ?? 30,
);

/** Phase 1 of workspace erasure: mark deleted (30-day grace by default). */
export async function requestWorkspaceDeletionForSession(
  workspaceId: string,
): Promise<{ ok: true; value: { scheduled: true; deletedAt: string } } | { ok: false; error: AppError }> {
  const result = await requestWorkspaceDeletion(
    { workspaces: getStores().workspaces, now },
    workspaceId,
  );
  return result;
}

/** Phase 2 (maintenance/ops): hard-purge workspaces past their grace window. */
export async function runWorkspacePurge(options?: {
  graceDays?: number;
  limit?: number;
}): Promise<PurgeRunSummary> {
  return purgeExpiredWorkspaces({ workspaces: getStores().workspaces, now }, options);
}

/** The full workspace archive (GDPR data export / right to portability). */
export async function exportWorkspaceForSession(
  workspaceId: string,
): Promise<{ ok: true; value: WorkspaceExport } | { ok: false; error: AppError }> {
  return exportWorkspaceData({ exports: getStores().export, now }, {
    workspaceId,
    actor: { type: "user", id: "gdpr-export" },
    requestId: crypto.randomUUID(),
    now,
  });
}

/** Account erasure (right to be forgotten) — cascades sole-owned workspaces. */
export async function deleteAccountForSession(
  userId: string,
): Promise<{ ok: true; value: AccountDeletionOutcome } | { ok: false; error: AppError }> {
  return deleteAccount(
    {
      accounts: getStores().accounts,
      workspaces: getStores().workspaces,
      defaultGraceDays: WORKSPACE_GRACE_DAYS,
      now,
    },
    userId,
  );
}

/** Test seam: swap the store bundle (unit tests inject in-memory fakes). */
export function configureGdprStores(next: GdprStores): void {
  stores = next;
}
