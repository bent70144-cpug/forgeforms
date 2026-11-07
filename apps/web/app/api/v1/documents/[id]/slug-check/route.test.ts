// Follow-up #5 — route-handler tests for GET /api/v1/documents/:id/slug-check
// (builder-audit §6.6/§22.1, §14). Same harness as [id]/route.test.ts:
// mocked session → documentsCrud with an in-memory repo, handlers called
// directly as plain Request → Response functions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryCrudDocumentStore } from '@formforge/core';
import type { AuthenticatedSession } from '@formforge/core/identity';

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: vi.fn(),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { configureCrudDocuments } from '@/lib/api/documents';
import { POST as createDocument } from '../../route';
import { PATCH as patchDocument } from '../route';
import { GET as slugCheck } from './route';

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

function checkReq(docId: string, query?: string): Request {
  const qs = query === undefined ? '' : `?q=${query}`;
  return new Request(`http://localhost/api/v1/documents/${docId}/slug-check${qs}`);
}

const withId = (id: string): Params => ({ params: Promise.resolve({ id }) });

async function createForm(title: string): Promise<{ id: string; rev: number }> {
  const response = await createDocument(
    new Request('http://localhost/api/v1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'form', title }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; rev: number };
}

async function setSlug(doc: { id: string; rev: number }, slug: string): Promise<void> {
  const res = await patchDocument(
    new Request(`http://localhost/api/v1/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: doc.rev, ops: [{ op: 'meta.update', patch: { slug } }] }),
    }),
    withId(doc.id),
  );
  expect(res.status).toBe(200);
}

beforeEach(() => {
  vi.mocked(getCurrentSession).mockReset();
  vi.mocked(getCurrentSession).mockResolvedValue(OWNER_SESSION);
  configureCrudDocuments({ documents: createInMemoryCrudDocumentStore().documents });
});

describe('GET /api/v1/documents/:id/slug-check', () => {
  it('200 { available: true } for a free slug', async () => {
    const doc = await createForm('Newsletter');
    const res = await slugCheck(checkReq(doc.id, 'my-form'), withId(doc.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it('200 available for the document’s OWN current slug (self-exclusion)', async () => {
    const doc = await createForm('Newsletter');
    await setSlug(doc, 'newsletter');
    const res = await slugCheck(checkReq(doc.id, 'newsletter'), withId(doc.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it('200 { available: false, suggestion } with the first free `-2` variant', async () => {
    const taken = await createForm('Newsletter');
    await setSlug(taken, 'my-form');
    const doc = await createForm('Contact form');
    const res = await slugCheck(checkReq(doc.id, 'my-form'), withId(doc.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, suggestion: 'my-form-2' });
  });

  it('suggestion walks past every taken variant (-3, -4, …)', async () => {
    const taken = await createForm('Newsletter');
    await setSlug(taken, 'my-form');
    const other = await createForm('Contact form');
    await setSlug(other, 'my-form-2');
    const doc = await createForm('Feedback');
    const res = await slugCheck(checkReq(doc.id, 'my-form'), withId(doc.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, suggestion: 'my-form-3' });
  });

  it('422 VALIDATION when `q` is missing (§4 field detail)', async () => {
    const doc = await createForm('Newsletter');
    const res = await slugCheck(checkReq(doc.id), withId(doc.id));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details?: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details?.[0]?.path).toBe('q');
  });

  it('422 VALIDATION when `q` breaks the §6.6 format rules (same rules as the panel)', async () => {
    const doc = await createForm('Newsletter');
    for (const bad of ['My-Form', 'my_form', 'ab', 'a'.repeat(61)]) {
      const res = await slugCheck(checkReq(doc.id, bad), withId(doc.id));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { details?: { path: string }[] } };
      expect(body.error.details?.[0]?.path).toBe('slug');
    }
  });

  it('404 NOT_FOUND for an unknown document id', async () => {
    const res = await slugCheck(checkReq('01900000-0000-7000-8000-000000000000', 'my-form'), withId('01900000-0000-7000-8000-000000000000'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('403 FORBIDDEN without a session (§4 has no 401)', async () => {
    const doc = await createForm('Newsletter');
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const res = await slugCheck(checkReq(doc.id, 'my-form'), withId(doc.id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
