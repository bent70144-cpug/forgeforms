/**
 * T10 — in-memory implementations of the publish-pipeline repositories.
 *
 * Used by unit tests (issue #10: "vitest with in-memory fakes") and as the
 * dev-mode persistence behind the API container until the real drizzle
 * repositories land. Immutability contract is enforced structurally:
 * - versions: append-only, bodies cloned on write, deep-frozen on read;
 * - snapshots: rendered bodies cloned on write, deep-frozen on read.
 */
import { deepFreeze, structuralClone } from './hash';
import type { DocumentRecord, SnapshotRecord, DocumentVersionRecord } from './model';
import type {
  DocumentVersionInsert,
  DocumentsRepo,
  PublishStatePatch,
  SnapshotUpsert,
  SnapshotsRepo,
  DocumentVersionsRepo,
} from './ports';

export type InMemoryDocumentStore = {
  documents: DocumentsRepo;
  versions: DocumentVersionsRepo;
  snapshots: SnapshotsRepo;
  /** Test/dev helper: seed or replace a document row directly. */
  put(document: DocumentRecord): void;
};

export function createInMemoryDocumentStore(): InMemoryDocumentStore {
  const docs = new Map<string, Map<string, DocumentRecord>>();
  const versionsByDoc = new Map<string, DocumentVersionRecord[]>();
  const snapshotsByDoc = new Map<string, SnapshotRecord>();

  const bucketFor = (workspaceId: string): Map<string, DocumentRecord> => {
    let bucket = docs.get(workspaceId);
    if (!bucket) {
      bucket = new Map<string, DocumentRecord>();
      docs.set(workspaceId, bucket);
    }
    return bucket;
  };

  const documents: DocumentsRepo = {
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
      if (!record) {
        throw new Error(`documents.updatePublishState: unknown document ${documentId}`);
      }
      const updated: DocumentRecord = {
        ...record,
        status: patch.status,
        publishedVersionId: patch.publishedVersionId,
        updatedAt: patch.updatedAt,
      };
      bucket.set(documentId, updated);
      return structuralClone(updated);
    },
  };

  const versions: DocumentVersionsRepo = {
    async insert(record: DocumentVersionInsert) {
      const list = versionsByDoc.get(record.documentId) ?? [];
      if (list.some((v) => v.id === record.id)) {
        // Insert-only table: an id collision is a programmer error, not a
        // recoverable condition (spec §6: document_versions is immutable).
        throw new Error(`document_versions: duplicate version id ${record.id}`);
      }
      const stored = deepFreeze(structuralClone(record));
      list.push(stored);
      versionsByDoc.set(record.documentId, list);
      return structuralClone(stored);
    },

    async listByDocument(workspaceId, documentId) {
      const list = versionsByDoc.get(documentId) ?? [];
      return list
        .filter((v) => v.workspaceId === workspaceId)
        .sort(byCreatedThenId)
        .map((v) => deepFreeze(structuralClone(v)));
    },

    async getById(workspaceId, documentId, versionId) {
      const found = (versionsByDoc.get(documentId) ?? []).find(
        (v) => v.id === versionId && v.workspaceId === workspaceId,
      );
      return found ? deepFreeze(structuralClone(found)) : null;
    },
  };

  const snapshots: SnapshotsRepo = {
    async upsert(record: SnapshotUpsert) {
      const stored = deepFreeze(structuralClone(record));
      snapshotsByDoc.set(record.documentId, stored);
      return structuralClone(stored);
    },

    async getByDocumentId(documentId) {
      const record = snapshotsByDoc.get(documentId);
      return record ? deepFreeze(structuralClone(record)) : null;
    },

    async deleteByDocumentId(documentId) {
      snapshotsByDoc.delete(documentId);
    },
  };

  return {
    documents,
    versions,
    snapshots,
    put(document: DocumentRecord) {
      bucketFor(document.workspaceId).set(document.id, structuralClone(document));
    },
  };
}

function byCreatedThenId(a: DocumentVersionRecord, b: DocumentVersionRecord): number {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  // uuidv7 ids are time-ordered, so id breaks created_at ties deterministically.
  return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
