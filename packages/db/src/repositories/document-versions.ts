/**
 * T10 — SQL-backed `document_versions` repository (spec §6).
 *
 * NEW file under src/repositories/** (per packages/db ownership rules):
 * `document_versions` is insert-only — this repo deliberately exposes NO update
 * or delete path, which is what makes version rows immutable (issue #10).
 *
 * The repo talks to Postgres through a minimal `SqlExecutor` port so it works
 * with a `pg.Pool`, a `pg` transaction client, or drizzle's underlying driver
 * without importing the ORM schema (INTEGRATION-DEBT: awaiting T02 schema —
 * spec §6 fixes the column names; if they drift, fix them HERE only).
 *
 * Row-level security (spec §6): pass a transaction-scoped executor that already
 * ran `set local app.workspace_id = '<uuid>'`; every statement is additionally
 * workspace-scoped in its WHERE clause, so callers cannot cross tenants.
 */
import type {
  DocumentVersionInsert,
  DocumentVersionsRepo,
  DocumentVersionRecord,
} from '@formforge/core';

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  workspace_id: string;
  schema_version: number;
  body: unknown;
  created_by: string | null;
  created_at: unknown;
};

/** Minimal async query surface satisfied by pg Pool/Client and drizzle drivers. */
export interface SqlExecutor {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const COLUMNS = 'id, document_id, workspace_id, schema_version, body, created_by, created_at';

export function createDocumentVersionsRepo(exec: SqlExecutor): DocumentVersionsRepo {
  return {
    async insert(record: DocumentVersionInsert): Promise<DocumentVersionRecord> {
      const result = await exec.query(
        `insert into document_versions (${COLUMNS})
         values ($1, $2, $3, $4, $5::jsonb, $6, $7)
         on conflict (id) do nothing
         returning ${COLUMNS}`,
        [
          record.id,
          record.documentId,
          record.workspaceId,
          record.schemaVersion,
          JSON.stringify(record.body ?? null),
          record.createdBy,
          record.createdAt,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        // Insert-only table: a returning miss means the id already existed —
        // a programmer error (duplicate uuidv7), never a recoverable conflict.
        throw new Error(`document_versions: duplicate version id ${record.id}`);
      }
      return rowToRecord(row);
    },

    async listByDocument(workspaceId: string, documentId: string): Promise<DocumentVersionRecord[]> {
      const result = await exec.query(
        `select ${COLUMNS} from document_versions
         where workspace_id = $1 and document_id = $2
         order by created_at asc, id asc`,
        [workspaceId, documentId],
      );
      return result.rows.map(rowToRecord);
    },

    async getById(
      workspaceId: string,
      documentId: string,
      versionId: string,
    ): Promise<DocumentVersionRecord | null> {
      const result = await exec.query(
        `select ${COLUMNS} from document_versions
         where workspace_id = $1 and document_id = $2 and id = $3`,
        [workspaceId, documentId, versionId],
      );
      const row = result.rows[0];
      return row ? rowToRecord(row) : null;
    },
  };
}

function rowToRecord(row: Record<string, unknown>): DocumentVersionRecord {
  return {
    id: String(row['id']),
    documentId: String(row['document_id']),
    workspaceId: String(row['workspace_id']),
    schemaVersion: Number(row['schema_version']),
    body: row['body'],
    createdBy: row['created_by'] === null || row['created_by'] === undefined ? null : String(row['created_by']),
    createdAt: toDate(row['created_at']),
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`document_versions: unparseable created_at ${String(value)}`);
  }
  return parsed;
}
