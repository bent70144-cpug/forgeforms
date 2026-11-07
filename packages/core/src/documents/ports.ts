/**
 * T10 — ports (dependency seams) for the publish pipeline.
 *
 * Core defines the contracts; `packages/db/src/repositories/**` (T02/T07) and
 * the app composition root (apps/web/lib/api) supply implementations. Services
 * in this module never import a concrete repository — spec §3.
 */
import type {
  BlockJson,
  DocumentRecord,
  DocumentVersionRecord,
  DocumentType,
  Snapshot,
  SnapshotRecord,
} from './model';

// ---------------------------------------------------------------------------
// Repositories (spec §6 tables; scoping by workspaceId is mandatory)
// ---------------------------------------------------------------------------

export type PublishStatePatch = {
  // T29: 'archived' is the terminal takedown state (spec §17) — reachable ONLY
  // via makeTakedownDocument; publish/unpublish keep the published/draft pair.
  status: 'published' | 'draft' | 'archived';
  publishedVersionId: string | null;
  updatedAt: Date;
};

export interface DocumentsRepo {
  /** Tenant-scoped fetch. Returns null when the row does not exist in the workspace. */
  getById(workspaceId: string, documentId: string): Promise<DocumentRecord | null>;
  /**
   * Public-plane lookup. `workspaceSlug === null` matches any workspace (the
   * path-based public URL may omit the workspace segment); implementations
   * MUST only ever return *published* or draft rows and never leak other
   * tenant fields beyond the document record itself.
   */
  findBySlug(workspaceSlug: string | null, docSlug: string): Promise<DocumentRecord | null>;
  /** Transitions the lifecycle columns only (status + published_version_id). */
  updatePublishState(
    workspaceId: string,
    documentId: string,
    patch: PublishStatePatch,
  ): Promise<DocumentRecord>;
}

export type DocumentVersionInsert = Omit<DocumentVersionRecord, never>;

export interface DocumentVersionsRepo {
  /** Insert-only: creating a version must never update an existing row. */
  insert(record: DocumentVersionInsert): Promise<DocumentVersionRecord>;
  /** History ordered oldest → newest (created_at, id — uuidv7 sorts stably). */
  listByDocument(workspaceId: string, documentId: string): Promise<DocumentVersionRecord[]>;
  getById(
    workspaceId: string,
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersionRecord | null>;
}

export type SnapshotUpsert = {
  documentId: string;
  versionId: string;
  rendered: Snapshot;
  etag: string;
  builtAt: Date;
};

export interface SnapshotsRepo {
  /** One snapshot per document (spec §6 primary key document_id). */
  upsert(record: SnapshotUpsert): Promise<SnapshotRecord>;
  getByDocumentId(documentId: string): Promise<SnapshotRecord | null>;
  /** Unpublish cleanup — the rendered body leaves the public backing store. */
  deleteByDocumentId(documentId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Side-effect seams
// ---------------------------------------------------------------------------

/**
 * CDN purge seam (spec §8 steps 5/unpublish). No-op in this milestone; the
 * Cloudflare implementation arrives with the edge/domains work (Phase 2).
 */
export interface CdnPurgeHook {
  /** Purge everything tagged with `tag` (see `docTag`). */
  purgeTag(tag: string): Promise<void>;
  /** Purge exact cache keys (see `snapshotKey` / `routeKey`). */
  purgeKeys(keys: readonly string[]): Promise<void>;
}

/**
 * Spec §8 step 1 — full draft validation. Empty array = valid.
 *
 * `code` / `blockId` (B7 follow-up #4): the two cross-entity publish-gate codes
 * (FORM_EMBED_MISSING, MISSING_ASSET — see `PUBLISH_ISSUE_CODES`) are emitted
 * by the publish pipeline itself, which is the only place target-document and
 * asset existence can be checked. Both fields are optional so validators that
 * only know `{ path, message }` (schema package, logic engine) stay assignable;
 * the extra fields ride on the §4 error `details` wire shape verbatim, so the
 * builder's Issues drawer can group the 422 issues by block (§8.1).
 */
export type DraftValidationIssue = {
  path: string;
  message: string;
  /** Stable §8.1 code when the pipeline can classify the issue. */
  code?: string;
  /** Owning block id when the issue belongs to a block (drawer "Go to"). */
  blockId?: string;
};

/**
 * §8.1 stable publish-blocking codes emitted by the server publish pipeline
 * (B7 follow-up #4). The client mirror of this vocabulary lives in
 * apps/web/lib/builder/publish.ts `ISSUE_CODES` — keep the two in sync.
 */
export const PUBLISH_ISSUE_CODES = {
  /** form-embed block whose target document is missing or not published. */
  formEmbedMissing: 'FORM_EMBED_MISSING',
  /** block/SEO asset reference that no longer resolves in the workspace. */
  missingAsset: 'MISSING_ASSET',
} as const;

export interface DraftValidator {
  validate(body: unknown): Promise<readonly DraftValidationIssue[]>;
}

/** Spec §9 compile seam — the logic engine compiles rules into a routing map.
 *  T20 (issue #20): optional `endings` so `end:<id>` goto targets are verified
 *  against the document's endings during publish lint (backwards compatible —
 *  existing 2-arg implementations remain assignable). */
export interface LogicCompiler {
  compile(
    rules: readonly unknown[],
    blocks: readonly BlockJson[],
    endings?: readonly string[],
  ): { routing: Snapshot['routing']; issues: readonly DraftValidationIssue[] };
}

/** Spec §8 step 3 — asset ids resolved to CDN URLs. Null = asset missing. */
export interface AssetUrlResolver {
  resolve(assetId: string): Promise<string | null>;
}

/** Spec §8 step 6 — build the public URL for a document. */
export interface PublicUrlBuilder {
  documentUrl(doc: Readonly<{ id: string; workspaceId: string; slug: string; type: DocumentType }>): Promise<string>;
}

/** Everything `makePublishDocument` / `makeUnpublishDocument` need. */
export type PublishPipelineDeps = {
  documents: DocumentsRepo;
  versions: DocumentVersionsRepo;
  snapshots: SnapshotsRepo;
  cdn: CdnPurgeHook;
  validator: DraftValidator;
  compiler: LogicCompiler;
  assets: AssetUrlResolver;
  publicUrl: PublicUrlBuilder;
  /**
   * T29 (spec §17): rich-text allowlist sanitizer applied during snapshot
   * build. The save path (CrudDeps.sanitize) covers stored drafts; this covers
   * the rendered snapshot — the public plane's security boundary.
   */
  sanitizeRichText?: (node: unknown) => unknown;
};

/** Reader-only subset used by the public snapshot reader. */
export type PublishedReadDeps = Pick<PublishPipelineDeps, 'documents' | 'snapshots'>;

// ---------------------------------------------------------------------------
// Cache key/tag vocabulary shared by publish, unpublish and the purge hook
// ---------------------------------------------------------------------------

export const docTag = (documentId: string): string => `doc:${documentId}`;
export const snapshotKey = (documentId: string): string => `snapshot:${documentId}`;

/** SPEC-NOTE: keyed by workspaceId until tenancy exposes workspace slugs (§10). */
export const routeKey = (workspaceId: string, docSlug: string): string =>
  `route:${workspaceId}/${docSlug}`;

export function snapshotCacheKeys(
  doc: Readonly<{ id: string; workspaceId: string; slug: string }>,
): string[] {
  return [snapshotKey(doc.id), routeKey(doc.workspaceId, doc.slug)];
}
