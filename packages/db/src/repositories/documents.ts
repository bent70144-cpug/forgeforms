/**
 * T07 — SQL-backed `documents` repository (spec §6) implementing the core
 * `CrudDocumentsRepo` port: the publish-pipeline methods (getById / findBySlug /
 * updatePublishState) plus the CRUD + autosave primitives (insert / list /
 * updateDraft / setStatus).
 *
 * Talks to Postgres through the minimal `SqlExecutor` port (pg Pool/Client or a
 * drizzle driver) — same pattern as document-versions.ts. Every statement is
 * workspace-scoped in its WHERE clause; pass a transaction-scoped executor that
 * already ran `set local app.workspace_id = '<uuid>'` for RLS enforcement.
 *
 * `updateDraft` is the autosave concurrency primitive (spec §8): a single
 * conditional UPDATE `… WHERE rev = expectedRev … SET rev = rev + 1` — atomic
 * in Postgres, returns 'CONFLICT' when no row matched.
 */
import type {
  CrudDocumentsRepo,
  DraftPatch,
  DocumentRecord,
  ListDocumentsPage,
  ListDocumentsQuery,
  PublishStatePatch,
  Snapshot,
  SnapshotRecord,
  SnapshotsRepo,
} from '@formforge/core';
import { decodeDocumentCursor, encodeDocumentCursor } from '@formforge/core';
import type { SqlExecutor } from './document-versions';

const DOC_COLUMNS =
  'id, workspace_id, type, title, slug, status, rev, draft, published_version_id, created_by, created_at, updated_at';

const LIST_LIMIT_MAX = 100;

export function createSqlDocumentsRepo(exec: SqlExecutor): CrudDocumentsRepo {
  return {
    async getById(workspaceId: string, documentId: string): Promise<DocumentRecord | null> {
      const result = await exec.query(
        `select ${DOC_COLUMNS} from documents where workspace_id = $1 and id = $2`,
        [workspaceId, documentId],
      );
      return result.rows[0] ? rowToRecord(result.rows[0]!) : null;
    },

    async findBySlug(workspaceSlug: string | null, docSlug: string): Promise<DocumentRecord | null> {
      // workspaceSlug is a workspace ID in this implementation (the public
      // plane passes the workspace id or null); null matches any workspace.
      if (workspaceSlug === null) {
        const result = await exec.query(
          `select ${DOC_COLUMNS} from documents where slug = $1 limit 2`,
          [docSlug],
        );
        return result.rows[0] ? rowToRecord(result.rows[0]!) : null;
      }
      const result = await exec.query(
        `select ${DOC_COLUMNS} from documents where workspace_id = $1 and slug = $2 limit 2`,
        [workspaceSlug, docSlug],
      );
      return result.rows[0] ? rowToRecord(result.rows[0]!) : null;
    },

    async updatePublishState(
      workspaceId: string,
      documentId: string,
      patch: PublishStatePatch,
    ): Promise<DocumentRecord> {
      const result = await exec.query(
        `update documents
         set status = $3, published_version_id = $4, updated_at = $5
         where workspace_id = $1 and id = $2
         returning ${DOC_COLUMNS}`,
        [workspaceId, documentId, patch.status, patch.publishedVersionId, patch.updatedAt],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`documents.updatePublishState: unknown document ${documentId}`);
      return rowToRecord(row);
    },

    async insert(record: DocumentRecord): Promise<DocumentRecord> {
      const result = await exec.query(
        `insert into documents (${DOC_COLUMNS})
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
         returning ${DOC_COLUMNS}`,
        [
          record.id,
          record.workspaceId,
          record.type,
          record.title,
          record.slug,
          record.status,
          record.rev,
          JSON.stringify(record.draft ?? null),
          record.publishedVersionId,
          record.createdBy,
          record.createdAt,
          record.updatedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`documents.insert: failed for ${record.id}`);
      return rowToRecord(row);
    },

    async list(workspaceId: string, query: ListDocumentsQuery): Promise<ListDocumentsPage> {
      const limit = Math.max(1, Math.min(Math.round(query.limit) || 50, LIST_LIMIT_MAX));
      const clauses: string[] = ['workspace_id = $1'];
      const params: unknown[] = [workspaceId];
      const bind = (value: unknown): string => {
        params.push(value);
        return `$${params.length}`;
      };

      if (query.type) clauses.push(`type = ${bind(query.type)}`);
      if (query.status) clauses.push(`status = ${bind(query.status)}`);
      if (query.q) {
        // Escape LIKE metacharacters so user input can never widen the filter.
        clauses.push(`title ilike ${bind(`%${query.q.replace(/([%_\\])/g, '\\$1')}%`)}`);
      }
      const cursor = query.cursor ? decodeDocumentCursor(query.cursor) : null;
      if (cursor) {
        // Keyset pagination over (workspace_id, updated_at desc, id desc).
        clauses.push(`(updated_at, id) < (${bind(new Date(cursor.updatedAtMs))}::timestamptz, ${bind(cursor.id)}::uuid)`);
      }

      // +1 probe row to compute nextCursor without a count query.
      params.push(limit + 1);
      const probeParam = `$${params.length}`;
      const result = await exec.query(
        `select ${DOC_COLUMNS} from documents
         where ${clauses.join(' and ')}
         order by updated_at desc, id desc
         limit ${probeParam}`,
        params,
      );
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(rowToRecord);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: hasMore && last ? encodeDocumentCursor(last.updatedAt, last.id) : null,
      };
    },

    async updateDraft(
      workspaceId: string,
      documentId: string,
      expectedRev: number,
      patch: DraftPatch,
      updatedAt: Date,
    ): Promise<DocumentRecord | 'CONFLICT'> {
      const result = await exec.query(
        `update documents set
           title = coalesce($4, title),
           slug = coalesce($5, slug),
           draft = coalesce($6::jsonb, draft),
           rev = rev + 1,
           updated_at = $7
         where workspace_id = $1 and id = $2 and rev = $3
         returning ${DOC_COLUMNS}`,
        [
          workspaceId,
          documentId,
          expectedRev,
          patch.title ?? null,
          patch.slug ?? null,
          patch.draft !== undefined ? JSON.stringify(patch.draft) : null,
          updatedAt,
        ],
      );
      const row = result.rows[0];
      return row ? rowToRecord(row) : 'CONFLICT';
    },

    async setStatus(
      workspaceId: string,
      documentId: string,
      status: DocumentRecord['status'],
      updatedAt: Date,
    ): Promise<DocumentRecord | null> {
      const result = await exec.query(
        `update documents set status = $3, updated_at = $4
         where workspace_id = $1 and id = $2
         returning ${DOC_COLUMNS}`,
        [workspaceId, documentId, status, updatedAt],
      );
      return result.rows[0] ? rowToRecord(result.rows[0]!) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// T07 — SQL snapshots repository (completes the publish-pipeline DB wiring)
// ---------------------------------------------------------------------------

const SNAPSHOT_COLUMNS = 'document_id, version_id, rendered, etag, built_at';

export function createSqlSnapshotsRepo(exec: SqlExecutor): SnapshotsRepo {
  return {
    async upsert(record): Promise<SnapshotRecord> {
      const result = await exec.query(
        `insert into snapshots (${SNAPSHOT_COLUMNS})
         values ($1, $2, $3::jsonb, $4, $5)
         on conflict (document_id) do update
           set version_id = excluded.version_id,
               rendered = excluded.rendered,
               etag = excluded.etag,
               built_at = excluded.built_at
         returning ${SNAPSHOT_COLUMNS}`,
        [
          record.documentId,
          record.versionId,
          JSON.stringify(record.rendered),
          record.etag,
          record.builtAt,
        ],
      );
      return rowToSnapshot(result.rows[0]!);
    },

    async getByDocumentId(documentId): Promise<SnapshotRecord | null> {
      const result = await exec.query(
        `select ${SNAPSHOT_COLUMNS} from snapshots where document_id = $1`,
        [documentId],
      );
      return result.rows[0] ? rowToSnapshot(result.rows[0]!) : null;
    },

    async deleteByDocumentId(documentId): Promise<void> {
      await exec.query(`delete from snapshots where document_id = $1`, [documentId]);
    },
  };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToRecord(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row['id']),
    workspaceId: String(row['workspace_id']),
    type: String(row['type']) as DocumentRecord['type'],
    title: String(row['title']),
    slug: String(row['slug']),
    status: String(row['status']) as DocumentRecord['status'],
    rev: Number(row['rev']),
    draft: row['draft'],
    publishedVersionId: row['published_version_id'] === null || row['published_version_id'] === undefined ? null : String(row['published_version_id']),
    createdBy: row['created_by'] === null || row['created_by'] === undefined ? null : String(row['created_by']),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at']),
  };
}

function rowToSnapshot(row: Record<string, unknown>): SnapshotRecord {
  return {
    documentId: String(row['document_id']),
    versionId: String(row['version_id']),
    rendered: row['rendered'] as Snapshot,
    etag: String(row['etag']),
    builtAt: toDate(row['built_at']),
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`documents: unparseable timestamp ${String(value)}`);
  }
  return parsed;
}
