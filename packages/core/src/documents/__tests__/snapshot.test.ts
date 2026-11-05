/**
 * T10 — snapshot builder + immutability tests (issue #10: "Snapshot JSON
 * matches Snapshot type", immutable versions, deep-frozen reads).
 */
import { describe, expect, it } from 'vitest';
import { buildSnapshot, parsePublicSlug, snapshotEtag, themeToCssVars } from '../snapshot';
import { defaultDraftValidator } from '../validation';
import { makeDocument, makeDraft, makeHarness, seedAndPublish } from './helpers';

describe('buildSnapshot (spec §8 shape)', () => {
  it('maps theme tokens → cssVars, resolves assets, compiles routing, picks settings', async () => {
    const draft = makeDraft({
      theme: { tokens: { 'color.bg': '#fbf9f4', 'color.accent': '#ff5a36', 'radius.lg': '16px' } },
      settings: {
        locale: 'de',
        progressBar: false,
        captcha: true,
        closeAt: '2026-12-31T23:59:59.000Z',
        seo: { title: 'SEO title', description: 'SEO desc', ogImageAssetId: 'ast_1' },
      },
      blocks: [
        { id: 'b1', kind: 'short-text', props: { label: 'Name' } },
        { id: 'b2', kind: 'image', props: { assetId: 'ast_1', alt: 'cover' } },
        { id: 'b3', kind: 'gallery', props: { assetIds: ['ast_1'] } },
        {
          id: 'b4',
          kind: 'section',
          props: {},
          children: [{ id: 'b5', kind: 'image', props: { imageAssetId: 'ast_1' } }],
        },
      ],
    });

    const { snapshot, issues } = await buildSnapshot({
      document: { id: 'doc_1', title: 'My form', type: 'form' },
      versionId: 'ver_1',
      body: draft,
      assets: { resolve: async (id) => (id === 'ast_1' ? 'https://cdn.test/ast_1' : null) },
      compiler: { compile: () => ({ routing: { b1: { defaultNext: 'b2' } }, issues: [] }) },
    });

    expect(issues).toEqual([]);
    // exact §8 Snapshot shape
    expect(Object.keys(snapshot).sort()).toEqual(
      ['blocks', 'cssVars', 'documentId', 'endings', 'locale', 'routing', 'seo', 'settings', 'title', 'type', 'versionId'].sort(),
    );
    expect(snapshot.documentId).toBe('doc_1');
    expect(snapshot.versionId).toBe('ver_1');
    expect(snapshot.type).toBe('form');
    expect(snapshot.title).toBe('SEO title'); // seo title overrides document title
    expect(snapshot.seo).toEqual({
      title: 'SEO title',
      description: 'SEO desc',
      ogImageUrl: 'https://cdn.test/ast_1',
    });
    expect(snapshot.locale).toBe('de');
    expect(snapshot.cssVars).toEqual({ '--color-bg': '#fbf9f4', '--color-accent': '#ff5a36', '--radius-lg': '16px' });
    // asset ids resolved to CDN URLs in place (nested blocks included)
    expect(snapshot.blocks[1]?.props).toEqual({ assetId: 'https://cdn.test/ast_1', alt: 'cover' });
    expect(snapshot.blocks[2]?.props).toEqual({ assetIds: ['https://cdn.test/ast_1'] });
    expect(snapshot.blocks[3]?.children?.[0]?.props?.['imageAssetId']).toBe('https://cdn.test/ast_1');
    // routing from the injected logic compiler
    expect(snapshot.routing).toEqual({ b1: { defaultNext: 'b2' } });
    // settings picked per §8
    expect(snapshot.settings).toEqual({
      progressBar: false,
      autoAdvance: true,
      showBranding: true,
      captcha: true,
      closeAt: '2026-12-31T23:59:59.000Z',
    });
  });

  it('sanitizes rich text through the injected sanitizer', async () => {
    const draft = makeDraft({
      blocks: [{ id: 't1', kind: 'text', props: { richText: { type: 'doc', content: [] } } }],
    });
    const { snapshot } = await buildSnapshot({
      document: { id: 'doc_1', title: 'T', type: 'page' },
      versionId: 'ver_1',
      body: draft,
      assets: { resolve: async () => null },
      compiler: { compile: () => ({ routing: {}, issues: [] }) },
      sanitizeRichText: () => '<p>sanitized</p>',
    });
    expect(snapshot.blocks[0]?.props?.['richText']).toBe('<p>sanitized</p>');
  });

  it('derives a stable etag from the rendered payload', async () => {
    const draft = makeDraft();
    const args = {
      document: { id: 'doc_1', title: 'My form', type: 'form' as const },
      versionId: 'ver_1',
      body: draft,
      assets: { resolve: async (id: string) => (id === 'ast_1' ? 'https://cdn.test/ast_1' : null) },
      compiler: { compile: () => ({ routing: {}, issues: [] }) },
    };
    const a = await buildSnapshot(args);
    const b = await buildSnapshot(args);
    expect(a.snapshot).toEqual(b.snapshot);
    expect(snapshotEtag(a.snapshot)).toBe(snapshotEtag(b.snapshot));

    const changed = await buildSnapshot({ ...args, versionId: 'ver_2' });
    expect(snapshotEtag(changed.snapshot)).not.toBe(snapshotEtag(a.snapshot));
  });
});

describe('themeToCssVars', () => {
  it('normalizes token names to CSS custom properties', () => {
    expect(themeToCssVars({ 'color.bg': '#fff', 'Font Heading': 'Inter', '--already-var': '1' })).toEqual({
      '--color-bg': '#fff',
      '--font-heading': 'Inter',
      '--already-var': '1',
    });
  });
});

describe('immutability', () => {
  it('version bodies are structurally cloned on write and frozen on read', async () => {
    const { harness, outcome } = await seedAndPublish();

    const version = await harness.deps.versions.getById('ws_a', 'doc_1', outcome.versionId);
    expect(version).not.toBeNull();
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version?.body)).toBe(true);

    // tampering with the returned record must not corrupt the store
    try {
      (version!.body as { blocks: { props: Record<string, unknown> }[] }).blocks[0]!.props.label = 'TAMPERED';
    } catch {
      // frozen objects may throw in strict mode — either way the store is safe
    }
    const reread = await harness.deps.versions.getById('ws_a', 'doc_1', outcome.versionId);
    expect((reread?.body as { blocks: { props: Record<string, unknown> }[] }).blocks[0]?.props.label).toBe('Name');
  });

  it('getPublishedSnapshot returns deep-frozen snapshots (mutate-proof on read)', async () => {
    const { harness } = await seedAndPublish();
    const reader = (await import('../snapshot')).makeGetPublishedSnapshot({
      documents: harness.deps.documents,
      snapshots: harness.deps.snapshots,
    });
    const result = await reader('my-form');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { snapshot } = result.value;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.blocks)).toBe(true);
    expect(Object.isFrozen(snapshot.blocks[0])).toBe(true);
    expect(Object.isFrozen(snapshot.cssVars)).toBe(true);
    expect(Object.isFrozen(snapshot.routing)).toBe(true);

    // freezing holds: mutation attempts (strict mode → throws) leave data intact
    expect(() => {
      (snapshot.settings as { captcha: boolean }).captcha = true;
    }).toThrow(TypeError);
    expect(snapshot.settings.captcha).toBe(false);
  });

  it('detects a stale publish pointer as INTERNAL (invariant guard)', async () => {
    const { harness } = await seedAndPublish();
    // simulate drift: published pointer without matching snapshot
    harness.store.put(
      makeDocument(makeDraft(), {
        id: 'doc_1',
        status: 'published',
        publishedVersionId: 'ver_ghost',
      }),
    );
    const reader = (await import('../snapshot')).makeGetPublishedSnapshot({
      documents: harness.deps.documents,
      snapshots: harness.deps.snapshots,
    });
    const result = await reader('my-form');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('parsePublicSlug', () => {
  it('splits composite workspace/doc slugs and tolerates slashes', () => {
    expect(parsePublicSlug('my-form')).toEqual({ workspaceSlug: null, docSlug: 'my-form' });
    expect(parsePublicSlug('acme/my-form')).toEqual({ workspaceSlug: 'acme', docSlug: 'my-form' });
    expect(parsePublicSlug('/acme/my-form/')).toEqual({ workspaceSlug: 'acme', docSlug: 'my-form' });
  });
});

describe('defaultDraftValidator', () => {
  it('rejects garbage drafts with field-level paths', async () => {
    const issues = await defaultDraftValidator.validate({ schemaVersion: 2, blocks: 'nope' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path === 'schemaVersion')).toBe(true);
    expect(issues.some((i) => i.path === 'blocks')).toBe(true);
  });

  it('rejects blocks without stable ids (spec §7)', async () => {
    const issues = await defaultDraftValidator.validate(makeDraft({ blocks: [{ id: '', kind: 'text' }] }));
    expect(issues.some((i) => i.path === 'blocks.0.id')).toBe(true);
  });
});
