/**
 * T07 — ports (dependency seams) for the documents CRUD + PATCH module.
 *
 * `CrudDocumentsRepo` EXTENDS T10's `DocumentsRepo` (getById / findBySlug /
 * updatePublishState) with the CRUD + autosave primitives, so one repository
 * implementation can serve both the publish pipeline and this module.
 * Implementations: `crud-inmemory.ts` (tests/dev) and the SQL repository in
 * `@formforge/db` (production).
 */
import type { DocumentRecord, DocumentStatus, DocumentType } from './model';
import type { DocumentsRepo } from './ports';

/** spec §11 GET /documents filters + §4 cursor pagination. */
export type ListDocumentsQuery = {
  type?: DocumentType;
  status?: DocumentStatus;
  /** Title substring search (case-insensitive). */
  q?: string;
  /** Page size, 1–100 (default 50). */
  limit: number;
  /** Opaque cursor from a previous page (see encodeDocumentCursor). */
  cursor?: string | null;
};

/** Cursor page, ordered by updated_at DESC then id DESC (spec §6 index). */
export type ListDocumentsPage = {
  items: DocumentRecord[];
  nextCursor: string | null;
};

/**
 * Fields updateDraft may change: the working draft, document-level meta and
 * the updated_at timestamp. `rev` is the concurrency counter and is bumped by
 * the repo on success — callers must not pass it.
 */
export type DraftPatch = {
  title?: string;
  slug?: string;
  draft?: unknown;
};

export interface CrudDocumentsRepo extends DocumentsRepo {
  /** Insert a new row; `id` and `slug` are expected to be pre-validated. */
  insert(record: DocumentRecord): Promise<DocumentRecord>;
  list(workspaceId: string, query: ListDocumentsQuery): Promise<ListDocumentsPage>;
  /**
   * Optimistic-concurrency primitive for autosave (spec §8): applies `patch`
   * atomically only while the stored `rev === expectedRev`, sets
   * `rev = expectedRev + 1` and `updated_at = updatedAt`. Returns the updated
   * record, or `'CONFLICT'` when the revision moved underneath the caller.
   */
  updateDraft(
    workspaceId: string,
    documentId: string,
    expectedRev: number,
    patch: DraftPatch,
    updatedAt: Date,
  ): Promise<DocumentRecord | 'CONFLICT'>;
  /** Lifecycle transitions beyond the publish state (e.g. archive). */
  setStatus(
    workspaceId: string,
    documentId: string,
    status: DocumentStatus,
    updatedAt: Date,
  ): Promise<DocumentRecord | null>;
}
