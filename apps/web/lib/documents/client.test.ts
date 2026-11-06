// T07 — unit tests for the browser documents client (fetch stubbed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentsApiError,
  archiveDocument,
  createDocument,
  duplicateDocument,
  listDocuments,
} from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SUMMARY = {
  id: '01900000-0000-7000-8000-000000000001',
  type: 'form',
  title: 'Contact',
  slug: 'contact',
  status: 'draft',
  rev: 0,
  createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listDocuments', () => {
  it('parses the §4 pagination envelope and passes filters as query params', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { data: [SUMMARY], nextCursor: 'c2' }),
    );
    const page = await listDocuments({ type: 'form', q: 'cont', cursor: 'c1', limit: 25 });
    expect(page).toEqual({ data: [SUMMARY], nextCursor: 'c2' });
    const raw = vi.mocked(fetch).mock.calls[0]?.[0] as string;
    const url = new URL(raw, 'http://localhost');
    expect(url.pathname).toBe('/api/v1/documents');
    expect(url.searchParams.get('type')).toBe('form');
    expect(url.searchParams.get('q')).toBe('cont');
    expect(url.searchParams.get('cursor')).toBe('c1');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('omits the query string when no filters are given', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, { data: [], nextCursor: null }));
    await listDocuments();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/v1/documents');
  });

  it('throws DocumentsApiError with §4 code + field details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          code: 'VALIDATION',
          message: 'Invalid input',
          details: [{ path: 'cursor', message: 'Malformed cursor' }],
        },
      }),
    );
    const err = await listDocuments({ cursor: '@' }).catch((e) => e);
    expect(err).toBeInstanceOf(DocumentsApiError);
    expect(err.code).toBe('VALIDATION');
    expect(err.status).toBe(422);
    expect(err.details).toEqual([{ path: 'cursor', message: 'Malformed cursor' }]);
  });
});

describe('createDocument', () => {
  it('POSTs { type, title, templateId? } and returns the 201 detail', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, { ...SUMMARY, draft: { schemaVersion: 1 }, publishedVersionId: null }),
    );
    const doc = await createDocument({ type: 'form', title: 'Contact', templateId: 'contact-form' });
    expect(doc.draft).toEqual({ schemaVersion: 1 });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/documents');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'form',
      title: 'Contact',
      templateId: 'contact-form',
    });
  });
});

describe('duplicateDocument / archiveDocument', () => {
  it('duplicate POSTs to /:id/duplicate and returns the copy', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(201, { ...SUMMARY, title: 'Contact (copy)', draft: {}, publishedVersionId: null }),
    );
    const copy = await duplicateDocument(SUMMARY.id);
    expect(copy.title).toBe('Contact (copy)');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/v1/documents/${SUMMARY.id}/duplicate`);
    expect(init.method).toBe('POST');
  });

  it('archive resolves on 204 and throws the §4 error otherwise', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(archiveDocument(SUMMARY.id)).resolves.toBeUndefined();

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Document nope not found' } }),
    );
    const err = await archiveDocument('nope').catch((e) => e);
    expect(err).toBeInstanceOf(DocumentsApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
  });
});
