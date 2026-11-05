/**
 * T10 — public interface of the `documents` publish pipeline module (spec §3).
 *
 * Exposes only service factories, types and error helpers. Consumers wire
 * concrete repositories via `PublishPipelineDeps` at the composition root
 * (apps/web/lib/api). Module internals are never imported directly.
 */
export { AppError, ok, err, type Ctx, type Result, type AppErrorCode, type AppErrorDetail } from '../bridge';

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
export { docTag, routeKey, snapshotCacheKeys, snapshotKey } from './ports';

export { makePublishDocument, ordinalOf, type PublishDocument } from './publish';
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
