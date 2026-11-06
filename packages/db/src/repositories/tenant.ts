// T04 — tenant-scoped repositories (spec §6 RLS note, ticket #4).
//
// Every tenant-scoped repository function takes `Ctx` first and:
//   1. opens a transaction,
//   2. sets `app.workspace_id` (transaction-local) from ctx.workspaceId,
//   3. assumes the restricted `formforge_app` role (`set local role`) so
//      Postgres row-level security binds even when the connection user is the
//      table owner or a superuser (owners/superusers bypass RLS otherwise),
//   4. ADDITIONALLY filters by ctx.workspaceId in the WHERE clause — RLS is
//      defense in depth, not a replacement for app-side scoping.
//
// The result: a query for another tenant's row returns 0 rows / NOT_FOUND —
// verified by the CI-gated integration test (tenant.rls.test.ts).

import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { AppError, uuidv7, type Ctx } from "@formforge/core";
import type { Database } from "../client.ts";
import {
  answers,
  documents,
  submissions,
  type DocumentStatus,
  type DocumentType,
  type NewDocumentRow,
  type AnswerTableRow,
  type DocumentRow,
  type SubmissionTableRow,
} from "../schema/tenancy.ts";

/** Transaction client handed to the callback (full drizzle query surface). */
type TxClient = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** General uuid form — seeds/tests may use non-v7 uuids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a tenant id before it ever reaches SQL. The sentinel values used
 * by pre-auth flows (`"system"`) must never enter an RLS transaction.
 */
export function assertWorkspaceId(workspaceId: string): string {
  if (!UUID_RE.test(workspaceId)) {
    throw new AppError(
      "INTERNAL",
      `withTenantScope requires a uuid workspace id, got "${workspaceId}"`,
    );
  }
  return workspaceId.toLowerCase();
}

/**
 * Parameterized, transaction-local tenant scope. `set_config(..., true)` is
 * the statement form of `set local` — safe inside drizzle transactions and
 * injectable-testable (no string interpolation of the id).
 */
export function tenantScopeSql(workspaceId: string): SQL {
  return sql`select set_config('app.workspace_id', ${assertWorkspaceId(workspaceId)}, true)`;
}

/** Assume the restricted app role for the remainder of the transaction. */
export function tenantRoleSql(): SQL {
  return sql.raw("set local role formforge_app");
}

/** Login-plane scope (memberships of the caller across workspaces). */
export function userScopeSql(userId: string): SQL {
  if (!UUID_RE.test(userId)) {
    throw new AppError("INTERNAL", `withUserScope requires a uuid user id, got "${userId}"`);
  }
  return sql`select set_config('app.user_id', ${userId.toLowerCase()}, true)`;
}

/**
 * Run `fn` inside a transaction bound to exactly one workspace. Rejects
 * non-uuid workspace ids (fail closed) and rolls back on any error.
 */
export async function withTenantScope<T>(
  db: Database,
  workspaceId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(tenantScopeSql(workspaceId));
    await tx.execute(tenantRoleSql());
    return fn(tx);
  });
}

/** Like withTenantScope, but for the login plane (app.user_id arm). */
export async function withUserScope<T>(
  db: Database,
  userId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(userScopeSql(userId));
    await tx.execute(tenantRoleSql());
    return fn(tx);
  });
}

/** For repositories that already own a transaction (e.g. T14 ingest). */
export async function applyTenantScope(tx: TxClient, workspaceId: string): Promise<void> {
  await tx.execute(tenantScopeSql(workspaceId));
  await tx.execute(tenantRoleSql());
}

/* ---------------------------------------------------------------------------
 * Documents (tenant plane)
 * ------------------------------------------------------------------------- */

export type DocumentCreateInput = {
  id?: string;
  type: DocumentType;
  title: string;
  slug: string;
  draft: Record<string, unknown>;
  createdBy?: string | null;
};

export type PublishStatePatch = {
  status: "published" | "draft";
  publishedVersionId: string | null;
};

export type DocumentListFilter = {
  status?: DocumentStatus;
  type?: DocumentType;
  limit?: number;
};

export interface TenantDocumentsRepo {
  /** Forged/foreign document ids resolve to null (never a cross-tenant row). */
  getById(ctx: Ctx, documentId: string): Promise<DocumentRow | null>;
  list(ctx: Ctx, filter?: DocumentListFilter): Promise<DocumentRow[]>;
  /** Slug is unique per workspace (spec §6). */
  findBySlug(ctx: Ctx, slug: string): Promise<DocumentRow | null>;
  create(ctx: Ctx, input: DocumentCreateInput): Promise<DocumentRow>;
  updatePublishState(
    ctx: Ctx,
    documentId: string,
    patch: PublishStatePatch,
  ): Promise<DocumentRow>;
  /** Soft-delete per spec §11 (DELETE → archive). */
  archive(ctx: Ctx, documentId: string): Promise<DocumentRow>;
}

function createDocumentsRepo(db: Database): TenantDocumentsRepo {
  return {
    async getById(ctx, documentId) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const rows = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, documentId), eq(documents.workspaceId, ctx.workspaceId)))
          .limit(1);
        return rows[0] ?? null;
      });
    },

    async list(ctx, filter = {}) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const conditions = [eq(documents.workspaceId, ctx.workspaceId)];
        if (filter.status) conditions.push(eq(documents.status, filter.status));
        if (filter.type) conditions.push(eq(documents.type, filter.type));
        return await tx
          .select()
          .from(documents)
          .where(and(...conditions))
          .orderBy(desc(documents.updatedAt))
          .limit(filter.limit ?? 100);
      });
    },

    async findBySlug(ctx, slug) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const rows = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.slug, slug), eq(documents.workspaceId, ctx.workspaceId)))
          .limit(1);
        return rows[0] ?? null;
      });
    },

    async create(ctx, input) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const row: NewDocumentRow = {
          id: input.id ?? uuidv7(ctx.now().getTime()),
          workspaceId: ctx.workspaceId,
          type: input.type,
          title: input.title,
          slug: input.slug,
          status: "draft",
          rev: 0,
          draft: input.draft,
          createdBy: input.createdBy ?? null,
          createdAt: ctx.now(),
          updatedAt: ctx.now(),
        };
        const rows = await tx.insert(documents).values(row).returning();
        return rows[0]!;
      });
    },

    async updatePublishState(ctx, documentId, patch) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const rows = await tx
          .update(documents)
          .set({
            status: patch.status,
            publishedVersionId: patch.publishedVersionId,
            updatedAt: ctx.now(),
          })
          .where(
            and(eq(documents.id, documentId), eq(documents.workspaceId, ctx.workspaceId)),
          )
          .returning();
        // 0 rows ⇒ the document does not exist IN THIS TENANT (foreign or
        // forged ids are indistinguishable from missing ones — spec §4).
        if (!rows[0]) {
          throw AppError.notFound(`Document ${documentId} not found`);
        }
        return rows[0];
      });
    },

    async archive(ctx, documentId) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const rows = await tx
          .update(documents)
          .set({ status: "archived", updatedAt: ctx.now() })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.workspaceId, ctx.workspaceId),
              // idempotent: already-archived rows stay untouched
              ne(documents.status, "archived"),
            ),
          )
          .returning();
        if (!rows[0]) throw AppError.notFound(`Document ${documentId} not found`);
        return rows[0];
      });
    },
  };
}

/* ---------------------------------------------------------------------------
 * Submissions & answers (tenant plane, submissions:read)
 * ------------------------------------------------------------------------- */

export interface TenantSubmissionsRepo {
  listByDocument(ctx: Ctx, documentId: string, limit?: number): Promise<SubmissionTableRow[]>;
  getSubmission(ctx: Ctx, submissionId: string): Promise<SubmissionTableRow | null>;
  listAnswers(ctx: Ctx, submissionId: string): Promise<AnswerTableRow[]>;
}

function createSubmissionsRepo(db: Database): TenantSubmissionsRepo {
  return {
    async listByDocument(ctx, documentId, limit = 100) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        return tx
          .select()
          .from(submissions)
          .where(
            and(eq(submissions.documentId, documentId), eq(submissions.workspaceId, ctx.workspaceId)),
          )
          .orderBy(desc(submissions.startedAt))
          .limit(limit);
      });
    },

    async getSubmission(ctx, submissionId) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const rows = await tx
          .select()
          .from(submissions)
          .where(
            and(eq(submissions.id, submissionId), eq(submissions.workspaceId, ctx.workspaceId)),
          )
          .limit(1);
        return rows[0] ?? null;
      });
    },

    async listAnswers(ctx, submissionId) {
      return withTenantScope(db, ctx.workspaceId, async (tx) => {
        const parent = await tx
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(eq(submissions.id, submissionId), eq(submissions.workspaceId, ctx.workspaceId)),
          )
          .limit(1);
        if (!parent[0]) return [];
        return tx
          .select()
          .from(answers)
          .where(eq(answers.submissionId, submissionId))
          .orderBy(asc(answers.blockId));
      });
    },
  };
}

/* ---------------------------------------------------------------------------
 * Factory
 * ------------------------------------------------------------------------- */

export function createTenantRepositories(db: Database) {
  return {
    documents: createDocumentsRepo(db),
    submissions: createSubmissionsRepo(db),
  };
}

export type TenantRepositories = ReturnType<typeof createTenantRepositories>;
