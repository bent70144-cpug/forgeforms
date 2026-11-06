// T07 — route-handler tests for GET/PATCH/DELETE /api/v1/documents/:id and
// POST /api/v1/documents/:id/duplicate (spec §8 + §11).
//
// The PATCH assertions pin the autosave contract (spec §8):
//   - `{ baseRev, ops }` applied in one transaction → 200 { rev, updatedAt, body };
//   - stale `baseRev` → 409 CONFLICT with the CURRENT rev + body;
//   - invalid ops / invalid result DocumentBody → 422 with §4 field details.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryCrudDocumentStore } from '@formforge/core';
import type { AuthenticatedSession } from '@formforge/core/identity';

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: vi.fn(),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { configureCrudDocuments } from '@/lib/api/documents';
import { POST as createDocument } from '../route';
import { DELETE as archiveDocument, GET as getDocument, PATCH as patchDocument } from './route';
import { POST as duplicateDocument } from './duplicate/route';

const OWNER_SESSION = {
  session: {
    id: 'sess-1',
    userId: 'user-1',
    tokenHash: 'hash',
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  user: { id: 'user-1', email: 'ada@example.com', name: 'Ada', passwordHash: null, emailVerifiedAt: null, createdAt: new Date('2026-01-01T00:00:00Z') },
  workspace: { id: 'ws_1', name: 'Ada Inc', slug: 'ada-inc', plan: 'free', stripeCustomerId: null, stripeSubscriptionId: null, createdAt: new Date('2026-01-01T00:00:00Z') },
  role: 'owner',
} as AuthenticatedSession;

type Params = { params: Promise<{ id: string }> };

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost/api/v1/documents${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const withId = (id: string): Params => ({ params: Promise.resolve({ id }) });

async function createForm(title = 'Contact form'): Promise<{ id: string; rev: number; draft: Record<string, unknown> }> {
  const response = await createDocument(req('POST', '', { type: 'form', title }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; rev: number; draft: Record<string, unknown> };
}

const HERO_BLOCK = { id: 'hero1', kind: 'hero', props: { headline: 'Welcome' } };

beforeEach(() => {
  vi.mocked(getCurrentSession).mockReset();
  vi.mocked(getCurrentSession).mockResolvedValue(OWNER_SESSION);
  configureCrudDocuments({ documents: createInMemoryCrudDocumentStore().documents });
});

describe('GET /api/v1/documents/:id (builder envelope)', () => {
  it('200 — summary metadata + body = the current draft', async () => {
    const created = await createForm();
    const res = await getDocument(req('GET', `/${created.id}`), withId(created.id));
    expect(res.status).toBe(200);
    const env = (await res.json()) as {
      id: string; type: string; title: string; slug: string; status: string; rev: number;
      body: Record<string, unknown>; publishedVersionId: string | null;
    };
    expect(env.id).toBe(created.id);
    expect(env.rev).toBe(0);
    expect(env.status).toBe('draft');
    expect(env.publishedVersionId).toBeNull();
    expect(env.body).toMatchObject({ schemaVersion: 1, type: 'form' });
  });

  it('404 for an unknown or foreign-workspace id (§4 shape)', async () => {
    const res = await getDocument(req('GET', '/01900000-0000-7000-8000-000000000000'), withId('01900000-0000-7000-8000-000000000000'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /api/v1/documents/:id (autosave, spec §8)', () => {
  it('200 — applies the ops batch in one transaction, bumps rev once, returns the resulting body', async () => {
    const created = await createForm();
    const res = await patchDocument(
      req('PATCH', `/${created.id}`, {
        baseRev: 0,
        ops: [
          { op: 'block.insert', index: 0, block: HERO_BLOCK },
          { op: 'meta.update', patch: { title: 'Contact form v2' } },
        ],
      }),
      withId(created.id),
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      rev: number; updatedAt: string; body: { blocks: { id: string; kind: string }[] };
    };
    expect(out.rev).toBe(1);
    expect(new Date(out.updatedAt).toString()).not.toBe('Invalid Date');
    expect(out.body.blocks).toEqual([HERO_BLOCK]);
  });

  it('parented inserts land inside the parent (children preserved through validation)', async () => {
    const created = await createForm();
    const section = { id: 'sec1', kind: 'section', props: {}, children: [] as unknown[] };
    const child = { id: 'hero1', kind: 'hero', props: { headline: 'Nested' } };
    const first = await patchDocument(
      req('PATCH', `/${created.id}`, { baseRev: 0, ops: [{ op: 'block.insert', index: 0, block: section }] }),
      withId(created.id),
    );
    expect(first.status).toBe(200);
    const second = await patchDocument(
      req('PATCH', `/${created.id}`, {
        baseRev: 1,
        ops: [{ op: 'block.insert', parentId: 'sec1', index: 0, block: child }],
      }),
      withId(created.id),
    );
    expect(second.status).toBe(200);
    const out = (await second.json()) as { rev: number; body: { blocks: { id: string; children?: { id: string }[] }[] } };
    expect(out.rev).toBe(2);
    expect(out.body.blocks[0]?.children?.map((c) => c.id)).toEqual(['hero1']);
  });

  it('409 CONFLICT carries the CURRENT rev AND body when baseRev is stale (two tabs)', async () => {
    const created = await createForm();

    // Tab A saves normally: rev 0 → 1.
    const tabA = await patchDocument(
      req('PATCH', `/${created.id}`, {
        baseRev: 0,
        ops: [{ op: 'block.insert', index: 0, block: HERO_BLOCK }],
      }),
      withId(created.id),
    );
    expect(tabA.status).toBe(200);

    // Tab B still believes rev is 0 → 409 with the server's current rev + body.
    const tabB = await patchDocument(
      req('PATCH', `/${created.id}`, {
        baseRev: 0,
        ops: [{ op: 'block.insert', index: 0, block: { id: 'b2', kind: 'text', props: {} } }],
      }),
      withId(created.id),
    );
    expect(tabB.status).toBe(409);
    const conflict = (await tabB.json()) as {
      error: { code: string; message: string; details?: { path: string; message: string }[] };
      rev: number;
      body: Record<string, unknown>;
    };
    expect(conflict.error.code).toBe('CONFLICT');
    expect(conflict.rev).toBe(1); // current rev
    expect(conflict.body).toMatchObject({ schemaVersion: 1, type: 'form' });
    expect((conflict.body as { blocks?: unknown[] }).blocks).toHaveLength(1); // tab A's insert is visible
    expect(conflict.error.details?.some((d) => d.path === 'rev')).toBe(true);
  });

  it('422 VALIDATION with field details for unknown block references (§4 error shape)', async () => {
    const created = await createForm();
    const res = await patchDocument(
      req('PATCH', `/${created.id}`, { baseRev: 0, ops: [{ op: 'block.update', id: 'ghost', props: { label: 'x' } }] }),
      withId(created.id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: { path: string; message: string }[] };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.[0]).toMatchObject({ path: 'ops[0].id' });
  });

  it('422 with DocumentBody paths when the RESULT is invalid (schema-level detail)', async () => {
    const created = await createForm();
    // two blocks sharing one id → duplicate-id failure inside DocumentBody
    const res = await patchDocument(
      req('PATCH', `/${created.id}`, {
        baseRev: 0,
        ops: [
          { op: 'block.insert', index: 0, block: { id: 'dup', kind: 'text', props: {} } },
          { op: 'block.insert', index: 1, block: { id: 'dup', kind: 'text', props: {} } },
        ],
      }),
      withId(created.id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details?: { path: string; message: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.length).toBeGreaterThan(0);
  });

  it('422 when the Zod wire schema rejects a malformed op before it reaches the service', async () => {
    const created = await createForm();
    const res = await patchDocument(
      req('PATCH', `/${created.id}`, { baseRev: 0, ops: [{ op: 'block.teleport', id: 'x' }] }),
      withId(created.id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details?: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.every((d) => typeof d.path === 'string')).toBe(true);
  });

  it('rev is returned so the client can chain batches (serialized autosave queue)', async () => {
    const created = await createForm();
    const revs: number[] = [];
    let base = created.rev;
    for (let i = 0; i < 3; i++) {
      const res = await patchDocument(
        req('PATCH', `/${created.id}`, {
          baseRev: base,
          ops: [{ op: 'settings.update', patch: { progressBar: i % 2 === 0 } }],
        }),
        withId(created.id),
      );
      expect(res.status).toBe(200);
      const out = (await res.json()) as { rev: number };
      revs.push(out.rev);
      base = out.rev;
    }
    expect(revs).toEqual([1, 2, 3]);
  });

  it('404 unknown document; 422 archived documents are not editable', async () => {
    const res = await patchDocument(req('PATCH', '/nope', { baseRev: 0, ops: [] }), withId('nope'));
    expect(res.status).toBe(404);

    const created = await createForm();
    const del = await archiveDocument(req('DELETE', `/${created.id}`), withId(created.id));
    expect(del.status).toBe(204);
    const patch = await patchDocument(
      req('PATCH', `/${created.id}`, { baseRev: 0, ops: [{ op: 'block.remove', id: 'x' }] }),
      withId(created.id),
    );
    expect(patch.status).toBe(422);
    const body = (await patch.json()) as { error: { details?: { path: string; message: string }[] } };
    expect(body.error.details?.[0]?.message).toMatch(/archived/i);
  });
});

describe('POST /api/v1/documents/:id/duplicate', () => {
  it('201 — deep-copied draft, "(copy)" title, unique slug, draft status, rev 0', async () => {
    const created = await createForm('Landing page');
    await patchDocument(
      req('PATCH', `/${created.id}`, { baseRev: 0, ops: [{ op: 'block.insert', index: 0, block: HERO_BLOCK }] }),
      withId(created.id),
    );

    const res = await duplicateDocument(req('POST', `/${created.id}/duplicate`), withId(created.id));
    expect(res.status).toBe(201);
    const copy = (await res.json()) as {
      id: string; title: string; slug: string; status: string; rev: number; draft: { blocks?: unknown[] };
    };
    expect(copy.id).not.toBe(created.id);
    expect(copy.title).toBe('Landing page (copy)');
    expect(copy.slug).toBe('landing-page-copy');
    expect(copy.status).toBe('draft');
    expect(copy.rev).toBe(0);
    expect(copy.draft.blocks).toEqual([HERO_BLOCK]);
  });

  it('404 for unknown documents', async () => {
    const res = await duplicateDocument(req('POST', '/nope/duplicate'), withId('nope'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/documents/:id (archive)', () => {
  it('204 — soft-delete; the document stays out of default (draft) listings', async () => {
    const created = await createForm();
    const res = await archiveDocument(req('DELETE', `/${created.id}`), withId(created.id));
    expect(res.status).toBe(204);

    const gone = await getDocument(req('GET', `/${created.id}`), withId(created.id));
    expect(gone.status).toBe(200); // still fetchable
    const env = (await gone.json()) as { status: string };
    expect(env.status).toBe('archived');
  });

  it('404 for unknown documents', async () => {
    const res = await archiveDocument(req('DELETE', '/nope'), withId('nope'));
    expect(res.status).toBe(404);
  });
});
