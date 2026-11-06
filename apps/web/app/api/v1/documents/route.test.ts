// T07 — route-handler tests for GET/POST /api/v1/documents (spec §11 + §4).
//
// Full-stack through the real handlers: session auth (mocked session reader)
// → Zod validation → composition root → core CRUD service → in-memory repo.
// DB stays out of the loop (in-memory store injected per test); the SQL
// repository variant is exercised separately by DB-gated tests in @formforge/db.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryCrudDocumentStore } from '@formforge/core';
import type { AuthenticatedSession } from '@formforge/core/identity';

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: vi.fn(),
}));

import { getCurrentSession } from '@/lib/auth/session';
import { configureCrudDocuments } from '@/lib/api/documents';
import { GET as listDocuments, POST as createDocument } from './route';

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

function json(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost/api/v1/documents${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getCurrentSession).mockReset();
  vi.mocked(getCurrentSession).mockResolvedValue(OWNER_SESSION);
  // Fresh in-memory store per test — never touches DATABASE_URL.
  configureCrudDocuments({ documents: createInMemoryCrudDocumentStore().documents });
});

describe('POST /api/v1/documents (create modal, spec §14.1.2)', () => {
  it('201 — an empty DocumentBody per type with correct envelope fields', async () => {
    for (const type of ['form', 'page', 'portfolio'] as const) {
      const res = await createDocument(json('POST', '', { type, title: `My ${type}` }));
      expect(res.status).toBe(201);
      const doc = (await res.json()) as {
        id: string; type: string; title: string; status: string; rev: number;
        slug: string; createdAt: string; updatedAt: string; draft: Record<string, unknown>;
      };
      expect(doc.type).toBe(type);
      expect(doc.title).toBe(`My ${type}`);
      expect(doc.status).toBe('draft');
      expect(doc.rev).toBe(0);
      expect(doc.slug).toBe(`my-${type}`);
      expect(typeof doc.id).toBe('string');
      expect(doc.createdAt).not.toBeNaN();
      // empty DocumentBody per type (spec §7/§8): fresh skeleton, no content
      expect(doc.draft).toMatchObject({
        schemaVersion: 1,
        type,
        blocks: [],
        endings: [],
        logic: { rules: [] },
      });
    }
  });

  it('slug collisions get -2, -3 suffixes within the workspace', async () => {
    await createDocument(json('POST', '', { type: 'form', title: 'Contact' }));
    const second = await createDocument(json('POST', '', { type: 'form', title: 'Contact' }));
    expect(second.status).toBe(201);
    const doc = (await second.json()) as { slug: string };
    expect(doc.slug).toBe('contact-2');
  });

  it('422 VALIDATION with §4 field details for a bad type / empty title', async () => {
    const badType = await createDocument(json('POST', '', { type: 'deck', title: 'x' }));
    expect(badType.status).toBe(422);
    const badBody = (await badType.json()) as {
      error: { code: string; message: string; details?: { path: string; message: string }[] };
    };
    expect(badBody.error.code).toBe('VALIDATION');
    expect(Array.isArray(badBody.error.details)).toBe(true);

    const emptyTitle = await createDocument(json('POST', '', { type: 'form', title: '  ' }));
    expect(emptyTitle.status).toBe(422);
    const emptyBody = (await emptyTitle.json()) as { error: { code: string } };
    expect(emptyBody.error.code).toBe('VALIDATION');
  });

  it('template instantiation: templateId yields the template body (blank/template modal)', async () => {
    const res = await createDocument(
      json('POST', '', { type: 'form', title: 'From template', templateId: 'contact-form' }),
    );
    expect(res.status).toBe(201);
    const doc = (await res.json()) as { draft: { type: string; blocks: { id: string; kind: string }[] } };
    expect(doc.draft.type).toBe('form');
    expect(doc.draft.blocks.length).toBeGreaterThan(0);
  });

  it('422 when the template type does not match the requested type', async () => {
    const res = await createDocument(
      json('POST', '', { type: 'page', title: 'Mismatch', templateId: 'contact-form' }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details?: { path: string }[] } };
    expect(body.error.details?.[0]?.path).toBe('templateId');
  });

  it('403 FORBIDDEN without a session (spec §4 has no 401)', async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    const res = await createDocument(json('POST', '', { type: 'form', title: 'x' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/v1/documents (dashboard list)', () => {
  it('200 { data, nextCursor } — most recently updated first', async () => {
    const first = await createDocument(json('POST', '', { type: 'form', title: 'Alpha' }));
    const second = await createDocument(json('POST', '', { type: 'page', title: 'Beta' }));
    expect(first.ok && second.ok).toBe(true);

    const res = await listDocuments(json('GET', ''));
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      data: { title: string; type: string; status: string; rev: number; updatedAt: string }[];
      nextCursor: string | null;
    };
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((d) => d.title)).toEqual(['Beta', 'Alpha']); // updatedAt desc
    expect(page.data[0]).toMatchObject({ type: 'page', status: 'draft', rev: 0 });
  });

  it('filters by type, status and q (title substring)', async () => {
    await createDocument(json('POST', '', { type: 'form', title: 'Feedback form' }));
    await createDocument(json('POST', '', { type: 'page', title: 'Launch page' }));

    const byType = await listDocuments(json('GET', '?type=form'));
    const typed = (await byType.json()) as { data: { title: string }[] };
    expect(typed.data.map((d) => d.title)).toEqual(['Feedback form']);

    const byQ = await listDocuments(json('GET', '?q=launch'));
    const searched = (await byQ.json()) as { data: { title: string }[] };
    expect(searched.data.map((d) => d.title)).toEqual(['Launch page']);

    const none = await listDocuments(json('GET', '?status=published'));
    const empty = (await none.json()) as { data: unknown[] };
    expect(empty.data).toEqual([]);
  });

  it('422 on an unknown filter value or malformed cursor', async () => {
    const bad = await listDocuments(json('GET', '?type=deck'));
    expect(bad.status).toBe(422);
    const cursor = await listDocuments(json('GET', '?cursor=@@@'));
    expect(cursor.status).toBe(422);
    const body = (await cursor.json()) as { error: { details?: { path: string }[] } };
    expect(body.error.details?.[0]?.path).toBe('cursor');
  });

  it('200 for a viewer session — docs:read is in the read-only scope map', async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      ...OWNER_SESSION,
      role: 'viewer',
    } as AuthenticatedSession);
    const res = await listDocuments(json('GET', ''));
    expect(res.status).toBe(200); // viewer keeps docs:read
  });
});
