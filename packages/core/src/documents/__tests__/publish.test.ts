/**
 * T10 — publish service tests (issue #10 acceptance criteria).
 */
import { describe, expect, it } from 'vitest';
import { ordinalOf } from '../publish';
import { makeGetPublishedSnapshot } from '../snapshot';
import { defaultDraftValidator } from '../validation';
import type { DraftValidator, LogicCompiler } from '../ports';
import { fakeAssets, makeClock, makeCtx, makeDocument, makeDraft, makeHarness, seedAndPublish } from './helpers';

describe('publishDocument', () => {
  it('publishes a valid draft: version row, snapshot, publish state, purge, url', async () => {
    const { harness, outcome } = await seedAndPublish();

    expect(outcome.reused).toBe(false);
    expect(outcome.version).toBe(1);
    expect(outcome.url).toBe('https://pub.test/p/ws_a/my-form');
    expect(outcome.versionId).toMatch(/^[0-9a-f-]{36}$/);

    // version row carries the FULL draft body (snapshot JSON)
    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions).toHaveLength(1);
    expect(versions[0]?.body).toEqual(makeDraft());
    expect(versions[0]?.schemaVersion).toBe(1);
    expect(versions[0]?.createdBy).toBe('u_1');

    // publish state per spec §6 columns
    const doc = await harness.deps.documents.getById('ws_a', 'doc_1');
    expect(doc?.status).toBe('published');
    expect(doc?.publishedVersionId).toBe(outcome.versionId);

    // snapshot upserted with etag
    const snap = await harness.deps.snapshots.getByDocumentId('doc_1');
    expect(snap?.versionId).toBe(outcome.versionId);
    expect(snap?.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(snap?.rendered.documentId).toBe('doc_1');

    // CDN purge by tag doc:<id> + exact keys
    expect(harness.purged.tags).toContain('doc:doc_1');
    expect(harness.purged.keys).toContain('snapshot:doc_1');
    expect(harness.purged.keys).toContain('route:ws_a/my-form');
  });

  it('is idempotent: re-publish with no changes returns same url, no new version', async () => {
    const { harness, outcome } = await seedAndPublish();

    const { makePublishDocument } = await import('../publish');
    const again = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.value.reused).toBe(true);
    expect(again.value.versionId).toBe(outcome.versionId);
    expect(again.value.url).toBe(outcome.url);
    expect(again.value.version).toBe(outcome.version);

    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions).toHaveLength(1);
  });

  it('creates a new immutable version row when the body changed (monotonic)', async () => {
    const { harness, outcome } = await seedAndPublish();

    harness.store.put(
      makeDocument(
        makeDraft({ settings: { locale: 'en', seo: { title: 'My form v2' } } }),
        { id: 'doc_1', rev: 1 },
      ),
    );

    const { makePublishDocument } = await import('../publish');
    const second = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.reused).toBe(false);
    expect(second.value.version).toBe(2);
    expect(second.value.versionId).not.toBe(outcome.versionId);

    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions.map((v) => v.id)).toEqual([outcome.versionId, second.value.versionId]);
    // monotonic ordinals over the append-only history
    expect(ordinalOf(versions, outcome.versionId)).toBe(1);
    expect(ordinalOf(versions, second.value.versionId)).toBe(2);

    // old version body untouched (no update path existed)
    expect(versions[0]?.body).toEqual(makeDraft());
    expect(versions[1]?.body).toEqual(makeDraft({ settings: { locale: 'en', seo: { title: 'My form v2' } } }));
  });

  it('blocks invalid drafts with validation details and writes nothing', async () => {
    const validator: DraftValidator = {
      validate: async () => [{ path: 'blocks[2].props.title', message: 'Required' }],
    };
    const harness = await makeHarness({ validator });
    const { makePublishDocument } = await import('../publish');

    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(result.error.details).toEqual([{ path: 'blocks[2].props.title', message: 'Required' }]);

    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions).toHaveLength(0);
    expect(await harness.deps.snapshots.getByDocumentId('doc_1')).toBeNull();
    const doc = await harness.deps.documents.getById('ws_a', 'doc_1');
    expect(doc?.status).toBe('draft');
    expect(harness.purged.tags).toHaveLength(0);
  });

  it('blocks drafts failing logic lint (e.g. dangling goto)', async () => {
    const compiler: LogicCompiler = {
      compile: () => ({ routing: {}, issues: [{ path: 'logic.rules[0]', message: 'dangling goto target end:missing' }] }),
    };
    const harness = await makeHarness({ compiler });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    expect(result.error.details[0]?.message).toContain('dangling goto');
  });

  it('blocks publish when a required asset is missing', async () => {
    const harness = await makeHarness({ assets: fakeAssets({}) });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    // B7 follow-up #4: the MISSING_ASSET §8.1 code + owning block id ride on
    // the §4 details so the builder's Issues drawer can group the 422 issue.
    expect(result.error.details).toContainEqual({
      path: 'blocks[1].props.assetId',
      message: 'Asset not found: ast_1',
      code: 'MISSING_ASSET',
      blockId: 'b2',
    });
    // nothing went live — not even a version row
    expect(await harness.deps.versions.listByDocument('ws_a', 'doc_1')).toHaveLength(0);
    const doc = await harness.deps.documents.getById('ws_a', 'doc_1');
    expect(doc?.status).toBe('draft');
  });

  it('emits MISSING_ASSET for gallery entries and nested asset props too', async () => {
    const draft = makeDraft({
      blocks: [
        {
          id: 'g1',
          kind: 'gallery',
          props: { assetIds: ['ast_1', 'ast_gone'] },
        },
        {
          id: 'wrap',
          kind: 'section',
          props: {},
          children: [{ id: 'img2', kind: 'image', props: { imageAssetId: 'ast_also_gone' } }],
        },
      ],
    });
    const harness = await makeHarness({
      document: makeDocument(draft),
      assets: fakeAssets({ ast_1: 'https://cdn.test/ast_1' }),
    });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details).toContainEqual({
      path: 'blocks[0].props.assetIds[1]',
      message: 'Asset not found: ast_gone',
      code: 'MISSING_ASSET',
      blockId: 'g1',
    });
    expect(result.error.details).toContainEqual({
      path: 'blocks[1][0].props.imageAssetId',
      message: 'Asset not found: ast_also_gone',
      code: 'MISSING_ASSET',
      blockId: 'img2',
    });
  });

  // ---------------------------------------------------------------------------
  // §8.1 FORM_EMBED_MISSING (B7 follow-up #4) — form-embed target checks
  // ---------------------------------------------------------------------------

  const EMBED_TARGET = 'doc_2222222222222222222222'; // doc_ + 22 base58 chars

  it('blocks publish when a form-embed target document does not exist (FORM_EMBED_MISSING)', async () => {
    const draft = makeDraft({
      blocks: [
        { id: 'emb1', kind: 'form-embed', props: { documentId: EMBED_TARGET } },
        { id: 'emb2', kind: 'form-embed', props: { documentId: EMBED_TARGET } },
      ],
    });
    const harness = await makeHarness({ document: makeDocument(draft) });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION');
    // one issue PER broken block, each carrying the stable §8.1 code + block id
    expect(result.error.details).toHaveLength(2);
    expect(result.error.details[0]).toEqual({
      path: 'blocks[0].props.documentId',
      message: `The embedded form "${EMBED_TARGET}" no longer exists (deleted or moved out of this workspace).`,
      code: 'FORM_EMBED_MISSING',
      blockId: 'emb1',
    });
    expect(result.error.details[1]).toMatchObject({ code: 'FORM_EMBED_MISSING', blockId: 'emb2' });
    // the invalid draft wrote nothing
    expect(await harness.deps.versions.listByDocument('ws_a', 'doc_1')).toHaveLength(0);
    expect(harness.purged.tags).toHaveLength(0);
  });

  it('blocks publish when a form-embed target is not published (nested path form)', async () => {
    const draft = makeDraft({
      blocks: [
        {
          id: 'wrap',
          kind: 'section',
          props: {},
          children: [{ id: 'emb1', kind: 'form-embed', props: { documentId: EMBED_TARGET } }],
        },
      ],
    });
    const harness = await makeHarness({
      document: makeDocument(draft),
      // the target exists but is still a draft → live iframe would 410
    });
    harness.store.put(makeDocument(makeDraft(), { id: EMBED_TARGET, status: 'draft' }));
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details[0]).toMatchObject({
      code: 'FORM_EMBED_MISSING',
      blockId: 'emb1',
      path: 'blocks[0][0].props.documentId',
    });
    expect(result.error.details[0]?.message).toContain('not published');
  });

  it('blocks a self-embedding form (FORM_EMBED_MISSING)', async () => {
    const draft = makeDraft({
      blocks: [{ id: 'emb1', kind: 'form-embed', props: { documentId: 'doc_1' } }],
    });
    const harness = await makeHarness({ document: makeDocument(draft) });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details[0]).toMatchObject({
      code: 'FORM_EMBED_MISSING',
      blockId: 'emb1',
    });
    expect(result.error.details[0]?.message).toContain('embed itself');
  });

  it('allows a form-embed pointing at a published document in the same workspace', async () => {
    const draft = makeDraft({
      blocks: [{ id: 'emb1', kind: 'form-embed', props: { documentId: EMBED_TARGET } }],
    });
    const harness = await makeHarness({ document: makeDocument(draft) });
    harness.store.put(
      makeDocument(makeDraft(), {
        id: EMBED_TARGET,
        slug: 'target-form',
        status: 'published',
        publishedVersionId: 'ver_t1',
      }),
    );
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(true);
  });

  it('does not leak cross-workspace documents into the embed check (tenant isolation)', async () => {
    const draft = makeDraft({
      blocks: [{ id: 'emb1', kind: 'form-embed', props: { documentId: EMBED_TARGET } }],
    });
    const harness = await makeHarness({ document: makeDocument(draft) });
    // same id, DIFFERENT workspace → invisible to ws_a's publish
    harness.store.put(
      makeDocument(makeDraft(), {
        id: EMBED_TARGET,
        workspaceId: 'ws_b',
        status: 'published',
        publishedVersionId: 'ver_t1',
      }),
    );
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details[0]).toMatchObject({ code: 'FORM_EMBED_MISSING' });
  });

  it('rejects cross-workspace publishes (tenant isolation)', async () => {
    const harness = await makeHarness();
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx({ workspaceId: 'ws_b' }), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('returns CONFLICT for archived documents', async () => {
    const harness = await makeHarness({
      document: makeDocument(makeDraft(), { status: 'archived' }),
    });
    const { makePublishDocument } = await import('../publish');
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('uses ctx.now() and ctx.actor for the version row (testability, spec §4)', async () => {
    const clock = makeClock();
    const harness = await makeHarness();
    const { makePublishDocument } = await import('../publish');
    const ctx = makeCtx({ now: clock.now, actor: { type: 'token', id: 'tok_9' } });
    const result = await makePublishDocument(harness.deps)(ctx, 'doc_1');
    expect(result.ok).toBe(true);
    const versions = await harness.deps.versions.listByDocument('ws_a', 'doc_1');
    expect(versions[0]?.createdAt).toEqual(clock.now());
    expect(versions[0]?.createdBy).toBe('tok_9');
  });

  it('validates the default validator accepts the canonical draft shape', async () => {
    const issues = await defaultDraftValidator.validate(makeDraft());
    expect(issues).toEqual([]);
  });

  it('publishes well under the 10 s budget (recorded measurement)', async () => {
    const bigDraft = makeDraft({
      blocks: Array.from({ length: 50 }, (_, i) => ({
        id: `b${i}`,
        kind: 'short-text',
        props: { label: `Q${i}`, assetId: 'ast_1' },
      })),
    });
    const harness = await makeHarness({ document: makeDocument(bigDraft) });
    const { makePublishDocument } = await import('../publish');

    const started = performance.now();
    const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
    const elapsedMs = performance.now() - started;

    expect(result.ok).toBe(true);
    expect(elapsedMs).toBeLessThan(10_000);
    console.info(`[T10] publish latency (in-memory, 50 blocks): ${elapsedMs.toFixed(1)} ms`);
  });
});

describe('getPublishedSnapshot (public reader)', () => {
  it('serves the published snapshot by plain and composite slug', async () => {
    const { harness, outcome } = await seedAndPublish();
    const reader = makeGetPublishedSnapshot({ documents: harness.deps.documents, snapshots: harness.deps.snapshots });

    for (const slug of ['my-form', 'ws_a/my-form']) {
      const result = await reader(slug);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.versionId).toBe(outcome.versionId);
      expect(result.value.snapshot.documentId).toBe('doc_1');
    }
  });

  it('returns NOT_FOUND for unknown slugs and UNPUBLISHED for unpublished docs', async () => {
    const harness = await makeHarness();
    const reader = makeGetPublishedSnapshot({ documents: harness.deps.documents, snapshots: harness.deps.snapshots });

    const missing = await reader('nope');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND');

    // draft but never published → 410 domain, not 404
    const unpublished = await reader('my-form');
    expect(unpublished.ok).toBe(false);
    if (!unpublished.ok) expect(unpublished.error.code).toBe('UNPUBLISHED');
  });
});
