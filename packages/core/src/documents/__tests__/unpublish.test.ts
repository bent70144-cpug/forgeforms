/**
 * T10 — unpublish service tests: state rollback, cache purge, 410 semantics.
 */
import { describe, expect, it } from 'vitest';
import { makeGetPublishedSnapshot } from '../snapshot';
import { appErrorToHttpStatus } from '../errors';
import { makeCtx, makeDocument, makeDraft, makeHarness, seedAndPublish } from './helpers';

async function publishedHarness() {
  return seedAndPublish();
}

describe('unpublishDocument', () => {
  it('clears publish state, drops the snapshot, purges cache keys + tag', async () => {
    const { harness, outcome } = await publishedHarness();
    const { makeUnpublishDocument } = await import('../unpublish');

    const result = await makeUnpublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ documentId: 'doc_1', status: 'draft', unpublished: true });

    const doc = await harness.deps.documents.getById('ws_a', 'doc_1');
    expect(doc?.status).toBe('draft');
    expect(doc?.publishedVersionId).toBeNull();

    // rendered body leaves the public backing store
    expect(await harness.deps.snapshots.getByDocumentId('doc_1')).toBeNull();

    // versions are history — they survive unpublish
    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions.map((v) => v.id)).toContain(outcome.versionId);

    // cache keys purged (issue #10: "snapshot cache keys purged")
    expect(harness.purged.tags).toContain('doc:doc_1');
    expect(harness.purged.keys).toContain('snapshot:doc_1');
    expect(harness.purged.keys).toContain('route:ws_a/my-form');
  });

  it('public reader returns UNPUBLISHED (→ HTTP 410) after unpublish', async () => {
    const { harness } = await publishedHarness();
    const { makeUnpublishDocument } = await import('../unpublish');
    const reader = makeGetPublishedSnapshot({ documents: harness.deps.documents, snapshots: harness.deps.snapshots });

    await makeUnpublishDocument(harness.deps)(makeCtx(), 'doc_1');

    const result = await reader('my-form');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNPUBLISHED');
    expect(appErrorToHttpStatus(result.error.code)).toBe(410);
  });

  it('is idempotent for already-draft documents (purge still runs)', async () => {
    const { harness } = await publishedHarness();
    const { makeUnpublishDocument } = await import('../unpublish');
    const unpublish = makeUnpublishDocument(harness.deps);
    const tagsBefore = harness.purged.tags.length;

    await unpublish(makeCtx(), 'doc_1');
    const again = await unpublish(makeCtx(), 'doc_1');

    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.unpublished).toBe(false);
    // both calls purge (cache ops are safe to repeat)
    expect(harness.purged.tags.slice(tagsBefore)).toEqual(['doc:doc_1', 'doc:doc_1']);
  });

  it('allows re-publishing after unpublish (new version row)', async () => {
    const { harness, outcome } = await publishedHarness();
    const { makeUnpublishDocument } = await import('../unpublish');
    const { makePublishDocument } = await import('../publish');

    await makeUnpublishDocument(harness.deps)(makeCtx(), 'doc_1');
    const republished = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');

    expect(republished.ok).toBe(true);
    if (!republished.ok) return;
    expect(republished.value.version).toBe(2);
    expect(republished.value.versionId).not.toBe(outcome.versionId);
  });

  it('rejects unpublishing archived documents', async () => {
    const harness = await makeHarness({
      document: makeDocument(makeDraft(), { status: 'archived' }),
    });
    const { makeUnpublishDocument } = await import('../unpublish');
    const result = await makeUnpublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('returns NOT_FOUND for unknown documents', async () => {
    const harness = await makeHarness();
    const { makeUnpublishDocument } = await import('../unpublish');
    const result = await makeUnpublishDocument(harness.deps)(makeCtx(), 'doc_missing');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
