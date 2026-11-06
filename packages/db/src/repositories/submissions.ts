// packages/db/src/repositories/submissions.ts
// OWNED BY T14 (issue #14) — drizzle repositories backing the public ingest
// API. Implements, structurally, the `SubmissionsRepo` / `SnapshotReader`
// ports declared in @formforge/core (packages/db must not import core, so the
// DTO shapes are kept structurally equal and checked at the wiring site).
//
// INTEGRATION-DEBT: awaiting T02 — src/schema/** is not owned by T14, so these
// repositories use parameterized raw SQL through drizzle's `sql` templates
// instead of typed table refs. Swap to the typed schema once T02 lands.
// SPEC-NOTE: RLS/tenant context (spec §17) requires the T02 db client to
// `SET LOCAL app.workspace_id`; wire that here when available.

import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/* ------------------------------------------------------------------ *
 * DTOs (structural mirrors of @formforge/core submissions ports)
 * ------------------------------------------------------------------ */

export type SubmissionStatus = "draft" | "completed" | "spam";

export type SubmissionRow = {
  id: string;
  workspaceId: string;
  documentId: string;
  versionId: string;
  status: SubmissionStatus;
  publicToken: string;
  variables: Record<string, unknown>;
  hidden: Record<string, unknown>;
  meta: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
};

export type NewSubmissionRow = Omit<SubmissionRow, "completedAt"> & { completedAt: null };

export type AnswerRow = { blockId: string; value: unknown; updatedAt: Date };

export type AnswerUpsert = { blockId: string; value: unknown; updatedAt: Date };

export interface SubmissionsRepoLike {
  insertSubmission(row: NewSubmissionRow): Promise<void>;
  getSubmissionByToken(publicToken: string): Promise<SubmissionRow | null>;
  updateVariables(submissionId: string, variables: Record<string, unknown>): Promise<void>;
  upsertAnswersIfNewer(submissionId: string, answers: AnswerUpsert[]): Promise<string[]>;
  upsertAnswersOverwrite(submissionId: string, answers: AnswerUpsert[]): Promise<void>;
  listAnswers(submissionId: string): Promise<AnswerRow[]>;
  countCompleted(documentId: string): Promise<number>;
  finalizeSubmission(
    submissionId: string,
    patch: { status: SubmissionStatus; completedAt: Date | null; variables: Record<string, unknown> },
  ): Promise<void>;
  transaction<T>(fn: (tx: SubmissionsRepoLike) => Promise<T>): Promise<T>;
}

export type SnapshotEndingLike = { id: string; title: string; body?: string; redirectUrl?: string };

/** Published snapshot DTO (structural mirror of core `Snapshot`). */
export type SnapshotLike = {
  documentId: string;
  workspaceId: string;
  versionId: string;
  type: "form" | "page" | "portfolio";
  title: string;
  blocks: unknown[];
  endings: SnapshotEndingLike[];
  routing: Record<string, unknown>;
  settings: {
    progressBar?: boolean;
    autoAdvance?: boolean;
    showBranding?: boolean;
    captcha?: boolean;
    closeAt?: string;
    maxSubmissions?: number;
  };
  /** Raw compiled-logic rules pass-through, for wiring fallbacks (see below). */
  logicRules?: unknown[];
};

/* ------------------------------------------------------------------ *
 * Row mapping
 * ------------------------------------------------------------------ */

type SubmissionSqlRow = {
  id: string;
  workspace_id: string;
  document_id: string;
  version_id: string;
  status: string;
  public_token: string;
  variables: unknown;
  hidden: unknown;
  meta: unknown;
  started_at: Date;
  completed_at: Date | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapSubmission(row: SubmissionSqlRow): SubmissionRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    versionId: row.version_id,
    status: (row.status === "completed" || row.status === "spam" ? row.status : "draft") as SubmissionStatus,
    publicToken: row.public_token,
    variables: asRecord(row.variables),
    hidden: asRecord(row.hidden),
    meta: asRecord(row.meta),
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

const SUBMISSION_COLUMNS = sql`id, workspace_id, document_id, version_id, status, public_token, variables, hidden, meta, started_at, completed_at`;

/* ------------------------------------------------------------------ *
 * Drizzle implementation
 * ------------------------------------------------------------------ */

export function createDrizzleSubmissionsRepo(
  db: NodePgDatabase<Record<string, never>>,
): SubmissionsRepoLike {
  return {
    async insertSubmission(row: NewSubmissionRow): Promise<void> {
      await db.execute(sql`
        insert into submissions
          (id, workspace_id, document_id, version_id, status, public_token, variables, hidden, meta, started_at, completed_at)
        values (
          ${row.id}::uuid,
          ${row.workspaceId}::uuid,
          ${row.documentId}::uuid,
          ${row.versionId}::uuid,
          ${row.status},
          ${row.publicToken},
          ${JSON.stringify(row.variables)}::jsonb,
          ${JSON.stringify(row.hidden)}::jsonb,
          ${JSON.stringify(row.meta)}::jsonb,
          ${row.startedAt},
          ${row.completedAt}
        )
      `);
    },

    async getSubmissionByToken(publicToken: string): Promise<SubmissionRow | null> {
      const result = await db.execute<SubmissionSqlRow>(sql`
        select ${SUBMISSION_COLUMNS}
        from submissions
        where public_token = ${publicToken}
        limit 1
      `);
      const row = result.rows[0];
      return row ? mapSubmission(row) : null;
    },

    async updateVariables(submissionId: string, variables: Record<string, unknown>): Promise<void> {
      await db.execute(sql`
        update submissions
        set variables = ${JSON.stringify(variables)}::jsonb
        where id = ${submissionId}::uuid
      `);
    },

    async upsertAnswersIfNewer(submissionId: string, answers: AnswerUpsert[]): Promise<string[]> {
      if (answers.length === 0) return [];
      const values = sql.join(
        answers.map(
          (a) =>
            sql`(${submissionId}::uuid, ${a.blockId}, ${JSON.stringify(a.value)}::jsonb, ${a.updatedAt})`,
        ),
        sql`, `,
      );
      const result = await db.execute<{ block_id: string }>(sql`
        insert into answers (submission_id, block_id, value, updated_at)
        values ${values}
        on conflict (submission_id, block_id) do update
          set value = excluded.value,
              updated_at = excluded.updated_at
          where answers.updated_at < excluded.updated_at
        returning block_id
      `);
      return result.rows.map((row) => row.block_id);
    },

    async upsertAnswersOverwrite(submissionId: string, answers: AnswerUpsert[]): Promise<void> {
      if (answers.length === 0) return;
      const values = sql.join(
        answers.map(
          (a) =>
            sql`(${submissionId}::uuid, ${a.blockId}, ${JSON.stringify(a.value)}::jsonb, ${a.updatedAt})`,
        ),
        sql`, `,
      );
      await db.execute(sql`
        insert into answers (submission_id, block_id, value, updated_at)
        values ${values}
        on conflict (submission_id, block_id) do update
          set value = excluded.value,
              updated_at = excluded.updated_at
      `);
    },

    async listAnswers(submissionId: string): Promise<AnswerRow[]> {
      const result = await db.execute<{ block_id: string; value: unknown; updated_at: Date }>(sql`
        select block_id, value, updated_at
        from answers
        where submission_id = ${submissionId}::uuid
        order by updated_at asc
      `);
      return result.rows.map((row) => ({
        blockId: row.block_id,
        value: row.value,
        updatedAt: new Date(row.updated_at),
      }));
    },

    async countCompleted(documentId: string): Promise<number> {
      const result = await db.execute<{ count: number }>(sql`
        select count(*)::int as count
        from submissions
        where document_id = ${documentId}::uuid and status = 'completed'
      `);
      return Number(result.rows[0]?.count ?? 0);
    },

    async finalizeSubmission(
      submissionId: string,
      patch: { status: SubmissionStatus; completedAt: Date | null; variables: Record<string, unknown> },
    ): Promise<void> {
      await db.execute(sql`
        update submissions
        set status = ${patch.status},
            completed_at = ${patch.completedAt},
            variables = ${JSON.stringify(patch.variables)}::jsonb
        where id = ${submissionId}::uuid
      `);
    },

    async transaction<T>(fn: (tx: SubmissionsRepoLike) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => fn(createDrizzleSubmissionsRepo(tx)));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Published-snapshot reader (ingest view)
 * INTEGRATION-DEBT: awaiting T10 getPublishedSnapshot — replace the wiring
 * with the real reader; this minimal version joins documents + snapshots and
 * passes `rendered` through per spec §8.
 * ------------------------------------------------------------------ */

type SnapshotSqlRow = {
  document_id: string;
  workspace_id: string;
  version_id: string;
  type: string;
  title: string;
  rendered: unknown;
};

type RenderedLike = {
  blocks?: unknown[];
  endings?: SnapshotEndingLike[];
  routing?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  logic?: { rules?: unknown[] };
  title?: string;
};

export function createDrizzleIngestSnapshotReader(db: NodePgDatabase<Record<string, never>>) {
  return {
    async getPublishedSnapshot(documentId: string): Promise<SnapshotLike | null> {
      const result = await db.execute<SnapshotSqlRow>(sql`
        select d.id as document_id,
               d.workspace_id,
               d.published_version_id as version_id,
               d.type,
               d.title,
               s.rendered
        from documents d
        join snapshots s on s.document_id = d.id
        where d.id = ${documentId}::uuid
          and d.status = 'published'
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      const rendered = asRecord(row.rendered) as RenderedLike;
      const settings = asRecord(rendered.settings);
      return {
        documentId: row.document_id,
        workspaceId: row.workspace_id,
        versionId: row.version_id,
        type: row.type === "page" || row.type === "portfolio" ? row.type : "form",
        title: typeof rendered.title === "string" ? rendered.title : row.title,
        blocks: Array.isArray(rendered.blocks) ? rendered.blocks : [],
        endings: Array.isArray(rendered.endings) ? rendered.endings : [],
        // INTEGRATION-DEBT: T10 compiles logic into `rendered.routing`; when
        // absent we pass rules through so the wiring can compile them.
        routing: asRecord(rendered.routing),
        settings: {
          progressBar: settings.progressBar as boolean | undefined,
          autoAdvance: settings.autoAdvance as boolean | undefined,
          showBranding: settings.showBranding as boolean | undefined,
          captcha: settings.captcha === true,
          closeAt: typeof settings.closeAt === "string" ? settings.closeAt : undefined,
          maxSubmissions:
            typeof settings.maxSubmissions === "number" ? settings.maxSubmissions : undefined,
        },
        logicRules: rendered.logic?.rules ?? [],
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Connection helper (keeps pg/drizzle out of apps/web dependencies)
 * ------------------------------------------------------------------ */

export async function connectSubmissionsStore(databaseUrl: string): Promise<{
  repo: SubmissionsRepoLike;
  snapshots: ReturnType<typeof createDrizzleIngestSnapshotReader>;
  sql: (query: SQL) => Promise<{ rows: Record<string, unknown>[] }>;
  close: () => Promise<void>;
}> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool);
  return {
    repo: createDrizzleSubmissionsRepo(db),
    snapshots: createDrizzleIngestSnapshotReader(db),
    sql: async (query) => {
      const result = await db.execute(query);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    close: () => pool.end(),
  };
}
