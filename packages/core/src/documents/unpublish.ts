/**
 * T10 — unpublishDocument service (spec §8 "Unpublish", issue #10).
 *
 * Sets status back to 'draft', clears published_version_id (spec §6 columns;
 * SPEC-NOTE: the ticket phrasing "clears current_version_id / sets
 * unpublished_at" maps onto these columns — §6 defines no unpublished_at), drops
 * the stored snapshot so no public rendered body is retained, and purges the
 * CDN cache keys + tag. The public reader then returns UNPUBLISHED → HTTP 410.
 *
 * Unpublishing an already-draft document is an idempotent no-op (still purges,
 * cache ops are safe to repeat). Archived documents are rejected: unpublish
 * must not resurrect them.
 */
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";;
import type { DocumentRecord } from './model';
import { docTag, snapshotCacheKeys, type PublishPipelineDeps } from './ports';

export type UnpublishOutcome = {
  documentId: string;
  status: 'draft';
  /** False when the document was already a draft (no state change made). */
  unpublished: boolean;
};

export type UnpublishDocument = (
  ctx: Ctx,
  documentId: string,
) => Promise<Result<UnpublishOutcome, AppError>>;

export function makeUnpublishDocument(deps: PublishPipelineDeps): UnpublishDocument {
  return async (ctx, documentId): Promise<Result<UnpublishOutcome, AppError>> => {
    const doc = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!doc) {
      return err(
        new AppError('NOT_FOUND', `Document ${documentId} not found`, [
          { path: 'id', message: 'unknown document' },
        ]),
      );
    }
    if (doc.status === 'archived') {
      return err(new AppError('CONFLICT', 'Archived documents cannot be unpublished'));
    }

    let updated: DocumentRecord = doc;
    if (doc.status === 'published' || doc.publishedVersionId !== null) {
      updated = await deps.documents.updatePublishState(ctx.workspaceId, documentId, {
        status: 'draft',
        publishedVersionId: null,
        updatedAt: ctx.now(),
      });
      // Drop the rendered snapshot backing the public plane (spec §8: "delete
      // snapshot cache keys"). Re-publishing rebuilds it from the draft.
      await deps.snapshots.deleteByDocumentId(documentId);
    }

    await deps.cdn.purgeTag(docTag(documentId));
    await deps.cdn.purgeKeys(snapshotCacheKeys(updated));

    return ok({ documentId, status: 'draft', unpublished: updated.publishedVersionId === null && doc.status === 'published' });
  };
}
