/**
 * T10 — public interface of the `documents` publish pipeline module (spec §3).
 *
 * Exposes only service factories, types and error helpers. Consumers wire
 * concrete repositories via `PublishPipelineDeps` at the composition root
 * (apps/web/lib/api). Module internals are never imported directly.
 */
export { type Ctx } from "../shared/ctx.ts";
export { AppError, type AppErrorCode, type ErrorDetail as AppErrorDetail } from "../shared/errors.ts";
export { ok, err, type Result } from "../shared/result.ts";

export type {
  BlockJson,
  DocumentBodyJson,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  DocumentVersionRecord,
  EndingJson,
  PublishedSnapshot,
  PublishOutcome,
  RouteNode,
  Routing,
  Snapshot,
  SnapshotRecord,
  SnapshotSeo,
  SnapshotSettings,
} from './model';

export type {
  AssetUrlResolver,
  CdnPurgeHook,
  DocumentVersionInsert,
  DocumentsRepo,
  DraftValidationIssue,
  DraftValidator,
  LogicCompiler,
  PublicUrlBuilder,
  PublishedReadDeps,
  PublishPipelineDeps,
  PublishStatePatch,
  SnapshotUpsert,
  SnapshotsRepo,
  DocumentVersionsRepo,
} from './ports';
export { docTag, PUBLISH_ISSUE_CODES, routeKey, snapshotCacheKeys, snapshotKey } from './ports';

export { makePublishDocument, ordinalOf, collectEmbedTargetIssues, type PublishDocument } from './publish';
export {
  makeUnpublishDocument,
  type UnpublishDocument,
  type UnpublishOutcome,
} from './unpublish';
export {
  buildSnapshot,
  makeGetPublishedSnapshot,
  parsePublicSlug,
  resolveBlockAssetUrls,
  snapshotEtag,
  themeToCssVars,
  type BuildSnapshotArgs,
  type BuildSnapshotResult,
  type GetPublishedSnapshot,
} from './snapshot';

// T29 (spec §17): rich-text allowlist sanitizer (save + snapshot build).
export {
  decodeEntities,
  escapeHtmlText,
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeDocumentBodyRichText,
  sanitizeRichTextHtml,
  sanitizeRichTextProp,
} from './sanitize';

// T29 (spec §17): publish-time sensitive-field warning.
export { scanSensitiveFields } from './sensitive-fields';

// T29 (spec §17): admin takedown (archive + cache purge).
export {
  makeTakedownDocument,
  type TakedownDocument,
  type TakedownOutcome,
} from './takedown';
export type { PublishWarning } from './model';

export { appErrorToHttpStatus, toApiErrorBody } from './errors';
export { InMemoryCdnPurge, noopCdnPurge } from './cdn-purge';
export {
  defaultPublicUrlBuilder,
  devAssetUrlResolver,
  passthroughLogicCompiler,
  passthroughRichTextSanitizer,
} from './defaults';
export { defaultDraftValidator } from './validation';
export { createInMemoryDocumentStore, type InMemoryDocumentStore } from './inmemory';
// uuidv7 re-export removed at integration — root already exports it from shared/ids.

// ---------------------------------------------------------------------------
// T07 (issue #7) — documents CRUD + ops-based PATCH (spec §6, §8, §11)
// ---------------------------------------------------------------------------

export type {
  CrudDocumentsRepo,
  DraftPatch,
  ListDocumentsPage,
  ListDocumentsQuery,
} from './crud-ports';
export {
  applyBodyOps,
  applyDocOps,
  DocOpError,
  type OpDoc,
  type WireOp,
} from './apply';
export {
  createInMemoryCrudDocumentStore,
  type InMemoryCrudDocumentStore,
} from './crud-inmemory';
export {
  decodeDocumentCursor,
  emptyDocumentBody,
  encodeDocumentCursor,
  isRevConflict,
  makeArchiveDocument,
  makeCreateDocument,
  makeDuplicateDocument,
  makeGetDocument,
  makeListDocuments,
  makePatchDocument,
  RevConflictError,
  slugifyTitle,
  type CreateDocumentInput,
  type CrudDeps,
  type PatchDocumentInput,
} from './crud';
