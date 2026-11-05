/**
 * T10 — composition root for the documents publish/unpublish API (spec §3).
 *
 * INTEGRATION-DEBT: awaiting T02/T07 — the repositories below are the in-memory
 * store from @formforge/core (dev/test persistence). The integrator swaps them
 * for the drizzle repositories (documents, snapshots) and wires the real CDN
 * purge client + logic compiler + schema validator by calling
 * `configureDocumentsApi` once at boot, or by editing `buildDefaultDeps`.
 * `createDocumentVersionsRepo` in @formforge/db is ready for the real wiring.
 */
import {
  createInMemoryDocumentStore,
  defaultDraftValidator,
  defaultPublicUrlBuilder,
  devAssetUrlResolver,
  makeGetPublishedSnapshot,
  makePublishDocument,
  makeUnpublishDocument,
  noopCdnPurge,
  passthroughLogicCompiler,
  type Ctx,
  type GetPublishedSnapshot,
  type PublishDocument,
  type PublishPipelineDeps,
  type PublishOutcome,
  type UnpublishDocument,
  type UnpublishOutcome,
} from '@formforge/core';

function buildDefaultDeps(): PublishPipelineDeps {
  const store = createInMemoryDocumentStore();
  const baseUrl = process.env['PUBLIC_BASE_URL'] ?? 'http://localhost:3000';
  const cdnBase = process.env['S3_PUBLIC_CDN_URL'] ?? `${baseUrl}/assets`;
  return {
    documents: store.documents,
    versions: store.versions,
    snapshots: store.snapshots,
    cdn: noopCdnPurge,
    validator: defaultDraftValidator,
    compiler: passthroughLogicCompiler,
    assets: devAssetUrlResolver(cdnBase),
    publicUrl: defaultPublicUrlBuilder(baseUrl),
  };
}

let deps: PublishPipelineDeps = buildDefaultDeps();

/** Swap the whole pipeline (T07/T03/T25 integrator entry point). */
export function configureDocumentsApi(next: PublishPipelineDeps): void {
  deps = next;
}

export type DocumentsApi = {
  publishDocument: PublishDocument;
  unpublishDocument: UnpublishDocument;
  getPublishedSnapshot: GetPublishedSnapshot;
};

export const documentsApi: DocumentsApi = {
  publishDocument: (ctx: Ctx, id: string) => makePublishDocument(deps)(ctx, id),
  unpublishDocument: (ctx: Ctx, id: string) => makeUnpublishDocument(deps)(ctx, id),
  getPublishedSnapshot: (slug: string) => makeGetPublishedSnapshot(deps)(slug),
};

export type { PublishOutcome, UnpublishOutcome };
