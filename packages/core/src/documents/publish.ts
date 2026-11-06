/**
 * T10 — publishDocument service (spec §8 "Publish", issue #10).
 *
 * Flow:
 *  1. validate the draft fully (DocumentBody shape → logic lint → asset existence);
 *  2. insert an immutable `document_versions` row (append-only, no update path);
 *  3. build the §8 snapshot and upsert `snapshots` with an etag;
 *  4. set documents.status='published' + published_version_id (spec §6 columns);
 *  5. purge CDN cache by tag `doc:<id>` (KV routing entry: Phase 2 seam);
 *  6. return { url }.
 *
 * Idempotency (issue #10): re-publishing an unchanged draft does NOT create a
 * new version row — the previous version is reused and the same URL returned.
 */
import { err, ok, AppError, type Ctx, type Result } from '../bridge';
import { canonicalHash } from './hash';
import { uuidv7 } from './ids';
import type { DocumentBodyJson, PublishOutcome } from './model';
import { docTag, snapshotCacheKeys, type PublishPipelineDeps } from './ports';
import { buildSnapshot, snapshotEtag } from './snapshot';

export type PublishDocument = (
  ctx: Ctx,
  documentId: string,
) => Promise<Result<PublishOutcome, AppError>>;

export function makePublishDocument(deps: PublishPipelineDeps): PublishDocument {
  return async (ctx, documentId): Promise<Result<PublishOutcome, AppError>> => {
    // Tenant-scoped load (spec §3: every service scopes by ctx.workspaceId).
    const doc = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!doc) {
      return err(
        new AppError('NOT_FOUND', `Document ${documentId} not found`, [
          { path: 'id', message: 'unknown document' },
        ]),
      );
    }
    if (doc.status === 'archived') {
      return err(new AppError('CONFLICT', 'Archived documents cannot be published'));
    }

    // 1. Full draft validation. The DraftValidator contract guarantees the
    // validated body has the §7 structural shape when it reports no issues.
    const body = doc.draft as DocumentBodyJson;
    const schemaIssues = await deps.validator.validate(doc.draft);
    // T20 (issue #20): pass the draft's ending ids so the engine's lint can
    // verify `end:<id>` goto targets (dangling target blocks publish).
    const endingIds = (body.endings ?? []).map((ending) => ending.id);
    const lintIssues = schemaIssues.length === 0
      ? deps.compiler.compile(body.logic?.rules ?? [], body.blocks ?? [], endingIds).issues
      : [];
    const allIssues = [...schemaIssues, ...lintIssues];
    if (allIssues.length > 0) {
      return err(new AppError('VALIDATION', 'Draft failed validation', allIssues));
    }

    // Idempotency gate: unchanged draft → reuse the published version.
    const draftHash = canonicalHash(doc.draft);
    if (doc.status === 'published' && doc.publishedVersionId !== null) {
      const existing = await deps.versions.getById(ctx.workspaceId, documentId, doc.publishedVersionId);
      if (existing && canonicalHash(existing.body) === draftHash) {
        const history = await deps.versions.listByDocument(ctx.workspaceId, documentId);
        const outcome: PublishOutcome = {
          url: await deps.publicUrl.documentUrl(doc),
          documentId: doc.id,
          versionId: existing.id,
          version: ordinalOf(history, existing.id),
          reused: true,
        };
        return ok(outcome);
      }
    }

    // 3-before-2: build the snapshot FIRST (asset resolution may still fail),
    // so an invalid draft writes nothing at all — not even a version row.
    const versionId = uuidv7();
    const built = await buildSnapshot({
      document: { id: doc.id, title: doc.title, type: doc.type },
      versionId,
      body,
      assets: deps.assets,
      compiler: deps.compiler,
    });
    if (built.issues.length > 0) {
      return err(new AppError('VALIDATION', 'Draft failed validation', built.issues));
    }

    // 2. Immutable version row (append-only). Version ids are app-generated
    // UUIDv7 (spec §4); the ordinal is the row's 1-based history position.
    const version = await deps.versions.insert({
      id: versionId,
      documentId: doc.id,
      workspaceId: ctx.workspaceId,
      schemaVersion: body.schemaVersion ?? 1,
      body: doc.draft,
      createdBy: ctx.actor.id,
      createdAt: ctx.now(),
    });

    await deps.snapshots.upsert({
      documentId: doc.id,
      versionId: version.id,
      rendered: built.snapshot,
      etag: snapshotEtag(built.snapshot),
      builtAt: ctx.now(),
    });

    // 4. Flip the lifecycle pointer (status + published_version_id per §6).
    const updated = await deps.documents.updatePublishState(ctx.workspaceId, documentId, {
      status: 'published',
      publishedVersionId: version.id,
      updatedAt: ctx.now(),
    });

    // 5. Purge CDN by tag; exact keys for the snapshot + routing entries.
    await deps.cdn.purgeTag(docTag(documentId));
    await deps.cdn.purgeKeys(snapshotCacheKeys(updated));
    // SPEC-NOTE: spec §8 step 5 also updates a KV routing entry; that table is
    // Phase 2 (custom domains) — the CdnPurgeHook.seam above covers cache only.

    // 6. Public URL (p95 target < 10 s; measured in __tests__/publish.test.ts).
    const history = await deps.versions.listByDocument(ctx.workspaceId, documentId);
    return ok({
      url: await deps.publicUrl.documentUrl(updated),
      documentId: updated.id,
      versionId: version.id,
      version: ordinalOf(history, version.id),
      reused: false,
    });
  };
}

/** 1-based position of a version in the ordered history; -1 when unknown. */
export function ordinalOf(
  history: ReadonlyArray<{ id: string }>,
  versionId: string,
): number {
  const index = history.findIndex((v) => v.id === versionId);
  return index === -1 ? -1 : index + 1;
}
