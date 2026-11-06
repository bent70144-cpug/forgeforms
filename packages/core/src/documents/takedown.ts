/**
 * T29 — admin takedown (spec §17: "admin takedown that sets a document to
 * `archived` and purges cache").
 *
 * Abuse-response path, distinct from the owner-initiated unpublish:
 *  - status → 'archived' (terminal: cannot be re-published without staff review),
 *  - published_version_id cleared + the stored snapshot deleted (the public
 *    reader then has nothing to serve),
 *  - CDN tag + route/snapshot keys purged so cached copies drop immediately.
 *
 * Idempotent: archiving an already-archived document re-purges (cache ops are
 * safe to repeat) and reports `takedown: false`.
 */
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { docTag, snapshotCacheKeys, type PublishPipelineDeps } from './ports';
import type { DocumentRecord } from './model';

export type TakedownOutcome = {
  documentId: string;
  /** Always 'archived' after a successful takedown. */
  status: 'archived';
  /** False when the document was already archived (no state change made). */
  takedown: boolean;
};

export type TakedownDocument = (
  ctx: Ctx,
  documentId: string,
) => Promise<Result<TakedownOutcome, AppError>>;

export function makeTakedownDocument(deps: PublishPipelineDeps): TakedownDocument {
  return async (ctx, documentId): Promise<Result<TakedownOutcome, AppError>> => {
    const doc = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!doc) {
      return err(
        new AppError('NOT_FOUND', `Document ${documentId} not found`, [
          { path: 'id', message: 'unknown document' },
        ]),
      );
    }

    let updated: DocumentRecord = doc;
    if (doc.status !== 'archived') {
      // Force-archive: clears the published pointer AND sets the terminal
      // status in one write (updatePublishState covers status+publishedVersionId).
      updated = await deps.documents.updatePublishState(ctx.workspaceId, documentId, {
        status: 'archived',
        publishedVersionId: null,
        updatedAt: ctx.now(),
      });
      // Drop the rendered snapshot backing the public plane.
      await deps.snapshots.deleteByDocumentId(documentId);
    }

    // Purge even when already archived — cache entries may outlive state.
    await deps.cdn.purgeTag(docTag(documentId));
    await deps.cdn.purgeKeys(snapshotCacheKeys(updated));

    return ok({
      documentId,
      status: 'archived',
      takedown: doc.status !== 'archived',
    });
  };
}
