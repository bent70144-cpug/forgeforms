// T18 (issue #18) — export job rows (spec §12 `exports` queue; Results → Exports
// screen shows job status + link).
//
// SPEC-NOTE: spec §6 does not define an `export_jobs` table, and schema/**
// is owned by T02 — so the table is declared HERE (new file, additive) with
// expand-compatible columns. When T02/T15 land a canonical table, re-point the
// import at @formforge/db schema and drop this declaration (contract migration).
//
// INTEGRATION-DEBT: `ExportJobStoreShape` mirrors the service-side
// ExportJobStore interface from @formforge/core/export; packages/db must not
// depend on core (deps rule), so the match is enforced structurally at the
// wiring site (apps/worker job handler). The integrator can collapse this
// duplication once db may import @formforge/core types.

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    /** User who requested the export (audit trail). */
    requestedBy: uuid("requested_by"),
    /** queued → running → completed | failed. */
    status: text("status").notNull().default("queued"),
    /** When the worker picked the job up (set by markRunning). */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Inclusive completedAt bounds requested via `{from?, to?}` (spec §11). */
    filterFrom: timestamp("filter_from", { withTimezone: true }),
    filterTo: timestamp("filter_to", { withTimezone: true }),
    rowCount: integer("row_count"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Object-store key of the generated CSV; the signed link is minted per request. */
    objectKey: text("object_key"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** When the signed link for this export stops being honoured. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("export_jobs_document_idx").on(table.documentId, table.createdAt)],
);

export type ExportJobRow = typeof exportJobs.$inferSelect;

export type CreateExportJobInput = {
  id: string;
  workspaceId: string;
  documentId: string;
  requestedBy?: string;
  filterFrom?: Date;
  filterTo?: Date;
};

export type ExportJobCompletion = {
  rowCount: number;
  sizeBytes: number;
  objectKey: string;
  expiresAt: Date;
};

/** Structural mirror of @formforge/core/export ExportJobStore (see header note). */
export type ExportJobStoreShape = {
  markRunning(exportId: string, workspaceId: string, at: Date): Promise<void>;
  markCompleted(
    exportId: string,
    workspaceId: string,
    data: ExportJobCompletion,
    at: Date,
  ): Promise<void>;
  markFailed(exportId: string, workspaceId: string, error: string, at: Date): Promise<void>;
};

/** Narrow driver surface — NodePgDatabase<Record<string, never>> as created by the T02 client. */
export type ExportJobsDb = NodePgDatabase<Record<string, never>>;

/**
 * Drizzle-backed export job repository. Every mutation is scoped by
 * `workspace_id` (spec §4 tenant safety) in addition to the unguessable
 * uuid primary key.
 */
export function createExportJobsRepo(db: ExportJobsDb) {
  return {
    /** Queues a new export job row (status defaults to "queued"). */
    async create(input: CreateExportJobInput): Promise<ExportJobRow> {
      const [row] = await db
        .insert(exportJobs)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          documentId: input.documentId,
          requestedBy: input.requestedBy,
          filterFrom: input.filterFrom,
          filterTo: input.filterTo,
        })
        .returning();
      if (!row) throw new Error("export_jobs: insert returned no row");
      return row;
    },

    async get(exportId: string, workspaceId: string): Promise<ExportJobRow | null> {
      const [row] = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, exportId), eq(exportJobs.workspaceId, workspaceId)))
        .limit(1);
      return row ?? null;
    },

    /** Newest-first job list for the Exports section of the Results screen. */
    async listByDocument(documentId: string, workspaceId: string, limit = 20): Promise<ExportJobRow[]> {
      return db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.documentId, documentId), eq(exportJobs.workspaceId, workspaceId)))
        .orderBy(desc(exportJobs.createdAt))
        .limit(limit);
    },

    async markRunning(exportId: string, workspaceId: string, at: Date): Promise<void> {
      await db
        .update(exportJobs)
        .set({ status: "running", startedAt: at })
        .where(and(eq(exportJobs.id, exportId), eq(exportJobs.workspaceId, workspaceId), eq(exportJobs.status, "queued")));
    },

    async markCompleted(
      exportId: string,
      workspaceId: string,
      data: ExportJobCompletion,
      at: Date,
    ): Promise<void> {
      await db
        .update(exportJobs)
        .set({
          status: "completed",
          rowCount: data.rowCount,
          sizeBytes: data.sizeBytes,
          objectKey: data.objectKey,
          expiresAt: data.expiresAt,
          completedAt: at,
          error: null,
        })
        .where(and(eq(exportJobs.id, exportId), eq(exportJobs.workspaceId, workspaceId)));
    },

    async markFailed(exportId: string, workspaceId: string, error: string, at: Date): Promise<void> {
      await db
        .update(exportJobs)
        .set({ status: "failed", error, completedAt: at })
        .where(and(eq(exportJobs.id, exportId), eq(exportJobs.workspaceId, workspaceId)));
    },
  } satisfies ExportJobStoreShape & {
    create(input: CreateExportJobInput): Promise<ExportJobRow>;
    get(exportId: string, workspaceId: string): Promise<ExportJobRow | null>;
    listByDocument(documentId: string, workspaceId: string, limit?: number): Promise<ExportJobRow[]>;
  };
}
