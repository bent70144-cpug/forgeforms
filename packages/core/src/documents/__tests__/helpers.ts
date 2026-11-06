/**
 * T10 — shared test fixtures: fake clock, Ctx, draft/document builders and a
 * one-call deps factory over the in-memory store (issue #10: in-memory fakes).
 */
import type { Ctx } from '../../bridge';
import type { DocumentBodyJson, DocumentRecord } from '../model';
import type { AssetUrlResolver, DraftValidator, LogicCompiler, PublicUrlBuilder } from '../ports';
import { createInMemoryDocumentStore, type InMemoryDocumentStore } from '../inmemory';
import { defaultDraftValidator } from '../validation';

export function makeClock(start = Date.parse('2026-11-06T10:00:00.000Z')) {
  let current = start;
  return {
    now: () => new Date(current),
    tick: (ms = 1): void => {
      current += ms;
    },
  };
}

export function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  const clock = makeClock();
  return {
    workspaceId: 'ws_a',
    actor: { type: 'user', id: 'u_1' },
    requestId: 'req_test_1',
    now: clock.now,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<DocumentBodyJson> = {}): DocumentBodyJson {
  return {
    schemaVersion: 1,
    type: 'form',
    theme: { tokens: { 'color.bg': '#fbf9f4', 'color.accent': '#ff5a36' } },
    settings: {
      locale: 'en',
      seo: { title: 'My form', description: 'A very good form' },
    },
    blocks: [
      { id: 'b1', kind: 'short-text', props: { label: 'Name' } },
      { id: 'b2', kind: 'image', props: { assetId: 'ast_1', alt: 'cover' } },
    ],
    endings: [{ id: 'end_1', title: 'Thanks!' }],
    logic: { rules: [] },
    ...overrides,
  };
}

export function makeDocument(draft: DocumentBodyJson, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const now = new Date('2026-11-06T09:00:00.000Z');
  return {
    id: 'doc_1',
    workspaceId: 'ws_a',
    type: 'form',
    title: 'My form',
    slug: 'my-form',
    status: 'draft',
    rev: 0,
    draft,
    publishedVersionId: null,
    createdBy: 'u_1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function fakeAssets(
  known: Readonly<Record<string, string>> = { ast_1: 'https://cdn.test/ast_1' },
): AssetUrlResolver {
  return {
    async resolve(assetId) {
      return known[assetId] ?? null;
    },
  };
}

export const fakeCompiler: LogicCompiler = {
  compile() {
    return { routing: { b1: { defaultNext: 'b2' } }, issues: [] };
  },
};

export const fakePublicUrl: PublicUrlBuilder = {
  async documentUrl(doc) {
    return `https://pub.test/p/${doc.workspaceId}/${doc.slug}`;
  },
};

export type TestHarness = {
  store: InMemoryDocumentStore;
  purged: { tags: string[]; keys: string[] };
  deps: Parameters<typeof import('../publish').makePublishDocument>[0];
};

export async function makeHarness(options: {
  validator?: DraftValidator;
  compiler?: LogicCompiler;
  assets?: AssetUrlResolver;
  document?: DocumentRecord;
} = {}): Promise<TestHarness> {
  const store = createInMemoryDocumentStore();
  const purged = { tags: [] as string[], keys: [] as string[] };
  store.put(options.document ?? makeDocument(makeDraft()));
  const harness: TestHarness = {
    store,
    purged,
    deps: {
      documents: store.documents,
      versions: store.versions,
      snapshots: store.snapshots,
      cdn: {
        purgeTag: async (tag) => {
          purged.tags.push(tag);
        },
        purgeKeys: async (keys) => {
          purged.keys.push(...keys);
        },
      },
      validator: options.validator ?? defaultDraftValidator,
      compiler: options.compiler ?? fakeCompiler,
      assets: options.assets ?? fakeAssets(),
      publicUrl: fakePublicUrl,
    },
  };
  return harness;
}

export async function seedAndPublish(
  overrides: Parameters<typeof makeHarness>[0] = {},
): Promise<{ harness: TestHarness; outcome: import('../model').PublishOutcome }> {
  const harness = await makeHarness(overrides);
  const { makePublishDocument } = await import('../publish');
  const result = await makePublishDocument(harness.deps)(makeCtx(), 'doc_1');
  if (!result.ok) throw new Error(`seedAndPublish failed: ${result.error.code}`);
  return { harness, outcome: result.value };
}
