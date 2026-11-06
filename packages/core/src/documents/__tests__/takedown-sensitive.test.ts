// T29 — takedown + sensitive-field warning tests (spec §17).
import { describe, expect, it } from 'vitest';
import { InMemoryCdnPurge } from '../cdn-purge';
import { createInMemoryDocumentStore } from '../inmemory';
import { defaultDraftValidator } from '../validation';
import { fakeAssets, fakeCompiler, fakePublicUrl, makeCtx, makeDocument, makeDraft, makeHarness } from './helpers';
import { makeTakedownDocument } from '../takedown';
import { scanSensitiveFields } from '../sensitive-fields';
import type { DocumentBodyJson } from '../model';
import { makePublishDocument } from '../publish';

function publishedHarness(title = 'My form') {
  const store = createInMemoryDocumentStore();
  const cdn = new InMemoryCdnPurge();
  const draft = makeDraft();
  const doc = makeDocument(draft, {
    status: 'published',
    publishedVersionId: 'ver_1',
    title,
    slug: 'my-form',
  });
  store.put(doc);
  return { store, cdn, deps: { documents: store.documents, versions: store.versions, snapshots: store.snapshots, cdn, validator: defaultDraftValidator, compiler: fakeCompiler, assets: fakeAssets(), publicUrl: fakePublicUrl }, doc };
}

describe('makeTakedownDocument (admin abuse takedown, spec §17)', () => {
  it('archives a published document, drops the snapshot and purges cache', async () => {
    const { store, cdn, deps } = publishedHarness();
    const result = await makeTakedownDocument(deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ documentId: 'doc_1', status: 'archived', takedown: true });
    const doc = await deps.documents.getById('ws_a', 'doc_1');
    expect(doc?.status).toBe('archived');
    expect(doc?.publishedVersionId).toBeNull();
    expect(await deps.snapshots.getByDocumentId('doc_1')).toBeNull();
    expect(cdn.purgedEverythingFor({ id: 'doc_1', workspaceId: 'ws_a', slug: 'my-form' })).toBe(true);
  });

  it('is idempotent for already-archived documents but still purges cache', async () => {
    const { store, cdn, deps } = publishedHarness();
    await deps.documents.updatePublishState('ws_a', 'doc_1', { status: 'archived', publishedVersionId: null, updatedAt: new Date() });
    cdn.tags.length = 0;
    cdn.keys.length = 0;
    const result = await makeTakedownDocument(deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.takedown).toBe(false);
    expect(cdn.tags).toContain('doc:doc_1');
    expect(cdn.keys).toContain('snapshot:doc_1');
    expect(cdn.keys).toContain('route:ws_a/my-form');
  });

  it('purges cache even when only the snapshot row was public (draft takedown)', async () => {
    const store = createInMemoryDocumentStore();
    const cdn = new InMemoryCdnPurge();
    store.put(makeDocument(makeDraft(), { status: 'draft', slug: 'my-form' }));
    const deps = { documents: store.documents, versions: store.versions, snapshots: store.snapshots, cdn, validator: defaultDraftValidator, compiler: fakeCompiler, assets: fakeAssets(), publicUrl: fakePublicUrl };
    const result = await makeTakedownDocument(deps)(makeCtx(), 'doc_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('archived');
    expect(cdn.purgedEverythingFor({ id: 'doc_1', workspaceId: 'ws_a', slug: 'my-form' })).toBe(true);
  });

  it('returns NOT_FOUND for unknown documents', async () => {
    const { deps } = publishedHarness();
    const result = await makeTakedownDocument(deps)(makeCtx(), 'doc_none');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('scanSensitiveFields (publish-time sensitive-field warning, spec §17)', () => {
  const form = (props: Record<string, unknown>): DocumentBodyJson => ({
    ...makeDraft({ blocks: [{ id: 'q1', kind: 'short-text', props }] }),
  });

  it('warns for password questions', () => {
    const warnings = scanSensitiveFields(form({ label: 'Account password', required: true }));
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toMatchObject({ code: 'SENSITIVE_FIELD', blockId: 'q1' });
    expect(warnings[0]!.message).toContain('password');
  });

  it.each([
    ['Credit card number', 'card number'],
    ['CVV security code', 'CVV'],
    ['Social security number (SSN)', 'SSN'],
    ['Passport number', 'passport'],
    ['Bank account / IBAN', 'bank account'],
    ['Card expiry date', 'expiry'],
  ])('warns for %j', (label) => {
    const warnings = scanSensitiveFields(form({ label, required: false }));
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.every((w) => w.code === 'SENSITIVE_FIELD')).toBe(true);
  });

  it('does not warn for ordinary questions', () => {
    expect(scanSensitiveFields(form({ label: 'Your email address' }))).toEqual([]);
    expect(scanSensitiveFields(form({ label: 'Company size' }))).toEqual([]);
    expect(scanSensitiveFields(form({ label: 'Feedback' }))).toEqual([]);
  });

  it('scans nested blocks inside sections', () => {
    const body = makeDraft({
      blocks: [
        {
          id: 'sec',
          kind: 'section',
          props: {},
          children: [{ id: 'q_nested', kind: 'short-text', props: { label: 'Password' } }],
        },
      ],
    });
    const warnings = scanSensitiveFields(body);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({ blockId: 'q_nested' });
  });

  it('publish outcome carries the warnings (non-blocking)', async () => {
    const draft = makeDraft({
      blocks: [
        { id: 'q1', kind: 'short-text', props: { label: 'Credit card number', required: true } },
        { id: 'q2', kind: 'short-text', props: { label: 'Name', required: true } },
      ],
    });
    const { outcome } = await (async () => {
      const harness = await makeHarness({ document: makeDocument(draft, { status: 'draft' }) });
      const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
      if (!result.ok) throw new Error(result.error.message);
      return { outcome: result.value };
    })();
    expect(outcome.warnings).toBeDefined();
    expect(outcome.warnings?.length).toBeGreaterThanOrEqual(1);
    expect(outcome.warnings?.[0]?.code).toBe('SENSITIVE_FIELD');
  });

  it('clean forms publish without warnings', async () => {
    const { outcome } = await (async () => {
      const harness = await makeHarness();
      const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
      if (!result.ok) throw new Error(result.error.message);
      return { outcome: result.value };
    })();
    expect(outcome.warnings).toBeUndefined();
  });
});
