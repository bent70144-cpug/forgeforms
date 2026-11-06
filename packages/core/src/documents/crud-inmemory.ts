/**
 * T07 — in-memory `CrudDocumentsRepo` implementation (spec §6 tables, §8
 * autosave semantics). Used by unit tests and as the dev-mode persistence
 * behind the API container when no database is configured — mirroring the
 * T10 in-memory publish store, but CRUD-capable so ONE store can drive both
 * the publish pipeline and the documents CRUD module.
 */
import { structuralClone } from './hash';
import type { DocumentRecord, DocumentStatus } from './model';
import type { PublishStatePatch } from './ports';
import type {
  CrudDocumentsRepo,
  DraftPatch,
  ListDocumentsPage,
  ListDocumentsQuery,
} from './crud-ports';
import { decodeDocumentCursor, encodeDocumentCursor } from './crud';

export type InMemoryCrudDocumentStore = {
  documents: CrudDocumentsRepo;
  /** Test/dev helper: seed or replace a document row directly. */
  put(document: DocumentRecord): void;
};

export function createInMemoryCrudDocumentStore(): InMemoryCrudDocumentStore {
  const docs = new Map<string, Map<string, DocumentRecord>>();

  const bucketFor = (workspaceId: string): Map<string, DocumentRecord> => {
    let bucket = docs.get(workspaceId);
    if (!bucket) {
      bucket = new Map<string, DocumentRecord>();
      docs.set(workspaceId, bucket);
    }
    return bucket;
  };

  const sortedByRecency = (bucket: Map<string, DocumentRecord>): DocumentRecord[] =>
    [...bucket.values()].sort(byRecencyDesc);

  function byRecencyDesc(a: DocumentRecord, b: DocumentRecord): number {
    const t = b.updatedAt.getTime() - a.updatedAt.getTime();
    if (t !== 0) return t;
    // uuidv7 ids are time-ordered — stable tiebreak, newest id first.
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  }

  const documents: CrudDocumentsRepo = {
    async getById(workspaceId, documentId) {
      const record = bucketFor(workspaceId).get(documentId);
      return record ? structuralClone(record) : null;
    },

    async findBySlug(workspaceSlug, docSlug) {
      const buckets = workspaceSlug === null ? [...docs.values()] : [bucketFor(workspaceSlug)];
      for (const bucket of buckets) {
        for (const record of bucket.values()) {
          if (record.slug === docSlug) return structuralClone(record);
        }
      }
      return null;
    },

    async updatePublishState(workspaceId, documentId, patch: PublishStatePatch) {
      const bucket = bucketFor(workspaceId);
      const record = bucket.get(documentId);
      if (!record) throw new Error(`documents.updatePublishState: unknown document ${documentId}`);
      const updated: DocumentRecord = {
        ...record,
        status: patch.status,
        publishedVersionId: patch.publishedVersionId,
        updatedAt: patch.updatedAt,
      };
      bucket.set(documentId, updated);
      return structuralClone(updated);
    },

    async insert(record) {
      bucketFor(record.workspaceId).set(record.id, structuralClone(record));
      return structuralClone(record);
    },

    async list(workspaceId, query: ListDocumentsQuery): Promise<ListDocumentsPage> {
      const all = sortedByRecency(bucketFor(workspaceId)).filter((doc) => {
        if (query.type && doc.type !== query.type) return false;
        if (query.status && doc.status !== query.status) return false;
        if (query.q && !doc.title.toLowerCase().includes(query.q.toLowerCase())) return false;
        return true;
      });

      let start = 0;
      if (query.cursor) {
        const decoded = decodeDocumentCursor(query.cursor);
        if (decoded) {
          start = all.findIndex((doc) => doc.updatedAt.getTime() === decoded.updatedAtMs && doc.id === decoded.id);
          if (start === -1) {
            // The cursor item vanished (archived/concurrently edited) — fall
            // back to the first row strictly AFTER the cursor position.
            start = all.findIndex((doc) => {
              const t = doc.updatedAt.getTime();
              return t < decoded.updatedAtMs || (t === decoded.updatedAtMs && doc.id < decoded.id);
            });
          } else {
            start += 1;
          }
        }
      }

      const limit = Math.max(1, Math.min(Math.round(query.limit) || 50, 100));
      const page = all.slice(start, start + limit + 1);
      const hasMore = page.length > limit;
      const items = page.slice(0, limit);
      const last = items[items.length - 1];
      return {
        items: structuralClone(items),
        nextCursor: hasMore && last ? encodeDocumentCursor(last.updatedAt, last.id) : null,
      };
    },

    async updateDraft(workspaceId, documentId, expectedRev, patch: DraftPatch, updatedAt) {
      const bucket = bucketFor(workspaceId);
      const record = bucket.get(documentId);
      if (!record || record.rev !== expectedRev) return 'CONFLICT';
      const updated: DocumentRecord = {
        ...record,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.draft !== undefined ? { draft: structuralClone(patch.draft) } : {}),
        rev: expectedRev + 1,
        updatedAt,
      };
      bucket.set(documentId, updated);
      return structuralClone(updated);
    },

    async setStatus(workspaceId, documentId, status: DocumentStatus, updatedAt) {
      const bucket = bucketFor(workspaceId);
      const record = bucket.get(documentId);
      if (!record) return null;
      const updated: DocumentRecord = { ...record, status, updatedAt };
      bucket.set(documentId, updated);
      return structuralClone(updated);
    },
  };

  return {
    documents,
    put(document: DocumentRecord) {
      bucketFor(document.workspaceId).set(document.id, structuralClone(document));
    },
  };
}
